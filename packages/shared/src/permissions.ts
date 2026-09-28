import { Role } from './enums';

/**
 * The single source of truth for authorization.
 *
 * The API enforces this matrix in a guard; the web client uses the exact same
 * map to decide which controls to render. Hiding a button in the UI is a
 * usability affordance, never a security control — every protected endpoint
 * re-checks the permission server-side.
 */
export const Permission = {
  CASE_READ: 'case:read',
  CASE_CREATE: 'case:create',
  /** Edit a case you reported or are assigned to. */
  CASE_UPDATE_OWN: 'case:update:own',
  /** Edit any case regardless of ownership. */
  CASE_UPDATE_ANY: 'case:update:any',
  /** Assign a case to yourself. */
  CASE_ASSIGN_SELF: 'case:assign:self',
  /** Assign a case to anyone. */
  CASE_ASSIGN_ANY: 'case:assign:any',
  CASE_CLOSE_OWN: 'case:close:own',
  CASE_CLOSE_ANY: 'case:close:any',
  CASE_DELETE: 'case:delete',
  CASE_LINK: 'case:link',

  TASK_MANAGE: 'task:manage',
  OBSERVABLE_MANAGE: 'observable:manage',

  ALERT_READ: 'alert:read',
  ALERT_IMPORT: 'alert:import',
  ALERT_IGNORE: 'alert:ignore',

  DASHBOARD_READ: 'dashboard:read',

  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  API_KEY_MANAGE: 'apikey:manage',
  AUDIT_READ: 'audit:read',
  SETTINGS_MANAGE: 'settings:manage',
  /** Categories, SLA policies and the correlation whitelist. */
  TAXONOMY_MANAGE: 'taxonomy:manage',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ANALYST_PERMISSIONS: readonly Permission[] = [
  Permission.CASE_READ,
  Permission.CASE_CREATE,
  Permission.CASE_UPDATE_OWN,
  Permission.CASE_ASSIGN_SELF,
  Permission.CASE_CLOSE_OWN,
  Permission.CASE_LINK,
  Permission.TASK_MANAGE,
  Permission.OBSERVABLE_MANAGE,
  Permission.ALERT_READ,
  Permission.ALERT_IMPORT,
  Permission.ALERT_IGNORE,
  Permission.DASHBOARD_READ,
];

const SOC_LEAD_PERMISSIONS: readonly Permission[] = [
  ...ANALYST_PERMISSIONS,
  Permission.CASE_UPDATE_ANY,
  Permission.CASE_ASSIGN_ANY,
  Permission.CASE_CLOSE_ANY,
  Permission.AUDIT_READ,
  Permission.TAXONOMY_MANAGE,
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...SOC_LEAD_PERMISSIONS,
  Permission.CASE_DELETE,
  Permission.USER_MANAGE,
  Permission.ROLE_MANAGE,
  Permission.API_KEY_MANAGE,
  Permission.SETTINGS_MANAGE,
];

const READ_ONLY_PERMISSIONS: readonly Permission[] = [
  Permission.CASE_READ,
  Permission.ALERT_READ,
  Permission.DASHBOARD_READ,
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [Role.ADMIN]: ADMIN_PERMISSIONS,
  [Role.SOC_LEAD]: SOC_LEAD_PERMISSIONS,
  [Role.ANALYST]: ANALYST_PERMISSIONS,
  [Role.READ_ONLY]: READ_ONLY_PERMISSIONS,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAny(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

export function canAll(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => can(role, permission));
}

/**
 * Ownership-aware check for the `*_OWN` / `*_ANY` permission pairs.
 *
 * A case is "owned" by its reporter and by its current assignee — an analyst
 * who picked up someone else's case still has to be able to work on it.
 */
export function canOnCase(
  role: Role,
  ownPermission: Permission,
  anyPermission: Permission,
  context: { userId: string; reporterId: string; assigneeId: string | null },
): boolean {
  if (can(role, anyPermission)) return true;
  const isOwner =
    context.userId === context.reporterId || context.userId === context.assigneeId;
  return isOwner && can(role, ownPermission);
}
