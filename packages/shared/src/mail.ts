/**
 * Outbound e-mail settings.
 *
 * The application has no mail server of its own. The organisation installing
 * it supplies a mailbox on its own domain, and everything the system sends
 * leaves from that address — which is also why the sender is required to sit
 * inside the configured organisation domain.
 */

export const MailTransportKind = {
  /** Works with any provider that still allows password authentication. */
  SMTP: 'smtp',
  /**
   * Not implemented yet. Named here because Microsoft 365 disables SMTP AUTH
   * by default, so a tenant on M365 will need this rather than SMTP, and the
   * settings shape should not have to change when it arrives.
   */
  GRAPH: 'graph',
} as const;
export type MailTransportKind = (typeof MailTransportKind)[keyof typeof MailTransportKind];

export interface SmtpConfig {
  kind: typeof MailTransportKind.SMTP;
  host: string;
  port: number;
  /** True for implicit TLS (465). False means STARTTLS on 587. */
  secure: boolean;
  username: string;
  /** secret-box ciphertext. Never returned to a client. */
  password: string;
}

export interface GraphConfig {
  kind: typeof MailTransportKind.GRAPH;
  tenantId: string;
  clientId: string;
  /** secret-box ciphertext. Never returned to a client. */
  clientSecret: string;
  /** The mailbox to send as, by object id or userPrincipalName. */
  senderUserId: string;
}

export type MailTransportConfig = SmtpConfig | GraphConfig;

export interface MailSettings {
  /** Off by default; nothing is sent until an administrator turns it on. */
  enabled: boolean;
  transport: MailTransportConfig | null;
  fromAddress: string | null;
  fromName: string;
  updatedAt: string | null;
  updatedById: string | null;
}

export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  enabled: false,
  transport: null,
  fromAddress: null,
  fromName: 'Black Ticket',
  updatedAt: null,
  updatedById: null,
};

export const MAIL_SETTINGS_KEY = 'mail.settings';

/** Whether mail is both switched on and configured well enough to attempt. */
export function isMailReady(settings: MailSettings): boolean {
  return settings.enabled && settings.transport !== null && settings.fromAddress !== null;
}

/**
 * The messages this system sends.
 *
 * All operational: things that happened inside Black Ticket, which no identity
 * provider and no other system would ever tell the person about. Credentials
 * are deliberately absent — under SSO the directory owns passwords and second
 * factors, and this application never sees either.
 */
export const MailTemplate = {
  CASE_ASSIGNED: 'case-assigned',
  SLA_BREACH: 'sla-breach',
  ALERT_BACKLOG: 'alert-backlog',
  TEST: 'test',
} as const;
export type MailTemplate = (typeof MailTemplate)[keyof typeof MailTemplate];
