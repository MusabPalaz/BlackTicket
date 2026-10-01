import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';

type TransportKind = 'smtp' | 'graph';

interface MailSettingsView {
  enabled: boolean;
  kind: TransportKind | null;
  fromAddress: string | null;
  fromName: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    passwordConfigured: boolean;
  } | null;
  graph: {
    tenantId: string;
    clientId: string;
    senderUserId: string;
    clientSecretConfigured: boolean;
  } | null;
  updatedAt: string | null;
  pending: number;
  failed: number;
}

interface MailLogRow {
  id: string;
  to: string;
  template: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

const ENDPOINT = '/admin/settings/mail';

/** Compact status, meant to sit beside the domain policy. */
export function OutboundMailStatusCard() {
  const settings = useQuery({
    queryKey: ['mail-settings'],
    queryFn: () => api.get<MailSettingsView>(ENDPOINT),
  });

  const current = settings.data;

  return (
    <Card title="Outbound Mail">
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-content-muted)]">Sending</dt>
          <dd>{current?.enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-content-muted)]">Via</dt>
          <dd className="text-xs">
            {current?.kind === 'graph'
              ? 'Microsoft Graph'
              : current?.kind === 'smtp'
                ? 'SMTP'
                : '—'}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-content-muted)]">From</dt>
          <dd className="max-w-[60%] truncate font-mono text-xs">
            {current?.fromAddress ?? 'not configured'}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--color-content-muted)]">Queue</dt>
          <dd>
            {current ? `${current.pending} waiting` : '—'}
            {current && current.failed > 0 && (
              <span className="ml-2 text-[var(--color-severity-medium)]">
                {current.failed} failed
              </span>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/**
 * Mailbox settings.
 *
 * The application has no mail server: the organisation supplies a mailbox on
 * its own domain and everything leaves from that address. The sender is
 * therefore checked against the organisation domain — mail claiming to come
 * from the organisation should come from it, and SPF will insist anyway.
 */
export function OutboundMailSettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['mail-settings'],
    queryFn: () => api.get<MailSettingsView>(ENDPOINT),
  });

  if (settings.isLoading || !settings.data) {
    return (
      <Card title="Outbound Mail Settings">
        <p className="text-sm text-[var(--color-content-muted)]">Loading…</p>
      </Card>
    );
  }

  /* Keyed on the stored revision: a save remounts the form from what persisted. */
  return (
    <MailEditor
      key={settings.data.updatedAt ?? 'initial'}
      current={settings.data}
      onSaved={() => void queryClient.invalidateQueries({ queryKey: ['mail-settings'] })}
    />
  );
}

function MailEditor({ current, onSaved }: { current: MailSettingsView; onSaved: () => void }) {
  const [kind, setKind] = useState<TransportKind>(current.kind ?? 'smtp');
  const [tenantId, setTenantId] = useState(current.graph?.tenantId ?? '');
  const [clientId, setClientId] = useState(current.graph?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [senderUserId, setSenderUserId] = useState(current.graph?.senderUserId ?? '');
  const [host, setHost] = useState(current.smtp?.host ?? '');
  const [port, setPort] = useState(String(current.smtp?.port ?? 587));
  const [secure, setSecure] = useState(current.smtp?.secure ?? false);
  const [username, setUsername] = useState(current.smtp?.username ?? '');
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState(current.fromAddress ?? '');
  const [fromName, setFromName] = useState(current.fromName);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);

  function failed(caught: unknown) {
    setNotice(null);
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      api.put<MailSettingsView>(ENDPOINT, {
        enabled,
        kind,
        fromAddress,
        fromName,
        ...(kind === 'smtp'
          ? {
              host,
              port: Number(port) || 587,
              secure,
              username,
              ...(password ? { password } : {}),
            }
          : {
              tenantId,
              clientId,
              senderUserId,
              ...(clientSecret ? { clientSecret } : {}),
            }),
      }),
    onSuccess: (_result, enabled) => {
      setPassword('');
      setClientSecret('');
      setError(null);
      setNotice(enabled ? 'Sending is on.' : 'Saved. Sending stays off until you turn it on.');
      onSaved();
    },
    onError: failed,
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail: string }>(`${ENDPOINT}/test-connection`, {}),
    onSuccess: (result) => {
      setProbe(result);
      setError(null);
    },
    onError: failed,
  });

  const testSend = useMutation({
    mutationFn: () =>
      api.post<{ queued: boolean; sentInThisPass: number }>(`${ENDPOINT}/test-send`, {}),
    onSuccess: (result) => {
      setError(null);
      setNotice(
        result.sentInThisPass > 0
          ? 'Test message sent to your own address.'
          : 'Test message queued; it will go out on the next pass. Check the log below.',
      );
      onSaved();
    },
    onError: failed,
  });

  return (
    <>
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card
        title="Outbound Mail Settings"
        description="A mailbox on your own domain. Nothing is sent until you switch sending on."
      >
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate(current.enabled);
          }}
          className="space-y-4"
        >
          <Field
            label="Send through"
            hint="Microsoft 365 disables SMTP AUTH by default; those tenants need Graph."
          >
            <Select value={kind} onChange={(event) => setKind(event.target.value as TransportKind)}>
              <option value="smtp">SMTP</option>
              <option value="graph">Microsoft Graph (Microsoft 365)</option>
            </Select>
          </Field>

          {kind === 'graph' ? (
            <>
              <Alert tone="info">
                Needs an Entra app registration with the <strong>Mail.Send</strong> application
                permission and admin consent. That permission reaches every mailbox in the tenant,
                so the sender is pinned to the address below.
              </Alert>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Directory (tenant) id">
                  <Input
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    className="font-mono text-xs"
                    required
                  />
                </Field>
                <Field label="Application (client) id">
                  <Input
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    className="font-mono text-xs"
                    required
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Client secret"
                  hint={
                    current.graph?.clientSecretConfigured
                      ? 'Stored. Leave blank to keep it.'
                      : 'Required the first time.'
                  }
                >
                  <Input
                    type="password"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    autoComplete="new-password"
                    placeholder={current.graph?.clientSecretConfigured ? '••••••••' : ''}
                  />
                </Field>
                <Field label="Send as" hint="Object id or userPrincipalName of the mailbox">
                  <Input
                    value={senderUserId}
                    onChange={(event) => setSenderUserId(event.target.value)}
                    placeholder="soc-noreply@example.com"
                    className="font-mono text-xs"
                    required
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                <Field label="Host">
                  <Input
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                    placeholder="smtp.example.com"
                    className="font-mono text-xs"
                    required
                  />
                </Field>
                <Field label="Port">
                  <Input
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Encryption">
                  <Select
                    value={secure ? 'tls' : 'starttls'}
                    onChange={(event) => setSecure(event.target.value === 'tls')}
                  >
                    <option value="starttls">STARTTLS (587)</option>
                    <option value="tls">Implicit TLS (465)</option>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username">
                  <Input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="off"
                    className="font-mono text-xs"
                    required
                  />
                </Field>
                <Field
                  label="Password"
                  hint={
                    current.smtp?.passwordConfigured
                      ? 'Stored. Leave blank to keep it.'
                      : 'Required the first time.'
                  }
                >
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder={current.smtp?.passwordConfigured ? '••••••••' : ''}
                  />
                </Field>
              </div>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From address" hint="Must be inside one of the organisation domains">
              <Input
                value={fromAddress}
                onChange={(event) => setFromAddress(event.target.value)}
                placeholder="soc-noreply@example.com"
                className="font-mono text-xs"
                required
              />
            </Field>
            <Field label="From name">
              <Input value={fromName} onChange={(event) => setFromName(event.target.value)} />
            </Field>
          </div>

          {probe && <Alert tone={probe.ok ? 'success' : 'warning'}>{probe.detail}</Alert>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              loading={test.isPending}
              onClick={() => test.mutate()}
            >
              Test connection
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={testSend.isPending}
              onClick={() => testSend.mutate()}
            >
              Send test to me
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card title={current.enabled ? 'Turn Sending Off' : 'Turn Sending On'}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="min-w-0 flex-1 text-sm text-[var(--color-content-muted)]">
            {current.enabled
              ? 'Queued messages stop going out. Nothing already sent is affected.'
              : 'Case assignments and SLA breaches start reaching people by e-mail as well as in the app.'}
          </p>
          <Button
            variant={current.enabled ? 'secondary' : 'primary'}
            loading={save.isPending}
            onClick={() => save.mutate(!current.enabled)}
          >
            {current.enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      </Card>

      <MailLogCard />
    </>
  );
}

/**
 * The reference column entry for outbound mail.
 *
 * Answers what the form cannot: why there is no mail server of our own, what
 * actually triggers a message, and why the sender is constrained. Placed by
 * the page rather than by the settings card, so it can sit in the aside
 * alongside the other screens' documentation instead of trailing the form.
 */
export function OutboundMailDocsCard() {
  const prose = 'space-y-3 text-sm text-[var(--color-content-muted)]';
  return (
    <Card title="How Outbound Mail Works">
      <div className={prose}>
        <p>
          Black Ticket has no mail server of its own. You give it a mailbox on your own domain and
          everything it sends leaves from that address, through your mail provider — so the messages
          come from you, pass your own SPF and DMARC, and are subject to your own retention.
        </p>
        <p>
          Choose <span className="text-[var(--color-content)]">SMTP</span> if your provider still
          allows password authentication. Choose{' '}
          <span className="text-[var(--color-content)]">Microsoft Graph</span> for Microsoft 365,
          which disables SMTP authentication by default — on those tenants SMTP simply will not
          work, however correct the password is.
        </p>
        <p>
          The sender must sit inside one of the organisation domains. Accounts follow the same rule:
          mail claiming to come from the organisation should come from it.
        </p>
        <p>
          Messages are queued, never sent while someone waits. A mail host that is slow or down
          cannot make assigning a case slow or fail — the message sits in the queue and is retried,
          waiting longer between each attempt, and is given up on after five.
        </p>
        <p>
          What triggers one: a case being{' '}
          <span className="text-[var(--color-content)]">assigned to somebody else</span>, and a case
          <span className="text-[var(--color-content)]"> breaching its SLA</span>. Both also appear
          in the notification bell; the e-mail is for when nobody is at the screen. Claiming a case
          yourself sends nothing — you already know.
        </p>
        <p>
          Nothing about passwords or two-factor is ever sent. Those belong to whoever authenticates
          your people, and this system does not see them.
        </p>
      </div>
    </Card>
  );
}

/** What was sent, and what became of it. */
function MailLogCard() {
  const log = useQuery({
    queryKey: ['mail-log'],
    queryFn: () => api.get<{ items: MailLogRow[] }>(`${ENDPOINT}/log?limit=20`),
  });

  const items = log.data?.items ?? [];

  return (
    <Card title="Recent Messages" description="Kept for 90 days, then pruned.">
      {items.length === 0 ? (
        <p className="text-sm text-[var(--color-content-muted)]">Nothing sent yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[var(--color-content-muted)] uppercase">
              <tr>
                <th className="pb-2 pr-3 font-medium">To</th>
                <th className="pb-2 pr-3 font-medium">Subject</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-border-subtle)]">
                  <td className="py-2 pr-3 font-mono text-xs">{row.to}</td>
                  <td className="py-2 pr-3">
                    {row.subject}
                    {row.lastError && (
                      <span className="mt-0.5 block text-xs text-[var(--color-severity-medium)]">
                        {row.lastError}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {row.status === 'SENT' ? (
                      <Badge tone="good">sent</Badge>
                    ) : row.status === 'FAILED' ? (
                      <Badge tone="warn">failed after {row.attempts}</Badge>
                    ) : (
                      <Badge>queued</Badge>
                    )}
                  </td>
                  <td className="py-2 text-xs text-[var(--color-content-muted)]">
                    {formatDateTime(row.sentAt ?? row.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
