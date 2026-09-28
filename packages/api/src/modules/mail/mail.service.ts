import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_MAIL_SETTINGS,
  MailTemplate,
  MailTransportKind,
  isMailReady,
  normalizeEmail,
  validateEmailAgainstPolicy,
  type MailSettings,
  type MailTransportConfig,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { decryptSecret, encryptSecret } from '../../common/security/secret-box';
import type { AppEnv } from '../../common/config/env.config';
import type { MailTransport } from './transports/mail-transport';
import { SmtpTransport } from './transports/smtp.transport';
import { GraphTransport } from './transports/graph.transport';
import { render } from './mail.templates';

/** Keeps the mailbox password's key material apart from TOTP and OIDC. */
const SECRET_PURPOSE = 'mail';

export interface EnqueueInput {
  template: MailTemplate;
  userId: string;
  to: string;
  fullName: string;
  title: string;
  body?: string;
  link?: string | null;
}

/**
 * Queueing and delivery of outbound mail.
 *
 * Sending is never done on the request that caused it. A mail host that is
 * slow, or down, must not be able to make assigning a case slow, or fail; the
 * message is written to a table and a worker takes it from there.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  private masterKey(): string {
    return this.config.get('TOTP_ENCRYPTION_KEY', { infer: true });
  }

  private webBaseUrl(): string {
    return this.config.get('WEB_BASE_URL', { infer: true });
  }

  encryptSecretValue(plaintext: string): string {
    return encryptSecret(plaintext, this.masterKey(), SECRET_PURPOSE);
  }

  getSettings(): Promise<MailSettings> {
    return this.settings.get<MailSettings>('mail.settings', DEFAULT_MAIL_SETTINGS);
  }

  saveSettings(next: MailSettings): Promise<MailSettings> {
    return this.settings.set('mail.settings', next);
  }

  /**
   * The sender has to live inside the organisation domain.
   *
   * That is the point of the domain lock: mail claiming to come from the
   * organisation should come from the organisation. It also keeps SPF and
   * DMARC from silently dropping everything the system sends.
   */
  async assertSenderAllowed(fromAddress: string): Promise<void> {
    const domainPolicy = await this.settings.getIdentityDomainPolicy();
    if (!domainPolicy.domain) {
      throw new BadRequestException(
        'Set the organisation domain before configuring outbound mail; the sender has to belong to it.',
      );
    }

    const check = validateEmailAgainstPolicy(normalizeEmail(fromAddress), domainPolicy);
    if (!check.ok) {
      throw new BadRequestException(
        `The sender address must be inside @${domainPolicy.domain}.`,
      );
    }
  }

  // -------------------------------------------------------------- queueing

  /**
   * Adds a message to the queue, or does nothing at all.
   *
   * Silently skipping when mail is off is deliberate: this is called from the
   * middle of assigning a case and sweeping SLAs, and a tenant that never
   * configured mail must not see those operations start failing.
   */
  async enqueue(input: EnqueueInput): Promise<boolean> {
    const settings = await this.getSettings();
    if (!isMailReady(settings)) return false;

    const to = normalizeEmail(input.to);
    if (!to.includes('@')) return false;

    const { subject, text } = render(input.template, {
      fullName: input.fullName,
      title: input.title,
      body: input.body ?? '',
      link: input.link ?? null,
      webBaseUrl: this.webBaseUrl(),
    });

    await this.prisma.outboundEmail.create({
      data: { to, userId: input.userId, template: input.template, subject, bodyText: text },
    });
    return true;
  }

  // ------------------------------------------------------------- transport

  /** Builds a transport from stored settings. Caller closes it. */
  async transportFor(transport: MailTransportConfig): Promise<MailTransport> {
    if (transport.kind === MailTransportKind.GRAPH) {
      return new GraphTransport(transport, this.readSecret(transport.clientSecret, 'client secret'));
    }
    return new SmtpTransport(transport, this.readSecret(transport.password, 'mailbox password'));
  }

  /**
   * A secret that will not decrypt means the encryption key changed under the
   * stored settings. That is a configuration fault, and saying so beats a
   * cipher error surfacing as "the mail host refused the connection".
   */
  private readSecret(cipher: string, label: string): string {
    try {
      return decryptSecret(cipher, this.masterKey(), SECRET_PURPOSE);
    } catch {
      throw new BadRequestException(
        `The stored ${label} cannot be read. Re-enter it in the outbound mail settings.`,
      );
    }
  }

  /**
   * Connection check for the settings screen.
   *
   * Returns rather than throws: "the host refused the password" is an answer
   * the page has to render, not an error it has to handle.
   */
  async testConnection(): Promise<{ ok: boolean; detail: string }> {
    const settings = await this.getSettings();
    if (!settings.transport) return { ok: false, detail: 'No mail transport is configured yet.' };

    let transport: MailTransport | null = null;
    try {
      transport = await this.transportFor(settings.transport);
      await transport.verify();
      return { ok: true, detail: 'The mail host accepted the connection and the credentials.' };
    } catch (error) {
      return { ok: false, detail: describe(error) };
    } finally {
      transport?.close();
    }
  }

  /** Queues a test message, so the whole path including the worker is proven. */
  async sendTest(to: string, fullName: string, userId: string): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.transport || !settings.fromAddress) {
      throw new BadRequestException('Configure the mail host and sender address first.');
    }

    const { subject, text } = render(MailTemplate.TEST, {
      fullName,
      title: '',
      body: '',
      link: null,
      webBaseUrl: this.webBaseUrl(),
    });

    await this.prisma.outboundEmail.create({
      data: {
        to: normalizeEmail(to),
        userId,
        template: MailTemplate.TEST,
        subject,
        bodyText: text,
        /*
         * Queued even when mail is switched off, because this is how an
         * administrator proves the settings before switching it on.
         */
      },
    });
  }

  // ------------------------------------------------------------------ view

  /** Recent deliveries and what became of them, for the settings screen. */
  async recent(limit = 20) {
    const [items, pending, failed] = await Promise.all([
      this.prisma.outboundEmail.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          to: true,
          template: true,
          subject: true,
          status: true,
          attempts: true,
          lastError: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      this.prisma.outboundEmail.count({ where: { status: 'PENDING' } }),
      this.prisma.outboundEmail.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      items: items.map((row) => ({
        ...row,
        sentAt: row.sentAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      pending,
      failed,
    };
  }
}

export function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
