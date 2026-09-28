import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuditAction,
  DEFAULT_RETENTION_POLICY,
  RETENTION_SETTING_KEY,
  type RetentionPolicy,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

export interface HousekeepingResult {
  ssoLoginAttempts: number;
  expiredSessions: number;
  readNotifications: number;
  outboundEmails: number;
  softDeletedUsers: number;
  softDeletedCases: number;
}

const EMPTY: HousekeepingResult = {
  ssoLoginAttempts: 0,
  expiredSessions: 0,
  readNotifications: 0,
  outboundEmails: 0,
  softDeletedUsers: 0,
  softDeletedCases: 0,
};

/**
 * Applies the retention policy to the data the application owns outright.
 *
 * Everything here is residue: sign-in attempts nobody finished, sessions that
 * can no longer authenticate, notifications already read, delivery records for
 * mail already sent. None of it is evidence and none of it is visible in the
 * interface, so removing it on a schedule costs nothing and keeps the database
 * from growing without limit.
 *
 * The audit trail is deliberately absent. It is append-only at the database
 * level — a DELETE against it does nothing rather than failing — so a job that
 * tried to prune it would report success having removed nothing. Pruning it is
 * a separate, privileged operation that archives before it deletes:
 * `scripts/maintenance/audit-archive.ps1`.
 */
@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  getPolicy(): Promise<RetentionPolicy> {
    return this.settings.get<RetentionPolicy>(RETENTION_SETTING_KEY, DEFAULT_RETENTION_POLICY);
  }

  setPolicy(policy: RetentionPolicy): Promise<RetentionPolicy> {
    return this.settings.set(RETENTION_SETTING_KEY, policy);
  }

  private cutoff(days: number | null): Date | null {
    return days === null ? null : new Date(Date.now() - days * 86_400_000);
  }

  /**
   * Runs at 4am, an hour after the mail prune, so two housekeeping jobs are
   * never competing for the same locks on a small server.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'retention-sweep' })
  async sweep(): Promise<HousekeepingResult> {
    try {
      const result = await this.run();
      const total = Object.values(result).reduce((sum, n) => sum + n, 0);
      if (total === 0) return result;

      this.logger.log(`Retention sweep removed ${total} row(s): ${JSON.stringify(result)}`);

      /*
       * Recorded even though nothing a person can see has changed. "Where did
       * that row go?" is asked about deletions far more often than about
       * writes, and the trail should be able to answer it.
       */
      await this.audit.record({
        action: AuditAction.DELETE,
        entityType: 'Maintenance',
        entityId: 'retention.sweep',
        metadata: { ...result, total },
      });

      return result;
    } catch (error) {
      // A failed sweep must not stop the scheduler; tomorrow's run catches up.
      this.logger.error(
        `Retention sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return EMPTY;
    }
  }

  /** The sweep itself, callable directly so an administrator can run it now. */
  async run(): Promise<HousekeepingResult> {
    const policy = await this.getPolicy();
    const result = { ...EMPTY };

    const ssoCutoff = this.cutoff(policy.ssoLoginAttemptDays);
    if (ssoCutoff) {
      const { count } = await this.prisma.ssoLoginAttempt.deleteMany({
        where: { createdAt: { lt: ssoCutoff } },
      });
      result.ssoLoginAttempts = count;
    }

    const sessionCutoff = this.cutoff(policy.expiredSessionDays);
    if (sessionCutoff) {
      // Only tokens that already cannot authenticate. A live session is never
      // ended by housekeeping — that would be a logout nobody asked for.
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: sessionCutoff } },
            { revokedAt: { not: null, lt: sessionCutoff } },
          ],
        },
      });
      result.expiredSessions = count;
    }

    const notificationCutoff = this.cutoff(policy.readNotificationDays);
    if (notificationCutoff) {
      const { count } = await this.prisma.notification.deleteMany({
        where: { isRead: true, createdAt: { lt: notificationCutoff } },
      });
      result.readNotifications = count;
    }

    const mailCutoff = this.cutoff(policy.outboundEmailDays);
    if (mailCutoff) {
      const { count } = await this.prisma.outboundEmail.deleteMany({
        where: { createdAt: { lt: mailCutoff }, status: { in: ['SENT', 'FAILED'] } },
      });
      result.outboundEmails = count;
    }

    /*
     * Off by default. Soft deletion in this system already means invisible, and
     * a case carries the record of an investigation; turning that into a hard
     * delete on a timer is a decision for the organisation, not a default.
     */
    const softCutoff = this.cutoff(policy.softDeletedDays);
    if (softCutoff) {
      const cases = await this.prisma.case.deleteMany({
        where: { deletedAt: { not: null, lt: softCutoff } },
      });
      result.softDeletedCases = cases.count;

      // Users after cases: an account holding a soft-deleted case cannot be
      // removed while that case still references it.
      const users = await this.prisma.user.deleteMany({
        where: { deletedAt: { not: null, lt: softCutoff } },
      });
      result.softDeletedUsers = users.count;
    }

    return result;
  }

  /**
   * What the next sweep would remove, without removing it.
   *
   * A retention policy people cannot see the effect of is one they will not
   * turn on.
   */
  async preview(): Promise<HousekeepingResult & { auditLogRows: number }> {
    const policy = await this.getPolicy();
    const result = { ...EMPTY, auditLogRows: 0 };

    const ssoCutoff = this.cutoff(policy.ssoLoginAttemptDays);
    if (ssoCutoff) {
      result.ssoLoginAttempts = await this.prisma.ssoLoginAttempt.count({
        where: { createdAt: { lt: ssoCutoff } },
      });
    }

    const sessionCutoff = this.cutoff(policy.expiredSessionDays);
    if (sessionCutoff) {
      result.expiredSessions = await this.prisma.refreshToken.count({
        where: {
          OR: [
            { expiresAt: { lt: sessionCutoff } },
            { revokedAt: { not: null, lt: sessionCutoff } },
          ],
        },
      });
    }

    const notificationCutoff = this.cutoff(policy.readNotificationDays);
    if (notificationCutoff) {
      result.readNotifications = await this.prisma.notification.count({
        where: { isRead: true, createdAt: { lt: notificationCutoff } },
      });
    }

    const mailCutoff = this.cutoff(policy.outboundEmailDays);
    if (mailCutoff) {
      result.outboundEmails = await this.prisma.outboundEmail.count({
        where: { createdAt: { lt: mailCutoff }, status: { in: ['SENT', 'FAILED'] } },
      });
    }

    const softCutoff = this.cutoff(policy.softDeletedDays);
    if (softCutoff) {
      result.softDeletedCases = await this.prisma.case.count({
        where: { deletedAt: { not: null, lt: softCutoff } },
      });
      result.softDeletedUsers = await this.prisma.user.count({
        where: { deletedAt: { not: null, lt: softCutoff } },
      });
    }

    /*
     * Counted but never removed here: this is what the archive script would
     * take, and showing the number is how an administrator finds out the trail
     * has grown to a size worth acting on.
     */
    const auditCutoff = this.cutoff(policy.auditLogDays);
    if (auditCutoff) {
      result.auditLogRows = await this.prisma.auditLog.count({
        where: { createdAt: { lt: auditCutoff } },
      });
    }

    return result;
  }
}
