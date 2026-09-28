import { CaseStatus } from './enums';

/**
 * Allowed case status transitions.
 *
 * Enforced server-side so a case can never reach an inconsistent state through
 * a crafted request — e.g. jumping straight from NEW to CLOSED without a
 * resolution, or reopening from NEW.
 */
export const CASE_STATUS_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  [CaseStatus.NEW]: [CaseStatus.IN_PROGRESS, CaseStatus.PENDING, CaseStatus.RESOLVED],
  [CaseStatus.IN_PROGRESS]: [CaseStatus.PENDING, CaseStatus.RESOLVED],
  [CaseStatus.PENDING]: [CaseStatus.IN_PROGRESS, CaseStatus.RESOLVED],
  [CaseStatus.RESOLVED]: [CaseStatus.CLOSED, CaseStatus.IN_PROGRESS],
  [CaseStatus.CLOSED]: [CaseStatus.IN_PROGRESS],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_STATUS_TRANSITIONS[from].includes(to);
}

/** Statuses in which a case is still actively worked on. */
export function isOpen(status: CaseStatus): boolean {
  return (
    status === CaseStatus.NEW ||
    status === CaseStatus.IN_PROGRESS ||
    status === CaseStatus.PENDING
  );
}
