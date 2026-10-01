/**
 * Domain enums shared by the API and the web client.
 *
 * These values are persisted in PostgreSQL as native enum types, so renaming a
 * member is a breaking change that requires a migration. Add new members at the
 * end; never reuse a removed name.
 */

export const Role = {
  ADMIN: 'ADMIN',
  SOC_LEAD: 'SOC_LEAD',
  ANALYST: 'ANALYST',
  READ_ONLY: 'READ_ONLY',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  LOCKED: 'LOCKED',
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const CaseStatus = {
  NEW: 'NEW',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING: 'PENDING',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

export const CaseResolution = {
  TRUE_POSITIVE: 'TRUE_POSITIVE',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  BENIGN: 'BENIGN',
  DUPLICATE: 'DUPLICATE',
  INDETERMINATE: 'INDETERMINATE',
} as const;
export type CaseResolution = (typeof CaseResolution)[keyof typeof CaseResolution];

export const Severity = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

/** Traffic Light Protocol — how far the information may be shared. */
export const Tlp = {
  WHITE: 'WHITE',
  GREEN: 'GREEN',
  AMBER: 'AMBER',
  RED: 'RED',
} as const;
export type Tlp = (typeof Tlp)[keyof typeof Tlp];

/** Permissible Actions Protocol — how aggressively an indicator may be probed. */
export const Pap = Tlp;
export type Pap = Tlp;

export const TaskStatus = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const ObservableType = {
  IP: 'IP',
  DOMAIN: 'DOMAIN',
  URL: 'URL',
  HASH_MD5: 'HASH_MD5',
  HASH_SHA1: 'HASH_SHA1',
  HASH_SHA256: 'HASH_SHA256',
  EMAIL: 'EMAIL',
  USERNAME: 'USERNAME',
  HOSTNAME: 'HOSTNAME',
  FILENAME: 'FILENAME',
  REGISTRY_KEY: 'REGISTRY_KEY',
  MUTEX: 'MUTEX',
  USER_AGENT: 'USER_AGENT',
  OTHER: 'OTHER',
} as const;
export type ObservableType = (typeof ObservableType)[keyof typeof ObservableType];

export const CaseLinkType = {
  /** Created automatically by the correlation engine from a shared observable. */
  CORRELATED: 'CORRELATED',
  DUPLICATE: 'DUPLICATE',
  RELATED: 'RELATED',
  PARENT: 'PARENT',
  CHILD: 'CHILD',
} as const;
export type CaseLinkType = (typeof CaseLinkType)[keyof typeof CaseLinkType];

export const AlertStatus = {
  NEW: 'NEW',
  TRIAGED: 'TRIAGED',
  IMPORTED: 'IMPORTED',
  IGNORED: 'IGNORED',
} as const;
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];

export const AuditAction = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  REFRESH_REUSE_DETECTED: 'REFRESH_REUSE_DETECTED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  TOTP_ENABLED: 'TOTP_ENABLED',
  TOTP_DISABLED: 'TOTP_DISABLED',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  ASSIGN: 'ASSIGN',
  CLOSE: 'CLOSE',
  REOPEN: 'REOPEN',
  LINK_CREATED: 'LINK_CREATED',
  LINK_REMOVED: 'LINK_REMOVED',
  ALERT_INGESTED: 'ALERT_INGESTED',
  ALERT_IMPORTED: 'ALERT_IMPORTED',
  ALERT_IGNORED: 'ALERT_IGNORED',
  ALERT_RESTORED: 'ALERT_RESTORED',
  USER_DISABLED: 'USER_DISABLED',
  USER_ENABLED: 'USER_ENABLED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  SESSIONS_REVOKED: 'SESSIONS_REVOKED',
  API_KEY_CREATED: 'API_KEY_CREATED',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  API_KEY_DELETED: 'API_KEY_DELETED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  DOMAIN_POLICY_CHANGED: 'DOMAIN_POLICY_CHANGED',
  DOMAIN_POLICY_LOCKED: 'DOMAIN_POLICY_LOCKED',
  DOMAIN_POLICY_UNLOCKED: 'DOMAIN_POLICY_UNLOCKED',
  AUTH_POLICY_CHANGED: 'AUTH_POLICY_CHANGED',
  SSO_LOGIN: 'SSO_LOGIN',
  SSO_LOGIN_DENIED: 'SSO_LOGIN_DENIED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  USER_PROVISIONED: 'USER_PROVISIONED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Ordered low → high, for sorting and SLA lookups. */
export const SEVERITY_ORDER: readonly Severity[] = [
  Severity.LOW,
  Severity.MEDIUM,
  Severity.HIGH,
  Severity.CRITICAL,
];

/** Statuses that mean the case no longer consumes SLA time. */
export const TERMINAL_CASE_STATUSES: readonly CaseStatus[] = [
  CaseStatus.RESOLVED,
  CaseStatus.CLOSED,
];
