/**
 * Single source of truth for product naming.
 *
 * The platform is meant to be reused across environments, so nothing else in
 * the codebase should hardcode the product name — import from here instead.
 */
export const BRANDING = {
  productName: 'Black Ticket',
  shortName: 'BT',
  /** Prefix used in human-readable case numbers: BT-2026-000123 */
  casePrefix: 'BT',
  tagline: 'SOC Case Management & IOC Correlation',
} as const;

export type Branding = typeof BRANDING;
