import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ObservableType } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import type { WhitelistRuleRow } from '@/features/cases/types';

const controlClass =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

/**
 * Indicators that must never produce automatic correlations.
 *
 * Without this the engine is technically correct and practically useless: the
 * office egress IP appears on every case, and everything ends up related to
 * everything.
 */
export function WhitelistPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: ObservableType.IP as ObservableType,
    pattern: '',
    reason: '',
  });

  const rules = useQuery({
    queryKey: ['whitelist'],
    queryFn: () => api.get<{ items: WhitelistRuleRow[]; fanoutLimit: number }>('/admin/whitelist'),
  });

  const add = useMutation({
    mutationFn: () =>
      api.post('/admin/whitelist', {
        type: form.type,
        pattern: form.pattern.trim(),
        reason: form.reason.trim() || undefined,
      }),
    onSuccess: () => {
      setError(null);
      setForm({ ...form, pattern: '', reason: '' });
      void queryClient.invalidateQueries({ queryKey: ['whitelist'] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/whitelist/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['whitelist'] }),
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  return (
    <div className="max-w-6xl space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Correlation whitelist</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          These indicators are still recorded on cases — they simply never link cases together.
        </p>
      </header>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card title="Add rule">
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                add.mutate();
              }}
              className="space-y-4"
            >
              {/* Aligned from the top, not the bottom: the pattern field carries a
                  hint underneath it, and bottom alignment lifted its input clear
                  of the row. */}
              <div className="grid gap-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-start">
                <Field label="Type">
                  <select
                    value={form.type}
                    onChange={(event) =>
                      setForm({ ...form, type: event.target.value as ObservableType })
                    }
                    className={controlClass}
                  >
                    {Object.values(ObservableType).map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Pattern" hint="10.0.0.0/8 · *.microsoft.com · exact value">
                  <Input
                    value={form.pattern}
                    onChange={(event) => setForm({ ...form, pattern: event.target.value })}
                    className="font-mono"
                    required
                  />
                </Field>
              </div>

              <Field label="Reason">
                <Input
                  value={form.reason}
                  onChange={(event) => setForm({ ...form, reason: event.target.value })}
                  placeholder="Corporate egress range"
                />
              </Field>

              <div className="flex justify-end">
                <Button type="submit" loading={add.isPending}>
                  Add rule
                </Button>
              </div>
            </form>
          </Card>

          <Card title={`Rules (${rules.data?.items.length ?? 0})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[var(--color-content-muted)] uppercase">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">Type</th>
                    <th className="pb-2 pr-3 font-medium">Pattern</th>
                    <th className="pb-2 pr-3 font-medium">Reason</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data?.items.map((rule) => (
                    <tr key={rule.id} className="border-t border-[var(--color-border-subtle)]">
                      <td className="py-2 pr-3 text-xs">{rule.type}</td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {rule.pattern}
                        {rule.isCidr && (
                          <span className="ml-2 text-[var(--color-content-muted)]">CIDR</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-[var(--color-content-muted)]">
                        {rule.reason ?? '—'}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Remove this whitelist rule?',
                              body: (
                                <p>
                                  From now on{' '}
                                  <span className="font-mono text-[var(--color-content)]">
                                    {rule.pattern}
                                  </span>{' '}
                                  links cases again when it turns up on more than one.
                                </p>
                              ),
                              confirmLabel: 'Remove rule',
                            });
                            if (ok) remove.mutate(rule.id);
                          }}
                          className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-severity-critical)]"
                        >
                          remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card title="What a rule does">
          <div className="space-y-3 text-sm text-[var(--color-content-muted)]">
            <p>
              Every indicator on a case is matched against every other case — that comparison is
              what produces the links between them. A rule here takes one value out of it. The
              indicator is still recorded and still shown on the case; it simply stops being a
              reason to connect two of them.
            </p>

            <div>
              <p className="text-[var(--color-content)]">Three ways to write a pattern</p>
              <ul className="mt-1.5 space-y-1">
                <li>
                  <span className="font-mono text-xs">10.0.0.0/8</span> — a CIDR block, matched by
                  range
                </li>
                <li>
                  <span className="font-mono text-xs">*.microsoft.com</span> — a domain and
                  everything under it
                </li>
                <li>
                  <span className="font-mono text-xs">198.51.100.7</span> — one exact value
                </li>
              </ul>
            </div>

            {rules.data && (
              <p>
                An indicator seen on more than {rules.data.fanoutLimit} cases is treated as noisy
                and stops producing links on its own, whitelisted or not.
              </p>
            )}

            <p>
              Without any of this the engine is technically correct and practically useless: the
              office egress address appears on every case, and everything ends up related to
              everything.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
