/**
 * What a machine key is allowed to do.
 *
 * Scopes exist because the same key mechanism now serves two very different
 * callers: a SIEM pushing alerts, and a corporate directory creating and
 * disabling accounts. A key minted for one must be useless for the other.
 */
export const ApiKeyScope = {
  /** Submit alerts to the ingest endpoint. */
  INGEST_WRITE: 'ingest:write',
  /** Provision and deprovision accounts over SCIM 2.0. */
  SCIM_MANAGE: 'scim:manage',
} as const;
export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export const API_KEY_SCOPES: readonly ApiKeyScope[] = Object.values(ApiKeyScope);

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** Human-facing description, used on the key screen. */
export const API_KEY_SCOPE_LABELS: Readonly<Record<ApiKeyScope, string>> = {
  [ApiKeyScope.INGEST_WRITE]: 'Submit alerts (SIEM / EDR)',
  [ApiKeyScope.SCIM_MANAGE]: 'Provision accounts (SCIM directory sync)',
};
