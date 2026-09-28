import type { AlertStatus, ObservableType, Severity } from '@black-ticket/shared';

export interface AlertRecord {
  id: string;
  externalId: string;
  source: string;
  title: string;
  description: string;
  severity: Severity;
  status: AlertStatus;
  category: { id: string; slug: string; name: string } | null;
  observables: { type: ObservableType; value: string; isIoc?: boolean }[];
  mitre: string[];
  raw: unknown;
  case: { id: string; reference: string; title: string } | null;
  occurredAt: string;
  receivedAt: string;
}

export interface AlertSummary {
  alerts: Record<AlertStatus, number>;
  sla: { breached: number; dueSoon: number; awaitingFirstResponse: number };
  oldestUntriagedAt: string | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdBy: { id: string; username: string; fullName: string };
  /** Alerts ingested with this key; they survive it, minus the link back. */
  alertCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}
