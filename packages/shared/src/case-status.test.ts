import { describe, expect, it } from 'vitest';
import { CaseStatus } from './enums';
import { CASE_STATUS_TRANSITIONS, canTransition, isOpen } from './case-status';
import { formatCaseNumber, parseCaseNumber } from './case-number';

describe('case status machine', () => {
  it('never allows a self-transition', () => {
    for (const status of Object.values(CaseStatus)) {
      expect(canTransition(status, status), `${status} to itself`).toBe(false);
    }
  });

  it('cannot jump straight from NEW to CLOSED', () => {
    // Closing has to pass through the close endpoint, which records a
    // resolution and a summary; a direct jump would lose both.
    expect(canTransition(CaseStatus.NEW, CaseStatus.CLOSED)).toBe(false);
  });

  it('cannot move backwards to NEW', () => {
    for (const from of [CaseStatus.IN_PROGRESS, CaseStatus.PENDING, CaseStatus.RESOLVED, CaseStatus.CLOSED]) {
      expect(canTransition(from, CaseStatus.NEW), `${from} to NEW`).toBe(false);
    }
  });

  it('allows the normal working path', () => {
    expect(canTransition(CaseStatus.NEW, CaseStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(CaseStatus.IN_PROGRESS, CaseStatus.PENDING)).toBe(true);
    expect(canTransition(CaseStatus.PENDING, CaseStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(CaseStatus.IN_PROGRESS, CaseStatus.RESOLVED)).toBe(true);
    expect(canTransition(CaseStatus.RESOLVED, CaseStatus.CLOSED)).toBe(true);
  });

  it('allows reopening from a terminal status', () => {
    expect(canTransition(CaseStatus.CLOSED, CaseStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(CaseStatus.RESOLVED, CaseStatus.IN_PROGRESS)).toBe(true);
  });

  it('declares every status in the table', () => {
    for (const status of Object.values(CaseStatus)) {
      expect(CASE_STATUS_TRANSITIONS[status], status).toBeDefined();
    }
  });

  it('treats only pre-resolution statuses as open', () => {
    expect(isOpen(CaseStatus.NEW)).toBe(true);
    expect(isOpen(CaseStatus.IN_PROGRESS)).toBe(true);
    expect(isOpen(CaseStatus.PENDING)).toBe(true);
    expect(isOpen(CaseStatus.RESOLVED)).toBe(false);
    expect(isOpen(CaseStatus.CLOSED)).toBe(false);
  });
});

describe('case references', () => {
  it('formats with the creation year and zero padding', () => {
    expect(formatCaseNumber(123, '2026-08-20T10:00:00Z')).toBe('BT-2026-000123');
    expect(formatCaseNumber(1, new Date('2027-01-01T00:00:00Z'))).toBe('BT-2027-000001');
  });

  it('does not truncate numbers past the padding width', () => {
    expect(formatCaseNumber(1_234_567, '2026-08-20T10:00:00Z')).toBe('BT-2026-1234567');
  });

  it('round-trips through the parser', () => {
    const reference = formatCaseNumber(4_242, '2026-08-20T10:00:00Z');
    expect(parseCaseNumber(reference)).toBe(4_242);
    expect(parseCaseNumber(reference.toLowerCase())).toBe(4_242);
  });

  it('rejects things that are not references', () => {
    for (const value of ['BT-2026', '2026-000123', 'XX-2026-000123', 'BT-26-1', '']) {
      expect(parseCaseNumber(value), value).toBeNull();
    }
  });
});
