import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as client from 'openid-client';
import type { AuthPolicy, OidcConfig } from '@black-ticket/shared';
import type { AppEnv } from '../../../common/config/env.config';
import { decryptSecret, encryptSecret } from '../../../common/security/secret-box';

/** Keeps the client secret's key material apart from the TOTP seeds. */
const SECRET_PURPOSE = 'oidc';

/** Throws unless the policy actually carries provider settings. */
export function requireOidc(policy: AuthPolicy): OidcConfig {
  if (!policy.oidc) {
    throw new ServiceUnavailableException('Single sign-on is not configured.');
  }
  return policy.oidc;
}

/**
 * Talks to the identity provider's discovery document.
 *
 * Discovery is a network round-trip whose answer barely ever changes, so the
 * resulting configuration is held in process and rebuilt only when the issuer
 * or client id behind it changes. An administrator editing the policy takes
 * effect on the next sign-in, without a restart.
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private cache: { key: string; configuration: client.Configuration } | null = null;

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  /**
   * Named for TOTP for historical reasons; secret-box derives a separate key
   * per purpose, so one master key serves both without them ever mixing.
   */
  private masterKey(): string {
    return this.config.get('TOTP_ENCRYPTION_KEY', { infer: true });
  }

  encryptClientSecret(plaintext: string): string {
    return encryptSecret(plaintext, this.masterKey(), SECRET_PURPOSE);
  }

  /** Drops the cached discovery so the next sign-in re-reads the provider. */
  invalidate(): void {
    this.cache = null;
  }

  async configurationFor(oidc: OidcConfig): Promise<client.Configuration> {
    const key = `${oidc.issuer}|${oidc.clientId}`;
    if (this.cache?.key === key) return this.cache.configuration;

    let secret: string;
    try {
      secret = decryptSecret(oidc.clientSecret, this.masterKey(), SECRET_PURPOSE);
    } catch {
      /*
       * A secret that will not decrypt means the encryption key changed under
       * the stored policy. That is a configuration fault, and it must not be
       * reported as the identity provider being unreachable.
       */
      throw new ServiceUnavailableException(
        'The stored client secret cannot be read. Re-enter it in the single sign-on settings.',
      );
    }

    const issuerUrl = new URL(oidc.issuer);

    /*
     * ---------------------------------------------------------------------
     * TEMPORARY - FOR THE LOCAL LAB. TO BE REMOVED.   [siem-lab-http-issuer]
     * ---------------------------------------------------------------------
     * openid-client v6 only allows HTTPS providers; an http:// issuer fails
     * with 'only requests to HTTPS are allowed' before anything reaches the
     * network. That behaviour is CORRECT: OIDC over plain HTTP carries the
     * token and the authorization code across the network in the clear.
     *
     * The local lab Keycloak runs on HTTP, so the restriction is relaxed here
     * for http://localhost (and 127.0.0.1 / ::1) only. For a remote provider
     * or any other host name the rule applies unchanged, so this exception
     * never reaches the internet.
     *
     * To remove: delete this block and the 5th argument below, and restore
     * the plain 'new URL(oidc.issuer)' form two lines up.
     * Marker to search for: siem-lab-http-issuer
     */
    const localHttpIssuer =
      issuerUrl.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(issuerUrl.hostname);

    if (localHttpIssuer) {
      this.logger.warn(
        `OIDC issuer is plain HTTP (${oidc.issuer}); HTTPS enforcement relaxed for localhost only.`,
      );
    }

    try {
      const configuration = await client.discovery(
        issuerUrl,
        oidc.clientId,
        undefined,
        client.ClientSecretPost(secret),
        // allowInsecureRequests covers discovery AND every later request made
        // with this Configuration, token exchange included.
        localHttpIssuer ? { execute: [client.allowInsecureRequests] } : undefined,
      );
      this.cache = { key, configuration };
      return configuration;
    } catch (error) {
      this.logger.error(
        `OIDC discovery failed for ${oidc.issuer}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        'The identity provider could not be reached. Check the issuer URL.',
      );
    }
  }

  /**
   * Reachability probe for the admin screen.
   *
   * Returns rather than throws: "could not connect" is an answer the settings
   * page renders, not an error it has to handle.
   */
  async probe(oidc: OidcConfig): Promise<{ ok: boolean; detail: string }> {
    try {
      const configuration = await this.configurationFor(oidc);
      return { ok: true, detail: `Discovered ${configuration.serverMetadata().issuer}` };
    } catch (error) {
      this.cache = null;
      return { ok: false, detail: error instanceof Error ? error.message : 'Discovery failed.' };
    }
  }

  /**
   * The identity provider redirects to the API; only this says which front end
   * that API belongs to, so it cannot be inferred from the request.
   */
  webBaseUrl(): string {
    return this.config.get('WEB_BASE_URL', { infer: true });
  }
}
