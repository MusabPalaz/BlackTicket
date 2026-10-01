import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction, CaseStatus, MailTemplate, formatCaseNumber } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertsService } from '../alerts/alerts.service';
import { SettingsService } from '../settings/settings.service';
import { slaBreachedWhere } from '../cases/sla-breach';

const OPEN_STATUSES = [CaseStatus.NEW, CaseStatus.IN_PROGRESS, CaseStatus.PENDING];

/** How many untriaged alerts before the leads are told the queue is growing. */
const ALERT_BACKLOG_THRESHOLD = 25;

/**
 * Watches the clocks.
 *
 * A breach is recorded on the case itself, not merely announced: the flag is
 * what later reporting counts, and a notification nobody read would otherwise
 * be the only trace that a target was missed.
 */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService,
    private readonly settings: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'sla-sweep' })
  async sweep(): Promise<void> {
    try {
      // Read every minute rather than cached at boot: turning the sweep off is
      // something an administrator does because it is being noisy right now.
      const policy = await this.settings.getSlaMonitoringPolicy();
      if (!policy.enabled) return;

      const [resolution, firstResponse] = await Promise.all([
        this.markResolutionBreaches(policy.notifications),
        this.warnMissedFirstResponse(policy.notifications),
      ]);
      if (policy.notifications) {
        await this.alerts.notifyQueueBacklog(ALERT_BACKLOG_THRESHOLD);
      }

      if (resolution || firstResponse) {
        this.logger.log(
          `SLA sweep: ${resolution} resolution breach(es), ${firstResponse} first-response warning(s)`,
        );
      }
    } catch (error) {
      // A failing sweep must never take the process down; it runs again in a
      // minute, and a silent stop would be worse than a noisy log line.
      this.logger.error('SLA sweep failed', error instanceof Error ? error.stack : String(error));
    }
  }

  private async recipientsFor(row: {
    assigneeId: string | null;
    reporterId: string;
  }): Promise<string[]> {
    const direct = [row.assigneeId, row.reporterId].filter((id): id is string => Boolean(id));
    if (row.assigneeId) return direct;

    // Nobody owns it, so the people who can hand it to someone are told.
    const leads = await this.prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE', role: { in: ['SOC_LEAD', 'ADMIN'] } },
      select: { id: true },
    });
    return [...direct, ...leads.map((lead) => lead.id)];
  }

  private async markResolutionBreaches(notify: boolean): Promise<number> {
    const overdue = await this.prisma.case.findMany({
      where: {
        deletedAt: null,
        status: { in: OPEN_STATUSES },
        slaBreached: false,
        slaDueAt: { lt: new Date() },
      },
      select: {
        id: true,
        number: true,
        title: true,
        createdAt: true,
        severity: true,
        slaDueAt: true,
        assigneeId: true,
        reporterId: true,
      },
      take: 200,
    });

    for (const row of overdue) {
      await this.prisma.case.update({ where: { id: row.id }, data: { slaBreached: true } });

      const reference = formatCaseNumber(row.number, row.createdAt);
      if (notify) {
        await this.notifications.createMany(await this.recipientsFor(row), {
          type: 'SLA_BREACH',
          title: `${reference} missed its resolution target`,
          body: `${row.severity} · ${row.title}`,
          link: `/cases/${row.id}`,
          dedupeWindowMinutes: 24 * 60,
          // The case someone owns has blown its target; that is precisely the
          // thing they need to hear about without being at the screen.
          email: MailTemplate.SLA_BREACH,
        });
      }

      await this.audit.record({
        action: AuditAction.UPDATE,
        entityType: 'Case',
        entityId: row.id,
        before: { slaBreached: false },
        after: { slaBreached: true },
        metadata: { reason: 'SLA_RESOLUTION_BREACH', dueAt: row.slaDueAt?.toISOString() },
      });
    }

    return overdue.length;
  }

  private async warnMissedFirstResponse(notify: boolean): Promise<number> {
    const waiting = await this.prisma.case.findMany({
      where: {
        deletedAt: null,
        status: { in: OPEN_STATUSES },
        firstResponseAt: null,
        slaFirstResponseDueAt: { lt: new Date() },
      },
      select: {
        id: true,
        number: true,
        title: true,
        createdAt: true,
        severity: true,
        assigneeId: true,
        reporterId: true,
      },
      take: 200,
    });

    // Nothing here but the notice — with notices off there is no work to do.
    if (!notify) return waiting.length;

    for (const row of waiting) {
      const reference = formatCaseNumber(row.number, row.createdAt);
      await this.notifications.createMany(await this.recipientsFor(row), {
        type: 'SLA_FIRST_RESPONSE',
        title: `${reference} has had no first response`,
        body: `${row.severity} · ${row.title}`,
        link: `/cases/${row.id}`,
        // Repeated once a day at most: the case stays overdue until someone
        // touches it, and a nag every minute would train people to ignore it.
        dedupeWindowMinutes: 24 * 60,
      });
    }

    return waiting.length;
  }

  /** Numbers for the dashboard's SLA tiles. */
  async pressure() {
    const now = new Date();
    const soon = new Date(Date.now() + 4 * 3_600_000);

    const [breached, dueSoon, awaitingFirstResponse] = await Promise.all([
      this.prisma.case.count({
        where: {
          deletedAt: null,
          status: { in: OPEN_STATUSES },
          ...slaBreachedWhere(true, now),
        },
      }),
      this.prisma.case.count({
        where: {
          deletedAt: null,
          status: { in: OPEN_STATUSES },
          slaBreached: false,
          slaDueAt: { gte: now, lte: soon },
        },
      }),
      this.prisma.case.count({
        where: { deletedAt: null, status: { in: OPEN_STATUSES }, firstResponseAt: null },
      }),
    ]);

    return { breached, dueSoon, awaitingFirstResponse };
  }
}
