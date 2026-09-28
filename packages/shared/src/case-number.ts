import { BRANDING } from './branding';

/**
 * Human-facing case reference: BT-2026-000123.
 *
 * The stored `number` is a plain database sequence — globally unique and never
 * reused. The year is only presentation, taken from the creation date, so two
 * cases can never collide even across a year boundary.
 */
export function formatCaseNumber(number: number, createdAt: Date | string): string {
  const year = new Date(createdAt).getUTCFullYear();
  return `${BRANDING.casePrefix}-${year}-${String(number).padStart(6, '0')}`;
}

/** Parses a reference back to its sequence number; null when it is not one. */
export function parseCaseNumber(reference: string): number | null {
  const match = new RegExp(`^${BRANDING.casePrefix}-(\\d{4})-(\\d{1,9})$`, 'i').exec(
    reference.trim(),
  );
  if (!match?.[2]) return null;
  const parsed = Number(match[2]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
