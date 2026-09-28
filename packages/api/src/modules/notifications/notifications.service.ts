import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MailTemplate } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /**
   * Suppresses an identical notification for the same user within this many
   * minutes. The SLA sweep runs every minute; without this an overdue case
   * would produce a notification every minute until someone touched it.
   */
  dedupeWindowMinutes?: number;
  /**
   * Also send this by e-mail, using the named template.
   *
   * Opt-in per call rather than per type: most in-app notifications are for
   * when someone is already looking at the screen, and turning all of them
   * into mail is how a product teaches people to filter it away.
   */
  email?: MailTemplate;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async createMany(userIds: string[], input: NotificationInput): Promise<number> {
    if (userIds.length === 0) return 0;

    const unique = [...new Set(userIds)];
    let created = 0;

    for (const userId of unique) {
      if (input.dedupeWindowMinutes) {
        const since = new Date(Date.now() - input.dedupeWindowMinutes * 60_000);
        const recent = await this.prisma.notification.findFirst({
          where: {
            userId,
            type: input.type,
            link: input.link ?? null,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
        if (recent) continue;
      }

      await this.prisma.notification.create({
        data: {
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? '',
          link: input.link ?? null,
        },
      });
      created += 1;

      if (input.email) await this.queueMail(userId, input);
    }

    return created;
  }

  /**
   * Queued past the dedupe check, so the mail follows the same suppression the
   * in-app notification does.
   *
   * A failure here is swallowed on purpose: the notification is already
   * written, the person will see it in the application, and mail being
   * misconfigured must not turn an SLA sweep into a failing job.
   */
  private async queueMail(userId: string, input: NotificationInput): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, fullName: true, status: true, deletedAt: true },
      });
      if (!user || user.deletedAt || user.status === 'DISABLED') return;

      await this.mail.enqueue({
        template: input.email!,
        userId,
        to: user.email,
        fullName: user.fullName,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `Could not queue mail for notification ${input.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async list(userId: string, unreadOnly: boolean) {
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unread = await this.prisma.notification.count({ where: { userId, isRead: false } });

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        isRead: row.isRead,
        createdAt: row.createdAt.toISOString(),
      })),
      unread,
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    await this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }
}
