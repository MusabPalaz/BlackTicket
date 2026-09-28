import { SetMetadata } from '@nestjs/common';
import type { ApiKeyScope } from '@black-ticket/shared';

export const API_KEY_SCOPES_KEY = 'auth:apiKeyScopes';

/**
 * The scopes a machine key must carry to reach a route.
 *
 * Declared per route rather than checked inside handlers, so that adding an
 * endpoint cannot silently inherit another integration's authority.
 */
export const RequireApiKeyScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(API_KEY_SCOPES_KEY, scopes);
