import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { API_KEY_SCOPE_LABELS, API_KEY_SCOPES, ApiKeyScope } from '@black-ticket/shared';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';
import type { ApiKeyRow } from '@/features/alerts/types';

/** Expiry is the other way a key stops working, and the server treats it the same. */
function isExpired(key: ApiKeyRow): boolean {
  return key.expiresAt !== null && new Date(key.expiresAt).getTime() <= Date.now();
}

/**
 * Keys for the detection stack.
 *
 * The plaintext exists for exactly one render — the server only keeps a digest,
 * so a lost key is replaced rather than recovered.
 */
export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiKeyScope>(ApiKeyScope.INGEST_WRITE);
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Id of the row asking to be deleted; deletion never happens on one click. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const keys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ items: ApiKeyRow[] }>('/admin/api-keys'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ name: string; key: string }>('/admin/api-keys', { name, scopes: [scope] }),
    onSuccess: (result) => {
      setError(null);
      setIssued(result);
      setName('');
      setScope(ApiKeyScope.INGEST_WRITE);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/api-keys/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/api-keys/${id}/permanent`),
    onSuccess: () => {
      setError(null);
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (caught) => {
      setPendingDelete(null);
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
    },
  });

  return (
    <div className="max-w-3xl space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ingest API keys</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Used by SIEM and EDR integrations to submit alerts.
        </p>
      </header>

      {error && <Alert>{error}</Alert>}

      {issued && (
        <Alert tone="warning">
          <p className="font-medium">Copy this key now — it is not shown again.</p>
          <code className="mt-2 block break-all rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2 font-mono text-xs">
            {issued.key}
          </code>
          <button
            className="mt-2 text-xs underline"
            onClick={() => {
              void navigator.clipboard?.writeText(issued.key);
            }}
          >
            Copy to clipboard
          </button>
        </Alert>
      )}

      <Card title="Create key">
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            create.mutate();
          }}
          className="space-y-2"
        >
          {/*
            The hint sits under the row rather than inside the Field: a hinted
            Field is taller than its input, so `items-end` would drop the button
            a line below the box it belongs next to.
          */}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Name">
              <Input
                id="api-key-name"
                aria-describedby="api-key-name-hint"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Wazuh production"
                required
              />
            </Field>
            {/* Chosen at creation and never widened afterwards: a key that can
                do both jobs is one compromise away from being both problems. */}
            <Field label="Purpose">
              <Select
                value={scope}
                onChange={(event) => setScope(event.target.value as ApiKeyScope)}
              >
                {API_KEY_SCOPES.map((value) => (
                  <option key={value} value={value}>
                    {API_KEY_SCOPE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
          </div>
          <p id="api-key-name-hint" className="text-xs text-[var(--color-content-faint)]">
            Which system will use it
          </p>
        </form>
      </Card>

      <Card title="What a key can do">
        <div className="space-y-3 text-sm text-[var(--color-content-muted)]">
          <p>
            A key's <span className="text-[var(--color-content)]">purpose</span> is fixed when you
            create it and is never widened afterwards. An{' '}
            <span className="text-[var(--color-content)]">alert ingest</span> key can only submit
            alerts; a <span className="text-[var(--color-content)]">directory sync</span> key can
            only create and disable accounts over SCIM. Neither can do the other's job, so one
            leaked integration token is one problem rather than two.
          </p>
          <p>
            The full key is shown once, at creation, and never again — only a digest is stored. A
            lost key is replaced, not recovered.
          </p>
          <p>
            <span className="text-[var(--color-content)]">Revoking</span> stops a key working
            immediately and leaves it on this list.{' '}
            <span className="text-[var(--color-content)]">Deleting</span> removes it for good, and
            is only offered once a key is revoked or expired: tidying up should not be able to cut
            off a live integration. Alerts already ingested survive either way, but a delete leaves
            them without a record of which key brought them in.
          </p>
          <p>
            Directory sync keys are sent as a bearer token, not in the{' '}
            <span className="text-[var(--color-content)]">X-Api-Key</span> header — Microsoft Entra
            offers no way to change that. Both spellings are accepted.
          </p>
        </div>
      </Card>

      <Card title="How to send an alert">
        <pre className="overflow-x-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-xs">
          {`curl -X POST http://<host>:3000/api/v1/ingest/alerts \\
  -H "X-Api-Key: <key>" -H "Content-Type: application/json" \\
  -d '{
    "externalId": "wazuh-1029384",
    "source": "Wazuh",
    "title": "Multiple failed SSH logins",
    "severity": "HIGH",
    "category": "brute-force",
    "observables": [{ "type": "IP", "value": "185.220.101.4", "isIoc": true }],
    "mitre": ["T1110.001"],
    "raw": {}
  }'`}
        </pre>
        <p className="mt-2 text-xs text-[var(--color-content-muted)]">
          Retries are safe: the same <code>source</code> + <code>externalId</code> is accepted once.
        </p>
      </Card>

      <Card title={`Keys (${keys.data?.items.length ?? 0})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[var(--color-content-muted)] uppercase">
              <tr>
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">Prefix</th>
                <th className="pb-2 pr-3 font-medium">Purpose</th>
                <th className="pb-2 pr-3 font-medium">Last used</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {keys.data?.items.map((key) => (
                <tr key={key.id} className="border-t border-[var(--color-border-subtle)]">
                  <td className="py-2 pr-3">{key.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{key.prefix}…</td>
                  <td className="py-2 pr-3 text-xs">
                    {key.scopes.includes(ApiKeyScope.SCIM_MANAGE) ? (
                      <Badge tone="warn">directory sync</Badge>
                    ) : (
                      <Badge>alert ingest</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-[var(--color-content-muted)]">
                    {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'never'}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {key.revokedAt ? (
                      <span className="text-[var(--color-content-muted)]">revoked</span>
                    ) : isExpired(key) ? (
                      <span className="text-[var(--color-content-muted)]">expired</span>
                    ) : (
                      <span className="text-[var(--color-tlp-green)]">active</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {pendingDelete === key.id ? (
                      /*
                       * Spelled out rather than confirmed with a bare "are you
                       * sure": the alerts this key brought in stay, but nothing
                       * afterwards can say which key that was.
                       */
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        <span className="text-xs text-[var(--color-content-muted)]">
                          Delete for good?
                          {key.alertCount > 0 &&
                            ` ${key.alertCount} alert(s) lose their ingest source.`}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPendingDelete(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={remove.isPending}
                          onClick={() => remove.mutate(key.id)}
                        >
                          Delete
                        </Button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-end gap-3">
                        {!key.revokedAt && (
                          <button
                            onClick={() => revoke.mutate(key.id)}
                            className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-severity-critical)]"
                          >
                            revoke
                          </button>
                        )}
                        {/* Only once the key is dead: the server refuses a live one. */}
                        {(key.revokedAt || isExpired(key)) && (
                          <button
                            onClick={() => {
                              setError(null);
                              setPendingDelete(key.id);
                            }}
                            className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-severity-critical)]"
                          >
                            delete
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
