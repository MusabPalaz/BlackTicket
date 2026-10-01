import type { ReactNode } from 'react';
import type { CaseResolution, CaseStatus, Severity, Tlp } from '@black-ticket/shared';
import { cx } from './ui';

/**
 * Severity and TLP colours follow the published conventions — analysts read
 * them at a glance and must never be surprised by a bespoke palette.
 */
const SEVERITY_STYLE: Record<Severity, string> = {
  LOW: 'border-[var(--color-severity-low)] text-[var(--color-severity-low)]',
  MEDIUM: 'border-[var(--color-severity-medium)] text-[var(--color-severity-medium)]',
  HIGH: 'border-[var(--color-severity-high)] text-[var(--color-severity-high)]',
  CRITICAL:
    'border-[var(--color-severity-critical)] bg-[var(--color-severity-critical)]/10 text-[var(--color-severity-critical)]',
};

const TLP_STYLE: Record<Tlp, string> = {
  WHITE: 'border-[var(--color-tlp-white)] text-[var(--color-tlp-white)]',
  GREEN: 'border-[var(--color-tlp-green)] text-[var(--color-tlp-green)]',
  AMBER: 'border-[var(--color-tlp-amber)] text-[var(--color-tlp-amber)]',
  RED: 'border-[var(--color-tlp-red)] text-[var(--color-tlp-red)]',
};

const STATUS_STYLE: Record<CaseStatus, string> = {
  NEW: 'border-[var(--color-accent)] text-[var(--color-accent)]',
  IN_PROGRESS:
    'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
  PENDING: 'border-[var(--color-severity-medium)] text-[var(--color-severity-medium)]',
  RESOLVED: 'border-[var(--color-tlp-green)] text-[var(--color-tlp-green)]',
  CLOSED: 'border-[var(--color-chip-border)] text-[var(--color-chip-text)]',
};

/**
 * A confirmed incident has to stand out in a list of closed cases — it is the
 * one someone may need to act on again — so TRUE POSITIVE is filled, not
 * outlined. Verdicts that cleared the case read as green.
 */
const RESOLUTION_STYLE: Record<CaseResolution, string> = {
  TRUE_POSITIVE:
    'border-[var(--color-severity-critical)] bg-[var(--color-severity-critical)] text-white',
  FALSE_POSITIVE: 'border-[var(--color-tlp-green)] text-[var(--color-tlp-green)]',
  BENIGN: 'border-[var(--color-tlp-green)] text-[var(--color-tlp-green)]',
  DUPLICATE: 'border-[var(--color-chip-border)] text-[var(--color-chip-text)]',
  INDETERMINATE: 'border-[var(--color-chip-border)] text-[var(--color-chip-text)]',
};

const chip = 'inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap';

export const SeverityChip = ({ value }: { value: Severity }) => (
  <span className={cx(chip, SEVERITY_STYLE[value])}>{value}</span>
);

export const ResolutionChip = ({ value }: { value: CaseResolution }) => (
  <span className={cx(chip, RESOLUTION_STYLE[value])}>{value.replace('_', ' ')}</span>
);

/** A plain label such as a category: no meaning in its colour, but readable. */
export const NeutralChip = ({ children }: { children: ReactNode }) => (
  <span className={cx(chip, 'border-[var(--color-chip-border)] text-[var(--color-chip-text)]')}>
    {children}
  </span>
);

export const TlpChip = ({ value, label = 'TLP' }: { value: Tlp; label?: string }) => (
  <span className={cx(chip, TLP_STYLE[value])}>
    {label}:{value}
  </span>
);

export const StatusChip = ({ value }: { value: CaseStatus }) => (
  <span className={cx(chip, STATUS_STYLE[value])}>{value.replace('_', ' ')}</span>
);

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact "in 3h" / "6h overdue" used by the SLA column. */
export function formatRelativeDeadline(
  due: string | null,
  closed: boolean,
): {
  label: string;
  overdue: boolean;
} {
  if (!due) return { label: '—', overdue: false };
  if (closed) return { label: formatDateTime(due), overdue: false };

  const deltaMinutes = Math.round((new Date(due).getTime() - Date.now()) / 60_000);
  const overdue = deltaMinutes < 0;
  const magnitude = Math.abs(deltaMinutes);

  const value =
    magnitude < 60
      ? `${magnitude}m`
      : magnitude < 1_440
        ? `${Math.round(magnitude / 60)}h`
        : `${Math.round(magnitude / 1_440)}d`;

  return { label: overdue ? `${value} overdue` : `in ${value}`, overdue };
}
