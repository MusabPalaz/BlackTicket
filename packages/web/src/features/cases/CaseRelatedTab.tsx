import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaseLinkType, Permission } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Alert, Button, Card, Field, Input, cx } from '@/components/ui';
import { SeverityChip, StatusChip } from '@/components/case-bits';
import { useConfirm } from '@/components/ConfirmDialog';
import type { CaseRecord, Paginated, RelatedCase } from './types';

const controlClass =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

/**
 * The payoff of the whole indicator model: which other cases touch this one,
 * and exactly which indicator says so.
 */
export function CaseRelatedTab({ caseId, readOnly }: { caseId: string; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ targetCaseId: '', reason: '', linkType: CaseLinkType.RELATED as CaseLinkType });

  const related = useQuery({
    queryKey: ['case-related', caseId],
    queryFn: () => api.get<{ items: RelatedCase[] }>(`/cases/${caseId}/related`),
  });

  const candidates = useQuery({
    queryKey: ['link-candidates', search],
    queryFn: () => api.get<Paginated<CaseRecord>>(`/cases?q=${encodeURIComponent(search)}&size=10`),
    enabled: linking && search.trim().length > 1,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['case-related', caseId] });
    // The tab's own counter lives on the case record, so linking or unlinking
    // has to refresh that too or the number goes stale behind the user.
    void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
  }

  function fail(caught: unknown) {
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const createLink = useMutation({
    mutationFn: () => api.post(`/cases/${caseId}/links`, form),
    onSuccess: () => {
      setError(null);
      setLinking(false);
      setForm({ targetCaseId: '', reason: '', linkType: CaseLinkType.RELATED });
      setSearch('');
      refresh();
    },
    onError: fail,
  });

  const removeLink = useMutation({
    mutationFn: (linkId: string) => api.delete(`/cases/${caseId}/links/${linkId}`),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: fail,
  });

  const canLink = hasPermission(Permission.CASE_LINK) && !readOnly;

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-content-muted)]">
          {related.data?.items.length ?? 0} related case(s). Correlations appear automatically when
          an indicator is shared.
        </p>
        {canLink && !linking && (
          <Button variant="secondary" onClick={() => setLinking(true)}>
            Link a case manually
          </Button>
        )}
      </div>

      {linking && (
        <Card title="Link Another Case">
          <div className="space-y-4">
            <Field label="Find the case" hint="Search by title or case number">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
            </Field>

            {candidates.data && candidates.data.items.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--color-border-subtle)]">
                {candidates.data.items
                  .filter((row) => row.id !== caseId)
                  .map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setForm({ ...form, targetCaseId: row.id })}
                      className={cx(
                        'flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--color-surface-overlay)]',
                        form.targetCaseId === row.id && 'bg-[var(--color-surface-overlay)]',
                      )}
                    >
                      <span className="font-mono text-xs">{row.reference}</span>
                      <span className="flex-1 truncate">{row.title}</span>
                      <SeverityChip value={row.severity} />
                    </button>
                  ))}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
              <Field label="Relationship">
                <select
                  value={form.linkType}
                  onChange={(event) => setForm({ ...form, linkType: event.target.value as CaseLinkType })}
                  className={controlClass}
                >
                  {Object.values(CaseLinkType)
                    .filter((type) => type !== CaseLinkType.CORRELATED)
                    .map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Reason" hint="Why do these belong together?">
                <Input
                  value={form.reason}
                  onChange={(event) => setForm({ ...form, reason: event.target.value })}
                  placeholder="Same actor infrastructure"
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <Button
                loading={createLink.isPending}
                disabled={!form.targetCaseId || form.reason.trim().length < 3}
                onClick={() => createLink.mutate()}
              >
                Create link
              </Button>
              <Button variant="secondary" onClick={() => setLinking(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {related.data?.items.length === 0 && (
        <Card>
          <p className="py-6 text-center text-sm text-[var(--color-content-muted)]">
            Nothing related yet. Add observables — the moment one of them shows up on another case,
            it appears here.
          </p>
        </Card>
      )}

      {related.data?.items.map((entry) => (
        <Card key={entry.case.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link to={`/cases/${entry.case.id}`} className="font-mono text-xs hover:underline">
                {entry.case.reference}
              </Link>
              <p className="mt-0.5">
                <Link to={`/cases/${entry.case.id}`} className="text-sm hover:underline">
                  {entry.case.title}
                </Link>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusChip value={entry.case.status} />
                <SeverityChip value={entry.case.severity} />
                {entry.case.resolution && (
                  <span className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--color-content-muted)]">
                    {entry.case.resolution.replace('_', ' ')}
                  </span>
                )}
              </div>
            </div>
            <span
              className={cx(
                'rounded border px-1.5 py-0.5 text-[11px]',
                entry.sharedObservables.length > 0
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border-subtle)] text-[var(--color-content-muted)]',
              )}
            >
              {entry.sharedObservables.length > 0 ? 'correlated' : entry.linkType.toLowerCase()}
            </span>
          </div>

          {entry.sharedObservables.length > 0 && (
            <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
              <p className="text-xs text-[var(--color-content-muted)]">Shared indicators</p>
              <ul className="mt-1 space-y-1">
                {entry.sharedObservables.map((observable) => (
                  <li key={observable.id} className="flex items-baseline gap-2 text-sm">
                    <span className="w-28 shrink-0 text-xs text-[var(--color-content-muted)]">
                      {observable.type}
                    </span>
                    <span className="font-mono text-xs break-all">{observable.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entry.manualReasons.length > 0 && (
            <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
              {entry.manualReasons.map((manual) => (
                <div key={manual.linkId} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {manual.reason}
                    {manual.by && (
                      <span className="ml-2 text-xs text-[var(--color-content-muted)]">— {manual.by}</span>
                    )}
                  </span>
                  {canLink && (
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Unlink ${entry.case.reference}?`,
                          body: (
                            <p>
                              The manual link ({manual.reason}) is removed. Links found through
                              shared indicators are not affected.
                            </p>
                          ),
                          confirmLabel: 'Unlink',
                        });
                        if (ok) removeLink.mutate(manual.linkId);
                      }}
                      className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-severity-critical)]"
                    >
                      unlink
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
