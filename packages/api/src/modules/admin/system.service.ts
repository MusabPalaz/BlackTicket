import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../auth/totp.service';
import { UsersService } from '../users/users.service';
import type { AdminActor } from './users-admin.service';

/** What a purge is allowed to touch, and how it finds the rows. */
export type PurgeTarget = 'deletedUsers' | 'deletedCases' | 'expiredSessions' | 'readNotifications';

export interface TableSize {
  table: string;
  rows: number;
  totalBytes: number;
}

/**
 * Housekeeping for the people who run the installation.
 *
 * Everything here is either a read or a deletion of rows the product has
 * already stopped showing. The audit trail is deliberately absent from the
 * purge targets: the database refuses UPDATE and DELETE on it for every role
 * including this one, so a button claiming to prune it would report success and
 * change nothing. What is offered instead is the measurement an operator needs
 * in order to decide, and the trail's own numbers.
 */
@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly totp: TotpService,
    private readonly users: UsersService,
  ) {}

  private static readonly TABLES = [
    'case',
    'audit_log',
    'observable',
    'case_observable',
    'alert',
    'notification',
    'refresh_token',
    'case_task',
    'task_log',
    'user',
  ];

  async health() {
    const startedAt = Date.now();
    let reachable = true;
    try {
      await this.prisma.ping();
    } catch {
      reachable = false;
    }
    const latencyMs = Date.now() - startedAt;

    const [sizeRow] = await this.prisma.$queryRaw<{ bytes: bigint }[]>`
      SELECT pg_database_size(current_database()) AS bytes
    `;

    const tables = await this.prisma.$queryRaw<
      { table: string; rows: bigint; total_bytes: bigint }[]
    >`
      SELECT relname AS table,
             n_live_tup AS rows,
             pg_total_relation_size(relid) AS total_bytes
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 12
    `;

    const [auditSpan] = await this.prisma.$queryRaw<
      { total: bigint; oldest: Date | null; newest: Date | null }[]
    >`
      SELECT COUNT(*) AS total,
             MIN("createdAt") AS oldest,
             MAX("createdAt") AS newest
      FROM "audit_log"
    `;

    return {
      database: {
        reachable,
        latencyMs,
        sizeBytes: Number(sizeRow?.bytes ?? 0),
      },
      tables: tables.map((row): TableSize => ({
        table: row.table,
        rows: Number(row.rows),
        totalBytes: Number(row.total_bytes),
      })),
      auditTrail: {
        total: Number(auditSpan?.total ?? 0),
        oldest: auditSpan?.oldest?.toISOString() ?? null,
        newest: auditSpan?.newest?.toISOString() ?? null,
        // Stated rather than implied: the screen must not offer a button the
        // database will silently refuse.
        appendOnly: true,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  /** How much each target would remove, without removing anything. */
  async purgeable(olderThanDays: number) {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

    const [deletedUsers, deletedCases, expiredSessions, readNotifications] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: { not: null, lt: cutoff } } }),
      this.prisma.case.count({ where: { deletedAt: { not: null, lt: cutoff } } }),
      this.prisma.refreshToken.count({
        where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { not: null, lt: cutoff } }] },
      }),
      this.prisma.notification.count({ where: { isRead: true, createdAt: { lt: cutoff } } }),
    ]);

    return {
      olderThanDays,
      cutoff: cutoff.toISOString(),
      deletedUsers,
      deletedCases,
      expiredSessions,
      readNotifications,
    };
  }

  /**
   * Removes rows the product has already retired.
   *
   * Only ever rows that are gone from the interface already — soft-deleted
   * records past the window, sessions that can no longer authenticate, and
   * notifications their owner has read. Nothing live is touched, and the purge
   * itself is written to the trail it cannot prune.
   */
  async purge(target: PurgeTarget, olderThanDays: number, actor: AdminActor) {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    let removed: number;

    if (target === 'deletedUsers') {
      const { count } = await this.prisma.user.deleteMany({
        where: { deletedAt: { not: null, lt: cutoff } },
      });
      removed = count;
    } else if (target === 'deletedCases') {
      const { count } = await this.prisma.case.deleteMany({
        where: { deletedAt: { not: null, lt: cutoff } },
      });
      removed = count;
    } else if (target === 'expiredSessions') {
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { not: null, lt: cutoff } }] },
      });
      removed = count;
    } else {
      const { count } = await this.prisma.notification.deleteMany({
        where: { isRead: true, createdAt: { lt: cutoff } },
      });
      removed = count;
    }

    this.logger.log(`purge ${target} older than ${olderThanDays}d removed ${removed} row(s)`);

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Maintenance',
      entityId: target,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      metadata: { target, olderThanDays, cutoff: cutoff.toISOString(), removed },
    });

    return { target, olderThanDays, removed };
  }

  /** Exactly what a reset would remove, and what it would leave standing. */
  async resetPreview() {
    const [cases, tasks, observables, alerts, notifications, links, auditEntries, users] =
      await Promise.all([
        this.prisma.case.count(),
        this.prisma.caseTask.count(),
        this.prisma.observable.count(),
        this.prisma.alert.count(),
        this.prisma.notification.count(),
        this.prisma.caseLink.count(),
        this.prisma.auditLog.count(),
        this.prisma.user.count({ where: { deletedAt: null } }),
      ]);

    return {
      removes: { cases, tasks, observables, alerts, notifications, links },
      keeps: {
        users,
        auditEntries,
        // Named so the screen can say what survives instead of implying
        // everything goes.
        configuration: ['categories', 'SLA policies', 'playbooks', 'whitelist', 'MITRE catalogue'],
      },
    };
  }

  /**
   * Removes every case, alert and indicator; keeps the people and the setup.
   *
   * Guarded by the operator's own second factor rather than a password: a
   * password is the thing most likely to be sitting in a browser on an unlocked
   * machine, which is exactly the situation this button must survive. An
   * administrator without a second factor cannot run it at all — there is no
   * fallback, because a fallback is the weakest link and this is the most
   * destructive action in the product.
   *
   * The audit trail is not touched. It cannot be, and it should not be: the
   * record of the reset has to outlive the reset.
   */
  async resetOperationalData(actor: AdminActor, code: string) {
    const user = await this.users.getByIdOrThrow(actor.id);

    if (!user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException(
        'Turn on two-factor authentication for your own account before running this.',
      );
    }
    if (!this.totp.verifyCode(user.totpSecret, code)) {
      throw new BadRequestException('That code did not match. Check your authenticator clock.');
    }

    const before = await this.resetPreview();

    // Cases cascade to their tasks, work logs, links, technique tags and
    // observable rows; the indicators themselves outlive the cases, so they go
    // separately.
    const removed = await this.prisma.$transaction(async (tx) => {
      const notifications = await tx.notification.deleteMany({});
      const alerts = await tx.alert.deleteMany({});
      const cases = await tx.case.deleteMany({});
      const observables = await tx.observable.deleteMany({});
      return {
        notifications: notifications.count,
        alerts: alerts.count,
        cases: cases.count,
        observables: observables.count,
      };
    });

    this.logger.warn(`operational data reset by ${user.username}: ${JSON.stringify(removed)}`);

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Maintenance',
      entityId: 'reset',
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: before.removes,
      after: removed,
      metadata: { scope: 'operational data', keptUsers: before.keeps.users },
    });

    return removed;
  }
}
