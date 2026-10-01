import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Severity } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import type { CategoryRow, SlaPolicyRow } from './types';

const controlClass =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

/** Minutes are stored; humans think in hours and days. */
function humanMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1_440) return `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} h`;
  return `${(minutes / 1_440).toFixed(minutes % 1_440 ? 1 : 0)} d`;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState({ slug: '', name: '', color: '#8b5cf6' });
  const [drafts, setDrafts] = useState<Record<string, { first: number; resolution: number }>>({});

  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => api.get<{ items: CategoryRow[] }>('/admin/categories'),
  });

  const policies = useQuery({
    queryKey: ['sla-policies'],
    queryFn: () => api.get<{ items: SlaPolicyRow[] }>('/admin/sla-policies'),
  });

  const monitoring = useQuery({
    queryKey: ['sla-monitoring'],
    queryFn: () => api.get<{ enabled: boolean; notifications: boolean }>('/admin/sla-monitoring'),
  });

  function fail(caught: unknown) {
    setNotice(null);
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const saveCategory = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/admin/categories', body),
    onSuccess: () => {
      setError(null);
      setNotice('Category saved.');
      setCategory({ slug: '', name: '', color: '#8b5cf6' });
      void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: fail,
  });

  const saveMonitoring = useMutation({
    mutationFn: (patch: { enabled?: boolean; notifications?: boolean }) =>
      api.patch('/admin/sla-monitoring', patch),
    onSuccess: () => {
      setError(null);
      setNotice('SLA monitoring updated. It takes effect on the next sweep, within a minute.');
      void queryClient.invalidateQueries({ queryKey: ['sla-monitoring'] });
    },
    onError: fail,
  });

  const savePolicy = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/admin/sla-policies', body),
    onSuccess: () => {
      setError(null);
      setNotice('SLA target saved. It applies to cases opened from now on.');
      void queryClient.invalidateQueries({ queryKey: ['sla-policies'] });
    },
    onError: fail,
  });

  return (
    <div className="max-w-6xl space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">System Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Case categories and SLA targets. The organisation domain, correlation whitelist and API
          keys have their own screens.
        </p>
      </header>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          {/*
           * Separate from the targets below: those say what the deadlines are,
           * this says whether anyone is watched against them. A team that does not
           * work to SLA gets a notification per overdue case per breach otherwise,
           * and the bell stops meaning anything.
           */}
          <Card title="SLA Monitoring">
            <p className="mb-3 text-sm text-[var(--color-content-muted)]">
              The sweep runs every minute, marks cases that have missed their target and tells the
              people responsible.
            </p>

            <div className="space-y-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={monitoring.data?.enabled ?? true}
                  disabled={!monitoring.data || saveMonitoring.isPending}
                  onChange={async (event) => {
                    const enabled = event.target.checked;
                    // Switching it back on needs no warning; switching it off does.
                    if (!enabled) {
                      const ok = await confirm({
                        title: 'Stop the SLA sweep?',
                        body: (
                          <p>
                            Cases that miss their target are no longer flagged, and nobody is told
                            about breaches, missed first responses or a growing alert backlog.
                          </p>
                        ),
                        confirmLabel: 'Stop the sweep',
                      });
                      if (!ok) return;
                    }
                    saveMonitoring.mutate({ enabled });
                  }}
                />
                <span>
                  <span className="block text-sm font-medium">Run the sweep</span>
                  <span className="block text-xs text-[var(--color-content-muted)]">
                    Off means no breach flags and no notices. Cases already marked keep their flag.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={monitoring.data?.notifications ?? true}
                  disabled={!monitoring.data?.enabled || saveMonitoring.isPending}
                  onChange={async (event) => {
                    const notifications = event.target.checked;
                    if (!notifications) {
                      const ok = await confirm({
                        title: 'Stop SLA notifications?',
                        body: (
                          <p>
                            Breaches are still marked, but nobody hears about them — no bell, no
                            e-mail — until this is turned back on.
                          </p>
                        ),
                        confirmLabel: 'Stop notifications',
                      });
                      if (!ok) return;
                    }
                    saveMonitoring.mutate({ notifications });
                  }}
                />
                <span>
                  <span className="block text-sm font-medium">Send notifications</span>
                  <span className="block text-xs text-[var(--color-content-muted)]">
                    Turn this off for quiet without losing the numbers — breaches are still marked,
                    so the dashboard SLA figures stay honest.
                  </span>
                </span>
              </label>
            </div>
          </Card>

          <Card title="SLA Targets">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-content-muted)] uppercase">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Severity</th>
                  <th className="pb-2 pr-3 font-medium">First response (min)</th>
                  <th className="pb-2 pr-3 font-medium">Resolution (min)</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {policies.data?.items
                  .slice()
                  .sort(
                    (a, b) =>
                      Object.values(Severity).indexOf(b.severity as Severity) -
                      Object.values(Severity).indexOf(a.severity as Severity),
                  )
                  .map((policy) => {
                    const draft = drafts[policy.id] ?? {
                      first: policy.firstResponseMinutes,
                      resolution: policy.resolutionMinutes,
                    };
                    const dirty =
                      draft.first !== policy.firstResponseMinutes ||
                      draft.resolution !== policy.resolutionMinutes;

                    return (
                      <tr key={policy.id} className="border-t border-[var(--color-border-subtle)]">
                        <td className="py-2 pr-3">{policy.severity}</td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            min={5}
                            value={draft.first}
                            onChange={(event) =>
                              setDrafts({
                                ...drafts,
                                [policy.id]: { ...draft, first: Number(event.target.value) },
                              })
                            }
                            className={cx(controlClass, 'w-28')}
                          />
                          <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                            {humanMinutes(draft.first)}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            min={5}
                            value={draft.resolution}
                            onChange={(event) =>
                              setDrafts({
                                ...drafts,
                                [policy.id]: { ...draft, resolution: Number(event.target.value) },
                              })
                            }
                            className={cx(controlClass, 'w-28')}
                          />
                          <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                            {humanMinutes(draft.resolution)}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            className="px-2 py-1 text-xs"
                            disabled={!dirty}
                            onClick={() =>
                              savePolicy.mutate({
                                severity: policy.severity,
                                firstResponseMinutes: draft.first,
                                resolutionMinutes: draft.resolution,
                              })
                            }
                          >
                            Save
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </Card>

          <Card title="Case Categories">
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                saveCategory.mutate(category);
              }}
              className="mb-4 space-y-4"
            >
              {/* Aligned from the top, not the bottom: the slug carries a hint
              underneath it, and bottom alignment lifted its input clear of the
              row. */}
              <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                <Field label="Slug" hint="lowercase-with-dashes">
                  <Input
                    value={category.slug}
                    onChange={(event) => setCategory({ ...category, slug: event.target.value })}
                    className="font-mono"
                    required
                  />
                </Field>
                <Field label="Name">
                  <Input
                    value={category.name}
                    onChange={(event) => setCategory({ ...category, name: event.target.value })}
                    required
                  />
                </Field>
              </div>

              {/* Colour shares the footer row with the submit button and is pushed
              to the far side of it: as a third grid column it had to line up with
              two text inputs it can never match, since a colour input has no text
              line to take its height from. */}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <Field label="Colour">
                  {/* The wrapper is what earns the extra breathing room under the
                  label: Field spaces its children by 1.5, and padding inside a
                  child adds to that without a specificity fight or a change that
                  would reach every other form. */}
                  <div className="pt-1.5">
                    <input
                      type="color"
                      value={category.color}
                      onChange={(event) => setCategory({ ...category, color: event.target.value })}
                      className="h-[38px] w-16 cursor-pointer rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1"
                    />
                  </div>
                </Field>
                <Button type="submit" loading={saveCategory.isPending}>
                  Save category
                </Button>
              </div>
            </form>

            <table className="w-full text-left text-sm">
              <tbody>
                {categories.data?.items.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--color-border-subtle)]">
                    <td className="py-2 pr-3">
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.name}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--color-content-muted)]">
                      {row.slug}
                    </td>
                    <td className="py-2 pr-3">
                      {row.isActive ? <Badge tone="good">active</Badge> : <Badge>hidden</Badge>}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() =>
                          saveCategory.mutate({
                            slug: row.slug,
                            name: row.name,
                            isActive: !row.isActive,
                          })
                        }
                        className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
                      >
                        {row.isActive ? 'hide' : 'show'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="How SLA Targets Work">
            <div className="space-y-3 text-sm text-[var(--color-content-muted)]">
              <p>
                Both clocks start when the incident happened, not when the case was opened. A case
                filed two hours after the event is already two hours into its target — which is the
                point: the deadline belongs to the incident, not to the paperwork.
              </p>
              <p>
                <span className="text-[var(--color-content)]">First response</span> stops when
                somebody picks the case up.{' '}
                <span className="text-[var(--color-content)]">Resolution</span> stops when it
                closes. Missing either one is recorded on the case and shows up in the SLA widget.
              </p>
              <p>
                Changing a target never rewrites the deadline of a case that already exists. It
                applies to cases opened from then on, so the history stays honest about what was
                promised at the time.
              </p>
              <p>
                Targets are stored in minutes; the hours and days beside each field are the same
                number, read back.
              </p>
            </div>
          </Card>

          <Card title="How Categories Work">
            <div className="space-y-3 text-sm text-[var(--color-content-muted)]">
              <p>
                The <span className="text-[var(--color-content)]">slug</span> is the stable
                identifier — lowercase with dashes, never shown to analysts, and what every case
                stores. The <span className="text-[var(--color-content)]">name</span> is the label
                they pick from, so it can be rewritten later without touching a single case.
              </p>
              <p>
                Categories are hidden rather than deleted. A closed case must keep the label it was
                filed under, so hiding one only takes it out of the form for new cases.
              </p>
              <p>The colour is used wherever the category is shown as a dot or chip.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
