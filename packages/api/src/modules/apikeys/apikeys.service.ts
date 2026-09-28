import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { ApiKey } from '@prisma/client';
import { ApiKeyScope, AuditAction } from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Keys are shown once, at creation, and stored only as a SHA-256 digest.
 *
 * Unlike a password, an API key is high-entropy random, so a fast hash is the
 * right choice: it is verified on every ingest request, and Argon2 there would
 * cost 100 ms of CPU per alert for no security gain.
 */
const KEY_PREFIX = 'bt_ingest';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static digest(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  async list() {
    const rows = await this.prisma.apiKey.findMany({
      include: {
        createdBy: { select: { id: true, username: true, fullName: true } },
        _count: { select: { alerts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        createdBy: row.createdBy,
        /* What a delete would detach: alerts outlive the key that carried them in. */
        alertCount: row._count.alerts,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async create(
    input: { name: string; expiresAt?: string; scopes?: ApiKeyScope[] },
    actor: { id: string; ip: string | null; userAgent: string | null },
  ) {
    const secret = randomBytes(32).toString('base64url');
    const plaintext = `${KEY_PREFIX}_${secret}`;
    const prefix = plaintext.slice(0, KEY_PREFIX.length + 7);

    const key = await this.prisma.apiKey.create({
      data: {
        name: input.name.trim(),
        keyHash: ApiKeysService.digest(plaintext),
        prefix,
        /*
         * Defaulted rather than required: every key that existed before scopes
         * did was an ingest key, and the callers that mint them should not have
         * to change to keep working.
         */
        scopes: input.scopes?.length ? input.scopes : [ApiKeyScope.INGEST_WRITE],
        createdById: actor.id,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });

    await this.audit.record({
      action: AuditAction.API_KEY_CREATED,
      entityType: 'ApiKey',
      entityId: key.id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      after: { name: key.name, prefix: key.prefix, scopes: key.scopes },
    });

    return {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      expiresAt: key.expiresAt?.toISOString() ?? null,
      /** The only time the full key is ever available. */
      key: plaintext,
    };
  }

  async revoke(
    id: string,
    actor: { id: string; ip: string | null; userAgent: string | null },
  ): Promise<void> {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');

    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });

    await this.audit.record({
      action: AuditAction.API_KEY_REVOKED,
      entityType: 'ApiKey',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { name: key.name, prefix: key.prefix },
    });
  }

  /**
   * Hard delete, so the list does not accumulate keys that are long out of use.
   *
   * Revocation is the safety catch: a key that could still authenticate an
   * ingest is refused here, so tidying up cannot quietly cut off a live SIEM.
   * The audit entry outlives the row, and is the only place the name and
   * prefix survive.
   */
  async remove(
    id: string,
    actor: { id: string; ip: string | null; userAgent: string | null },
  ): Promise<void> {
    const key = await this.prisma.apiKey.findUnique({
      where: { id },
      include: { _count: { select: { alerts: true } } },
    });
    if (!key) throw new NotFoundException('API key not found');

    const expired = key.expiresAt !== null && key.expiresAt.getTime() <= Date.now();
    if (!key.revokedAt && !expired) {
      throw new ConflictException('This key still works. Revoke it first, then delete it.');
    }

    await this.prisma.apiKey.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.API_KEY_DELETED,
      entityType: 'ApiKey',
      entityId: id,
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      before: { name: key.name, prefix: key.prefix },
      /*
       * Alerts are not deleted with the key — the schema nulls their apiKeyId
       * instead — so this count is all that is left of where they came from.
       */
      metadata: { detachedAlerts: key._count.alerts },
    });
  }

  /** Resolves a presented key, or null when it is unknown, revoked or expired. */
  async resolve(plaintext: string): Promise<ApiKey | null> {
    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: ApiKeysService.digest(plaintext) },
    });
    if (!key) return null;
    if (key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
    return key;
  }

  /**
   * "Last used" is written at most once a minute per key: it is an operational
   * hint, not an audit record, and a write on every alert would be pure noise
   * against a busy SIEM.
   */
  async touch(key: ApiKey): Promise<void> {
    if (key.lastUsedAt && Date.now() - key.lastUsedAt.getTime() < 60_000) return;
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  }
}
