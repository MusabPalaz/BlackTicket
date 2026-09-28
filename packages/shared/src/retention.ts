/**
 * How long each class of data is kept.
 *
 * Split by what the data *is*, not by which table it happens to live in: an
 * expired session and a read notification are both operational residue, while
 * the audit trail is evidence. They cannot sensibly share a number.
 *
 * Every value is a day count. `null` means "keep indefinitely" and is the
 * default everywhere it appears — a retention policy that starts by deleting
 * things nobody asked it to delete is a data-loss incident with a schedule.
 */
export interface RetentionPolicy {
  /**
   * Half-finished federated sign-ins. The rows are ten-minute credentials; the
   * only reason to keep them at all is to look at a failed sign-in afterwards.
   */
  ssoLoginAttemptDays: number;
  /** Refresh tokens that have expired or been revoked and can no longer authenticate. */
  expiredSessionDays: number;
  /** Notifications their owner has already read. Unread ones are never touched. */
  readNotificationDays: number;
  /** Delivery records for outbound mail. */
  outboundEmailDays: number;
  /**
   * Accounts and cases that were soft-deleted this long ago get removed for
   * good. `null` keeps them, which is the default: a case carries the record of
   * an investigation, and "deleted" in this system already means invisible.
   */
  softDeletedDays: number | null;
  /**
   * The audit trail.
   *
   * `null` — keep forever — is the default and the only responsible one to ship.
   * How long a security platform must retain its trail is a legal question with
   * a different answer in every organisation, and guessing it wrong destroys
   * evidence on a timer. Setting a number here does NOT make the application
   * delete anything: the table is append-only at the database level, so pruning
   * it is a deliberate, privileged maintenance operation that also archives
   * what it removes.
   */
  auditLogDays: number | null;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  ssoLoginAttemptDays: 7,
  expiredSessionDays: 30,
  readNotificationDays: 90,
  outboundEmailDays: 90,
  softDeletedDays: null,
  auditLogDays: null,
};

export const RETENTION_SETTING_KEY = 'retention.policy';

/** Bounds a caller may not exceed, so a typo cannot mean "delete everything". */
export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 3650;

export function isValidRetentionDays(value: number | null): boolean {
  if (value === null) return true;
  return Number.isInteger(value) && value >= RETENTION_MIN_DAYS && value <= RETENTION_MAX_DAYS;
}

/** What the housekeeping job may act on by itself, and what it may not. */
export const AUTOMATIC_RETENTION_CLASSES = [
  'ssoLoginAttemptDays',
  'expiredSessionDays',
  'readNotificationDays',
  'outboundEmailDays',
  'softDeletedDays',
] as const satisfies readonly (keyof RetentionPolicy)[];
