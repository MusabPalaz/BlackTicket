/**
 * Whether the SLA sweep runs, and whether it is allowed to speak.
 *
 * The sweep marks breaches every minute and tells the people responsible. In a
 * team that works to SLA targets that is the point; in a team that does not, it
 * is a notification per overdue case per breach, and the bell stops meaning
 * anything. Neither is wrong, so it is a setting rather than a decision baked
 * into the product.
 *
 * The two switches are deliberately separate. Turning off the notifications
 * keeps the breach flags, so the dashboard SLA figures stay honest — an
 * administrator who only wants quiet should not have to give up the numbers.
 */
export interface SlaMonitoringPolicy {
  /** Runs the sweep at all. Off means no breach flags and no notifications. */
  enabled: boolean;
  /** Sends the breach, first-response and backlog notices. */
  notifications: boolean;
  updatedAt: string | null;
  updatedById: string | null;
}

/** Both on: what the product did before this was configurable. */
export const DEFAULT_SLA_MONITORING_POLICY: SlaMonitoringPolicy = {
  enabled: true,
  notifications: true,
  updatedAt: null,
  updatedById: null,
};

export const SLA_MONITORING_SETTING_KEY = 'sla.monitoring';
