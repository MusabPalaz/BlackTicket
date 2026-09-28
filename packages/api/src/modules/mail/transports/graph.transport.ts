import type { GraphConfig } from '@black-ticket/shared';
import type { MailTransport, OutboundMessage } from './mail-transport';

const LOGIN_HOST = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Renewed a minute early, so a token cannot expire mid-batch. */
const EXPIRY_SKEW_MS = 60_000;
const TIMEOUT_MS = 20_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Sends through Microsoft Graph.
 *
 * This exists because Microsoft 365 disables SMTP AUTH by default: on those
 * tenants the mailbox the customer hands over cannot be used over SMTP at all,
 * and an application-permission Graph token is the supported way in.
 *
 * It needs an Entra app registration with the **application** permission
 * `Mail.Send`, granted admin consent. That permission covers every mailbox in
 * the tenant, which is why the sender is pinned to one configured address
 * rather than taken from the message.
 */
export class GraphTransport implements MailTransport {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: GraphConfig,
    private readonly clientSecret: string,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetch(
      `${LOGIN_HOST}/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Entra refused the client credentials: ${
          payload.error_description ?? payload.error ?? `HTTP ${response.status}`
        }`,
      );
    }

    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS,
    };
    return this.token.value;
  }

  /**
   * Proves the credentials *and* that the mailbox exists.
   *
   * A token alone would pass while the sender address is a typo, and the first
   * anyone would learn of it is a queue of messages failing at 3am.
   */
  async verify(): Promise<void> {
    const token = await this.accessToken();
    const response = await fetch(
      `${GRAPH}/users/${encodeURIComponent(this.config.senderUserId)}?$select=id,mail,userPrincipalName`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw new Error(await describeGraphError(response, `mailbox ${this.config.senderUserId}`));
    }
  }

  async send(message: OutboundMessage): Promise<{ messageId: string }> {
    const token = await this.accessToken();
    const response = await fetch(
      `${GRAPH}/users/${encodeURIComponent(this.config.senderUserId)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: 'Text', content: message.text },
            toRecipients: [{ emailAddress: { address: message.to } }],
          },
          // The application's own record is the outbound_email table; a copy in
          // a shared mailbox's Sent Items is noise nobody asked for.
          saveToSentItems: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw new Error(await describeGraphError(response, 'sendMail'));
    }

    /*
     * Graph answers 202 Accepted with no body and no identifier — it has taken
     * the message, not delivered it. There is no message id to record, and
     * inventing one would make the log claim a precision it does not have.
     */
    return { messageId: '' };
  }

  close(): void {
    // Nothing to close: every call is a fresh HTTPS request.
  }
}

async function describeGraphError(response: Response, what: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;

  const detail = body?.error?.message ?? `HTTP ${response.status}`;
  if (response.status === 403) {
    return `Graph refused ${what}: ${detail}. Check that the app registration has the Mail.Send application permission with admin consent.`;
  }
  if (response.status === 404) {
    return `Graph could not find ${what}: ${detail}.`;
  }
  return `Graph refused ${what}: ${detail}`;
}
