import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOOKUP_PLACEHOLDER,
  MAX_LOOKUP_PROVIDERS,
  ObservableType,
  OUTSIDE_LOOKUP_TYPES,
  type LookupProvider,
} from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';

interface LookupSettingsView {
  providers: LookupProvider[];
  defaults: LookupProvider[];
  updatedAt: string | null;
}

const ENDPOINT = '/admin/lookup-providers';

/** Types an in-house tool could take; OTHER has no shape to look up. */
const TYPES = Object.values(ObservableType).filter((type) => type !== ObservableType.OTHER);

/** An outside service only gets the types it can say something about. */
function typesFor(provider: LookupProvider): ObservableType[] {
  return provider.internal ? TYPES : TYPES.filter((type) => OUTSIDE_LOOKUP_TYPES.includes(type));
}

/** Only the addresses the form shows are saved, so switching a tool to an
 *  outside service drops the ones it may no longer take. */
function withShownTypes(provider: LookupProvider): LookupProvider {
  const shown = typesFor(provider);
  return {
    ...provider,
    templates: Object.fromEntries(
      Object.entries(provider.templates).filter(([type]) => shown.includes(type as ObservableType)),
    ),
  };
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'service'
  );
}

function coveredTypes(provider: LookupProvider): string[] {
  return typesFor(provider).filter((type) => provider.templates[type]);
}

/**
 * The third-party services offered on every indicator — VirusTotal, X-Force
 * and the like — and how each one's address is built.
 *
 * Edited as a list and saved as one, so a half-finished change never reaches
 * the analysts' menus.
 */
export function LookupProvidersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const settings = useQuery({
    queryKey: ['admin-lookup-providers'],
    queryFn: () => api.get<LookupSettingsView>(ENDPOINT),
  });

  /** Unsaved edits; null means "what is on file". */
  const [draft, setDraft] = useState<LookupProvider[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providers = draft ?? settings.data?.providers ?? [];
  const dirty = draft !== null;

  const save = useMutation({
    mutationFn: (next: LookupProvider[]) =>
      api.put<LookupSettingsView>(ENDPOINT, { providers: next }),
    onSuccess: (result) => {
      queryClient.setQueryData(['admin-lookup-providers'], result);
      void queryClient.invalidateQueries({ queryKey: ['lookup-providers'] });
      setDraft(null);
      setEditing(null);
      setError(null);
      toast.success('Lookup services saved', 'Analysts see the change on their next lookup.');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  function update(id: string, change: Partial<LookupProvider>) {
    setDraft(
      providers.map((provider) => (provider.id === id ? { ...provider, ...change } : provider)),
    );
  }

  function setTemplate(provider: LookupProvider, type: string, template: string) {
    update(provider.id, { templates: { ...provider.templates, [type]: template } });
  }

  function addService() {
    let id = 'new-service';
    for (let n = 2; providers.some((provider) => provider.id === id); n += 1)
      id = `new-service-${n}`;
    setDraft([...providers, { id, name: 'New service', enabled: true, templates: {} }]);
    setEditing(id);
  }

  if (settings.isLoading) {
    return <div className="p-8 text-sm text-[var(--color-content-muted)]">Loading…</div>;
  }
  if (settings.isError || !settings.data) {
    return (
      <div className="p-8">
        <Alert>Could not load the lookup services.</Alert>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">IOC Lookups</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          The outside services an analyst can check an indicator with, from its menu or by
          right-clicking it.
        </p>
      </header>

      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <Card
          title="Lookup Services"
          description={`${providers.filter((p) => p.enabled).length} of ${providers.length} offered to analysts`}
          actions={
            <Button
              variant="secondary"
              size="sm"
              disabled={providers.length >= MAX_LOOKUP_PROVIDERS}
              onClick={addService}
            >
              Add service
            </Button>
          }
        >
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {providers.map((provider) => {
              const open = editing === provider.id;
              const types = coveredTypes(provider);
              return (
                <li key={provider.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex min-w-0 flex-1 items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={provider.enabled}
                        onChange={(event) => update(provider.id, { enabled: event.target.checked })}
                        aria-label={`Offer ${provider.name}`}
                      />
                      <span className="font-medium">{provider.name}</span>
                      {provider.internal && <Badge>In-house</Badge>}
                    </label>
                    <span className="flex flex-wrap gap-1">
                      {types.length > 0 ? (
                        types.map((type) => <Badge key={type}>{type.replace('_', ' ')}</Badge>)
                      ) : (
                        <span className="text-xs text-[var(--color-severity-medium)]">
                          no addresses yet
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(open ? null : provider.id)}
                    >
                      {open ? 'Done' : 'Edit'}
                    </Button>
                  </div>

                  {open && (
                    <div className="animate-in mt-3 space-y-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
                      <Field label="Name">
                        <Input
                          value={provider.name}
                          maxLength={40}
                          onChange={(event) => update(provider.id, { name: event.target.value })}
                        />
                      </Field>
                      <label className="flex items-start gap-2.5 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={provider.internal === true}
                          onChange={(event) =>
                            update(provider.id, { internal: event.target.checked })
                          }
                        />
                        <span>
                          In-house tool
                          <span className="block text-xs text-[var(--color-content-muted)]">
                            A CMDB, IPAM or SIEM search inside the network. It can take every
                            indicator type, is offered for internal addresses and names, and PAP:RED
                            and TLP:RED do not hold it back.
                          </span>
                        </span>
                      </label>
                      <p className="text-xs text-[var(--color-content-muted)]">
                        One address per indicator type, starting with{' '}
                        {provider.internal ? 'http:// or https://' : 'https://'} and containing{' '}
                        <code className="font-mono">{LOOKUP_PLACEHOLDER}</code> where the indicator
                        goes. Leave a type empty to not offer it.
                      </p>
                      <div className="grid gap-2">
                        {typesFor(provider).map((type) => (
                          <label
                            key={type}
                            className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2"
                          >
                            <span className="text-xs text-[var(--color-content-muted)]">
                              {type.replace('_', ' ')}
                            </span>
                            <Input
                              value={provider.templates[type] ?? ''}
                              placeholder={`https://…/${LOOKUP_PLACEHOLDER}`}
                              onChange={(event) => setTemplate(provider, type, event.target.value)}
                              className="py-1 font-mono text-xs"
                              spellCheck={false}
                            />
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-end">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Remove ${provider.name}?`,
                              body: (
                                <p>
                                  Analysts stop seeing it in the lookup menu once the list is saved.
                                  Untick it instead to keep its addresses for later.
                                </p>
                              ),
                              confirmLabel: 'Remove service',
                            });
                            if (!ok) return;
                            setDraft(providers.filter((p) => p.id !== provider.id));
                            setEditing(null);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] pt-4">
            <Button
              disabled={!dirty}
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  // A renamed new service takes its key from its name.
                  providers.map((provider) =>
                    withShownTypes(
                      provider.id.startsWith('new-service')
                        ? { ...provider, id: uniqueSlug(provider, providers) }
                        : provider,
                    ),
                  ),
                )
              }
            >
              Save
            </Button>
            <Button
              variant="secondary"
              disabled={!dirty}
              onClick={() => {
                setDraft(null);
                setEditing(null);
                setError(null);
              }}
            >
              Discard changes
            </Button>
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Restore the default services?',
                  body: (
                    <p>
                      The list goes back to VirusTotal, X-Force, AbuseIPDB, OTX, Shodan and
                      urlscan.io with their standard addresses. Services you added are removed.
                    </p>
                  ),
                  confirmLabel: 'Restore defaults',
                });
                if (ok) save.mutate(settings.data!.defaults);
              }}
            >
              Restore defaults
            </Button>
          </div>
        </Card>

        <Card title="How Lookups Work">
          <div className="space-y-3 text-sm text-[var(--color-content-muted)]">
            <p>
              A lookup is a link, opened in a new tab from the analyst’s own browser. The server
              never contacts these services and holds no keys for them, so this works even when the
              server has no internet access.
            </p>
            <p>
              Opening one sends the indicator to that service. Nothing is sent until an analyst
              chooses to, and the page is opened without telling the service where the click came
              from.
            </p>
            <p>
              <strong className="text-[var(--color-content)]">
                Only what makes sense is offered.
              </strong>{' '}
              Outside services see IP addresses, domains, URLs, e-mail addresses and hashes — never
              hostnames, usernames or file names, never private or reserved addresses, internal
              names (.local, .corp, .internal…) or the organisation’s own domains. A service with no
              address for a type, such as AbuseIPDB for a domain, is not offered for it.
            </p>
            <p>
              <strong className="text-[var(--color-content)]">PAP and TLP are respected.</strong> A
              PAP:RED case allows no outside checks, and a TLP:RED indicator may not be disclosed
              outside its recipients: for those the menu explains why instead of offering a service.
              PAP:AMBER allows them — third-party lookups are its own example.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function uniqueSlug(provider: LookupProvider, all: LookupProvider[]): string {
  const base = slug(provider.name);
  let id = base;
  for (let n = 2; all.some((other) => other !== provider && other.id === id); n += 1) {
    id = `${base}-${n}`.slice(0, 40);
  }
  return id;
}
