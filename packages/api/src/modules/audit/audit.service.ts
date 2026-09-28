import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { AuditAction } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  actorIp?: string | null;
  actorUserAgent?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Writes the immutable trail.
 *
 * Recording never throws: an audit failure must not turn a successful login
 * into a 500. It is logged at error level instead, because a silently missing
 * audit record is itself a finding.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          actorId: entry.actorId ?? null,
          actorIp: entry.actorIp ?? null,
          actorUserAgent: entry.actorUserAgent ?? null,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          metadata: (entry.metadata ?? undefined) as never,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${entry.action} for ${entry.entityType}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Extracts the request context every audit entry carries. */
  static contextOf(request: Request): { actorIp: string | null; actorUserAgent: string | null } {
    return {
      actorIp: request.ip ?? null,
      actorUserAgent: request.get('user-agent') ?? null,
    };
  }
}
