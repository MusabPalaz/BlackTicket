import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { isMailReady } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService, describe } from './mail.service';
import type { MailTransport } from './transports/mail-transport';

/** Enough to clear a burst without holding a mail host open all minute. */
const BATCH = 20;
/** 1m, 5m, 25m, 2h… — a mail host that is down is usually down for a while. */
const BACKOFF_BASE_MS = 60_000;
/** Long enough to investigate a failure, short enough not to become an archive. */
const RETENTION_DAYS = 90;

interface ClaimedRow {
  id: string;
  to: string;
  subject: string;
  bodyText: string | null;
  attempts: number;
  maxAttempts: number;
}

/**
 * Drains the outbound queue.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED` so that a second application
 * instance can be added without two workers racing for the same message and
 * sending it twice. One transport is built per pass rather than per message:
 * opening an SMTP connection for each of twenty notices is most of the cost of
 * sending them.
 */
@Injectable()
export class MailWorker {
  private readonly logger = new Logger(MailWorker.name);
  private readonly workerId = randomUUID();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'mail-drain' })
  async drain(): Promise<number> {
    // A slow mail host must not let passes pile up on top of each other.
    if (this.running) return 0;
    this.running = true;

    let transport: MailTransport | null = null;
    try {
      const settings = await this.mail.getSettings();
      if (!isMailReady(settings) || !settings.transport || !settings.fromAddress) return 0;

      const claimed = await this.claim();
      if (claimed.length === 0) return 0;

      transport = await this.mail.transportFor(settings.transport);
      const from = settings.fromName
        ? `"${settings.fromName}" <${settings.fromAddress}>`
        : settings.fromAddress;

      let sent = 0;
      for (const row of claimed) {
        try {
          const result = await transport.send({
            to: row.to,
            subject: row.subject,
            text: row.bodyText ?? '',
            from,
          });
          await this.prisma.outboundEmail.update({
            where: { id: row.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              messageId: result.messageId,
              lastError: null,
              lockedAt: null,
              lockedBy: null,
              // The message is away; a second copy of case content here has no
              // reader and every retention question attached to it.
              bodyText: null,
            },
          });
          sent += 1;
        } catch (error) {
          await this.fail(row, error);
        }
      }
      return sent;
    } catch (error) {
      this.logger.error(`Mail drain failed: ${describe(error)}`);
      return 0;
    } finally {
      transport?.close();
      this.running = false;
    }
  }

  /**
   * Takes a batch and marks it as ours in one statement.
   *
   * `SKIP LOCKED` is what makes this safe to run in more than one process: a
   * worker takes what nobody else holds instead of waiting for it.
   */
  private async claim(): Promise<ClaimedRow[]> {
    /*
     * The cutoff is bound as a parameter rather than written as `now()`.
     *
     * Prisma stores DateTime as `timestamp` without a zone, holding UTC, while
     * Postgres `now()` answers in the session's local zone. Comparing the two
     * shifts every deadline by the server's offset — which silently defeated
     * the backoff entirely: a row told to wait a minute looked hours overdue,
     * so it was retried on every pass until its attempts ran out.
     */
    const cutoff = new Date();
    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "outbound_email" AS e
         SET "lockedAt" = ${cutoff}, "lockedBy" = ${this.workerId}, "attempts" = e."attempts" + 1
       WHERE e."id" IN (
         SELECT c."id" FROM "outbound_email" AS c
          WHERE c."status" = 'PENDING' AND c."runAt" <= ${cutoff}
          ORDER BY c."runAt" ASC
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING e."id", e."to", e."subject", e."bodyText", e."attempts", e."maxAttempts";
    `;
  }

  private async fail(row: ClaimedRow, error: unknown): Promise<void> {
    const detail = describe(error).slice(0, 500);
    const exhausted = row.attempts >= row.maxAttempts;

    await this.prisma.outboundEmail.update({
      where: { id: row.id },
      data: {
        status: exhausted ? 'FAILED' : 'PENDING',
        lastError: detail,
        lockedAt: null,
        lockedBy: null,
        ...(exhausted
          ? {}
          : { runAt: new Date(Date.now() + BACKOFF_BASE_MS * 5 ** (row.attempts - 1)) }),
      },
    });

    if (exhausted) {
      this.logger.warn(`Giving up on message ${row.id} to ${row.to}: ${detail}`);
    }
  }

  /**
   * Keeps the delivery record from becoming the thing it was meant to prevent.
   *
   * Failures are kept as long as successes: "it never arrived" is a question
   * asked weeks later, and an empty table is not an answer.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'mail-prune' })
  async prune(): Promise<number> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const { count } = await this.prisma.outboundEmail.deleteMany({
      where: { createdAt: { lt: cutoff }, status: { in: ['SENT', 'FAILED'] } },
    });
    if (count > 0) this.logger.log(`Pruned ${count} outbound e-mail record(s) older than ${RETENTION_DAYS} days.`);
    return count;
  }
}
