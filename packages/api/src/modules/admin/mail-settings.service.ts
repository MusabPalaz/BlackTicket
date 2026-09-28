import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AuditAction,
  DEFAULT_MAIL_SETTINGS,
  MailTransportKind,
  normalizeEmail,
  type GraphConfig,
  type MailSettings,
  type MailTransportConfig,
  type SmtpConfig,
} from '@black-ticket/shared';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';

interface Actor {
  id: string;
  ip: string | null;
  userAgent: string | null;
}

/** The settings as a screen may see them — never carrying a secret back. */
export interface MailSettingsView {
  enabled: boolean;
  kind: MailTransportKind | null;
  fromAddress: string | null;
  fromName: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    passwordConfigured: boolean;
  } | null;
  graph: {
    tenantId: string;
    clientId: string;
    senderUserId: string;
    clientSecretConfigured: boolean;
  } | null;
  updatedAt: string | null;
  pending: number;
  failed: number;
}

export interface UpdateMailInput {
  enabled: boolean;
  kind?: MailTransportKind;
  fromAddress?: string;
  fromName?: string;
  /** SMTP */
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  /** Microsoft Graph */
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  senderUserId?: string;
}

@Injectable()
export class MailSettingsService {
  constructor(
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private static toView(
    settings: MailSettings,
    counts: { pending: number; failed: number },
  ): MailSettingsView {
    const transport = settings.transport;
    const smtp = transport?.kind === MailTransportKind.SMTP ? transport : null;
    const graph = transport?.kind === MailTransportKind.GRAPH ? transport : null;

    return {
      enabled: settings.enabled,
      kind: transport?.kind ?? null,
      fromAddress: settings.fromAddress,
      fromName: settings.fromName,
      smtp: smtp
        ? {
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            username: smtp.username,
            passwordConfigured: smtp.password.length > 0,
          }
        : null,
      graph: graph
        ? {
            tenantId: graph.tenantId,
            clientId: graph.clientId,
            senderUserId: graph.senderUserId,
            clientSecretConfigured: graph.clientSecret.length > 0,
          }
        : null,
      updatedAt: settings.updatedAt,
      ...counts,
    };
  }

  async view(): Promise<MailSettingsView> {
    const [settings, recent] = await Promise.all([this.mail.getSettings(), this.mail.recent(0)]);
    return MailSettingsService.toView(settings, { pending: recent.pending, failed: recent.failed });
  }

  async update(input: UpdateMailInput, actor: Actor): Promise<MailSettingsView> {
    const current = await this.mail.getSettings();
    const kind = input.kind ?? current.transport?.kind ?? MailTransportKind.SMTP;

    const fromAddress = input.fromAddress ? normalizeEmail(input.fromAddress) : current.fromAddress;
    if (fromAddress) await this.mail.assertSenderAllowed(fromAddress);

    const transport =
      kind === MailTransportKind.GRAPH
        ? this.buildGraph(current.transport, input)
        : this.buildSmtp(current.transport, input);

    if (input.enabled) {
      if (!transport) {
        throw new BadRequestException('Configure the mail transport before switching sending on.');
      }
      if (!fromAddress) {
        throw new BadRequestException('A sender address is required.');
      }
    }

    const next: MailSettings = {
      ...DEFAULT_MAIL_SETTINGS,
      enabled: input.enabled,
      fromAddress: fromAddress ?? null,
      fromName: input.fromName?.trim() || current.fromName,
      transport,
      updatedAt: new Date().toISOString(),
      updatedById: actor.id,
    };

    await this.mail.saveSettings(next);

    const counts = await this.mail.recent(0);
    await this.audit.record({
      action: AuditAction.SETTINGS_CHANGED,
      entityType: 'SystemSetting',
      entityId: 'mail.settings',
      actorId: actor.id,
      actorIp: actor.ip,
      actorUserAgent: actor.userAgent,
      // Redacted on both sides: the audit trail is not a place to leak a secret.
      before: MailSettingsService.toView(current, { pending: 0, failed: 0 }),
      after: MailSettingsService.toView(next, { pending: 0, failed: 0 }),
    });

    return MailSettingsService.toView(next, counts);
  }

  /**
   * Folds submitted fields onto what is stored.
   *
   * An omitted secret means "keep the one you have" — the screen is never
   * given it back, so demanding it on every save would force an administrator
   * to re-type a client secret to correct a port number.
   *
   * The previous transport is only reused as a source of defaults when it was
   * the same kind: an SMTP password is not a Graph client secret, and carrying
   * one across would store a credential that cannot possibly work.
   */
  private buildSmtp(
    previous: MailTransportConfig | null,
    input: UpdateMailInput,
  ): MailTransportConfig | null {
    const stored = previous?.kind === MailTransportKind.SMTP ? previous : null;

    const host = input.host?.trim() || stored?.host;
    const username = input.username?.trim() || stored?.username;
    const password = input.password ? this.mail.encryptSecretValue(input.password) : stored?.password;
    if (!host && !username && !password) return null;

    if (!host || !username) {
      throw new BadRequestException('SMTP needs a host and a username.');
    }
    if (!password) {
      throw new BadRequestException('A mailbox password is required the first time.');
    }

    const port = input.port ?? stored?.port ?? 587;
    return {
      kind: MailTransportKind.SMTP,
      host,
      port,
      secure: input.secure ?? stored?.secure ?? port === 465,
      username,
      password,
    } satisfies SmtpConfig;
  }

  private buildGraph(
    previous: MailTransportConfig | null,
    input: UpdateMailInput,
  ): MailTransportConfig | null {
    const stored = previous?.kind === MailTransportKind.GRAPH ? previous : null;

    const tenantId = input.tenantId?.trim() || stored?.tenantId;
    const clientId = input.clientId?.trim() || stored?.clientId;
    const senderUserId = input.senderUserId?.trim() || stored?.senderUserId;
    const clientSecret = input.clientSecret
      ? this.mail.encryptSecretValue(input.clientSecret)
      : stored?.clientSecret;

    if (!tenantId && !clientId && !senderUserId && !clientSecret) return null;

    if (!tenantId || !clientId || !senderUserId) {
      throw new BadRequestException(
        'Microsoft Graph needs a tenant id, a client id and the mailbox to send as.',
      );
    }
    if (!clientSecret) {
      throw new BadRequestException('A client secret is required the first time.');
    }

    return {
      kind: MailTransportKind.GRAPH,
      tenantId,
      clientId,
      clientSecret,
      senderUserId,
    } satisfies GraphConfig;
  }
}
