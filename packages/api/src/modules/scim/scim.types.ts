import { HttpException } from '@nestjs/common';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/**
 * An error in the shape RFC 7644 requires.
 *
 * A provisioning service reads the body, not just the status: Entra surfaces
 * `detail` verbatim in its provisioning log, which is the only place an
 * administrator will ever see why a user failed to sync.
 */
export class ScimException extends HttpException {
  constructor(status: number, detail: string, scimType?: string) {
    super(
      {
        schemas: [SCIM_ERROR_SCHEMA],
        detail,
        status: String(status),
        ...(scimType ? { scimType } : {}),
      },
      status,
    );
  }
}

export interface ScimName {
  formatted?: string;
  givenName?: string;
  familyName?: string;
}

export interface ScimEmail {
  value?: string;
  type?: string;
  primary?: boolean;
}

/** Only the parts of the core User schema this system actually stores. */
export interface ScimUser {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  name: ScimName;
  displayName: string;
  emails: ScimEmail[];
  active: boolean;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location: string;
  };
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  Resources: T[];
}

/** A single `attr op "value"` term. Nothing else is supported, on purpose. */
export interface ScimFilter {
  attribute: string;
  value: string;
}

/**
 * Parses the sliver of SCIM filter syntax provisioning clients actually send.
 *
 * The grammar in RFC 7644 is large; Entra uses one form of it —
 * `userName eq "someone@corp.com"` — to ask "do you already have this person?".
 * Implementing the whole grammar to serve one question would be a liability,
 * so anything else is refused loudly rather than silently mismatched.
 */
export function parseFilter(filter: string | undefined): ScimFilter | null {
  if (!filter) return null;

  const match = /^\s*([\w.]+)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
  if (!match) {
    throw new ScimException(
      400,
      `Only simple 'attribute eq "value"' filters are supported; received: ${filter}`,
      'invalidFilter',
    );
  }

  return { attribute: (match[1] ?? '').toLowerCase(), value: match[2] ?? '' };
}

/**
 * Entra sends booleans as the strings "True"/"False" in PATCH values, which is
 * outside the spec but universal enough that refusing it would simply mean
 * deactivation never works.
 */
export function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
  }
  return null;
}
