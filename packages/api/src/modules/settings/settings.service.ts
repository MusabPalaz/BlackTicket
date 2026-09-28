import { Injectable } from '@nestjs/common';
import {
  AUTH_POLICY_SETTING_KEY,
  DEFAULT_AUTH_POLICY,
  DEFAULT_IDENTITY_DOMAIN_POLICY,
  DEFAULT_SLA_MONITORING_POLICY,
  IDENTITY_DOMAIN_SETTING_KEY,
  SLA_MONITORING_SETTING_KEY,
  type AuthPolicy,
  type IdentityDomainPolicy,
  type SlaMonitoringPolicy,
} from '@black-ticket/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Typed access to the `system_setting` key/value table.
 *
 * Settings are read on nearly every user-creating request, so values are cached
 * in process and invalidated on write. With a single API instance that is
 * exact; when a second instance is added the cache TTL bounds the staleness.
 */
@Injectable()
export class SettingsService {
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly TTL_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const value = (row?.value ?? fallback) as T;
    this.cache.set(key, { value, expiresAt: Date.now() + SettingsService.TTL_MS });
    return value;
  }

  async set<T>(key: string, value: T): Promise<T> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as never },
      create: { key, value: value as never },
    });
    this.cache.set(key, { value, expiresAt: Date.now() + SettingsService.TTL_MS });
    return value;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  getIdentityDomainPolicy(): Promise<IdentityDomainPolicy> {
    return this.get<IdentityDomainPolicy>(
      IDENTITY_DOMAIN_SETTING_KEY,
      DEFAULT_IDENTITY_DOMAIN_POLICY,
    );
  }

  setIdentityDomainPolicy(policy: IdentityDomainPolicy): Promise<IdentityDomainPolicy> {
    return this.set(IDENTITY_DOMAIN_SETTING_KEY, policy);
  }

  /**
   * Read on every sign-in, so it rides the same cache as the domain policy.
   * Absent from the table until an administrator turns SSO on, which is why
   * the fallback is the LOCAL default rather than an error.
   */
  getAuthPolicy(): Promise<AuthPolicy> {
    return this.get<AuthPolicy>(AUTH_POLICY_SETTING_KEY, DEFAULT_AUTH_POLICY);
  }

  setAuthPolicy(policy: AuthPolicy): Promise<AuthPolicy> {
    return this.set(AUTH_POLICY_SETTING_KEY, policy);
  }

  getSlaMonitoringPolicy(): Promise<SlaMonitoringPolicy> {
    return this.get<SlaMonitoringPolicy>(SLA_MONITORING_SETTING_KEY, DEFAULT_SLA_MONITORING_POLICY);
  }

  setSlaMonitoringPolicy(policy: SlaMonitoringPolicy): Promise<SlaMonitoringPolicy> {
    return this.set(SLA_MONITORING_SETTING_KEY, policy);
  }
}
