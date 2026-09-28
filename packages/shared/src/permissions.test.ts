import { describe, expect, it } from 'vitest';
import { Role } from './enums';
import { Permission, ROLE_PERMISSIONS, can, canOnCase } from './permissions';

/**
 * Authorization is the one place where a regression is a security incident, so
 * the matrix is asserted explicitly rather than derived from the same data the
 * implementation uses.
 */
describe('RBAC matrix', () => {
  it('gives ADMIN every declared permission', () => {
    const all = Object.values(Permission);
    for (const permission of all) {
      expect(can(Role.ADMIN, permission), `ADMIN should have ${permission}`).toBe(true);
    }
  });

  it('never grants administrative permissions below ADMIN', () => {
    const adminOnly = [
      Permission.USER_MANAGE,
      Permission.ROLE_MANAGE,
      Permission.API_KEY_MANAGE,
      Permission.SETTINGS_MANAGE,
      Permission.CASE_DELETE,
    ];

    for (const role of [Role.SOC_LEAD, Role.ANALYST, Role.READ_ONLY]) {
      for (const permission of adminOnly) {
        expect(can(role, permission), `${role} must not have ${permission}`).toBe(false);
      }
    }
  });

  it('keeps READ_ONLY strictly read-only', () => {
    expect(ROLE_PERMISSIONS[Role.READ_ONLY]).toEqual([
      Permission.CASE_READ,
      Permission.ALERT_READ,
      Permission.DASHBOARD_READ,
    ]);
  });

  it('lets an analyst edit their own case but not someone else’s', () => {
    const analyst = { userId: 'u1', reporterId: 'u1', assigneeId: null };
    const foreign = { userId: 'u1', reporterId: 'u2', assigneeId: 'u3' };

    expect(
      canOnCase(Role.ANALYST, Permission.CASE_UPDATE_OWN, Permission.CASE_UPDATE_ANY, analyst),
    ).toBe(true);
    expect(
      canOnCase(Role.ANALYST, Permission.CASE_UPDATE_OWN, Permission.CASE_UPDATE_ANY, foreign),
    ).toBe(false);
  });

  it('treats the assignee as an owner', () => {
    const assigned = { userId: 'u1', reporterId: 'u2', assigneeId: 'u1' };
    expect(
      canOnCase(Role.ANALYST, Permission.CASE_CLOSE_OWN, Permission.CASE_CLOSE_ANY, assigned),
    ).toBe(true);
  });

  it('lets a SOC lead act on any case', () => {
    const foreign = { userId: 'lead', reporterId: 'u2', assigneeId: 'u3' };
    expect(
      canOnCase(Role.SOC_LEAD, Permission.CASE_UPDATE_OWN, Permission.CASE_UPDATE_ANY, foreign),
    ).toBe(true);
  });

  it('does not let a read-only user edit anything they reported', () => {
    const own = { userId: 'u1', reporterId: 'u1', assigneeId: 'u1' };
    expect(
      canOnCase(Role.READ_ONLY, Permission.CASE_UPDATE_OWN, Permission.CASE_UPDATE_ANY, own),
    ).toBe(false);
  });
});
