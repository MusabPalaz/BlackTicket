import type { Prisma } from '@prisma/client';
import { CaseStatus } from '@black-ticket/shared';

const OPEN_STATUSES = [CaseStatus.NEW, CaseStatus.IN_PROGRESS, CaseStatus.PENDING];

/**
 * Whether a case has missed its resolution target, as a query.
 *
 * A closed case carries the verdict recorded when it was closed. An open one is
 * also judged against the clock, because the flag on it is only set by the SLA
 * sweep: that runs once a minute, works through a backlog 200 cases at a time,
 * and can be switched off — and none of that should let the dashboard say
 * "0 breached" above a list of overdue cases.
 *
 * Every count and every drill-down that talks about breaches goes through
 * here, so a number and the list behind it cannot disagree.
 */
export function slaBreachedWhere(breached: boolean, now = new Date()): Prisma.CaseWhereInput {
  if (breached) {
    return {
      OR: [{ slaBreached: true }, { status: { in: OPEN_STATUSES }, slaDueAt: { lt: now } }],
    };
  }
  // Spelled out rather than NOT(open AND overdue): with no due date the
  // comparison is NULL, and NOT(NULL) would quietly drop the case.
  return {
    slaBreached: false,
    OR: [{ status: { notIn: OPEN_STATUSES } }, { slaDueAt: null }, { slaDueAt: { gte: now } }],
  };
}
