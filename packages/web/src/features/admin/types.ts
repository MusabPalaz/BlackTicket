import type { Permission, Role } from '@black-ticket/shared';

export interface AccountRow {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  tags: string[];
  isRecoveryAccount: boolean;
  permissions?: Permission[];
}

export interface AccountsPage extends Paginated<AccountRow> {
  /** False until a break-glass administrator has been seeded. */
  hasRecoveryAccount: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface AccountDetail {
  user: AccountRow;
  activeSessions: number;
  lastLoginIp: string | null;
  lockedUntil: string | null;
  failedLoginCount: number;
  createdAt: string;
  assignedCases: Record<string, number>;
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    ip: string | null;
    at: string;
  }[];
}

export interface ImportRowResult {
  line: number;
  username: string;
  status: 'created' | 'skipped' | 'error';
  message?: string;
  temporaryPassword?: string;
  email?: string;
  role?: Role;
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  skipped: number;
  errors: number;
  rows: ImportRowResult[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string; username: string; fullName: string } | null;
  actorIp: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

export interface SlaPolicyRow {
  id: string;
  severity: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  isActive: boolean;
}
