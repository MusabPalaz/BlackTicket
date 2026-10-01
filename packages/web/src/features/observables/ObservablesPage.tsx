import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ObservableType, detectObservableType, refang } from '@black-ticket/shared';
import { api } from '@/lib/api';
import { Button, Card, ErrorState, Input, cx } from '@/components/ui';
import { SeverityChip, StatusChip, formatDateTime } from '@/components/case-bits';
import { IndicatorLookup } from '@/components/IndicatorLookup';
import type { ObservableSearchRow } from '@/features/cases/types';

interface SearchResult {
  items: ObservableSearchRow[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

const controlClass =
  'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]';

/**
 * "Have we seen this before?" — the question an analyst asks first.
 *
 * Search accepts whatever is on the clipboard: defanged, mixed case, with or
 * without a scheme. The same normalisation the API uses runs here for the hint
 * line, so what you type and what is matched cannot drift apart.
 */
export function ObservablesPage() {
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [type, setType] = useState(params.get('type') ?? '');
  const [iocOnly, setIocOnly] = useState(params.get('iocOnly') === 'true');

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams();
      if (term.trim()) next.set('q', term.trim());
      if (type) next.set('type', type);
      if (iocOnly) next.set('iocOnly', 'true');
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, type, iocOnly]);

  const query = params.toString();
  const results = useQuery({
    queryKey: ['observable-search', query],
    queryFn: () => api.get<SearchResult>(`/observables/search?${query}`),
  });

  // The debounce above rebuilds the parameters from the filters alone, so
  // changing a filter drops the page number and lands back on the first page —
  // which is what you want, since page 4 of the old search means nothing.
  const page = Number(params.get('page') ?? '1');

  function goToPage(next: number) {
    const updated = new URLSearchParams(params);
    updated.set('page', String(next));
    setParams(updated, { replace: true });
  }

  const guessed = term.trim() ? detectObservableType(term) : null;
  const refanged = term.trim() ? refang(term.trim()) : '';

  return (
    <div className="space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Observables</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Every indicator recorded on any case, and where it has been seen.
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="185.220.101[.]4, evil.com, a file hash…"
            className="min-w-72 flex-1 font-mono"
            autoFocus
          />
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className={controlClass}
          >
            <option value="">Any type</option>
            {Object.values(ObservableType).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-[var(--color-content-muted)]">
            <input
              type="checkbox"
              checked={iocOnly}
              onChange={(event) => setIocOnly(event.target.checked)}
            />
            IOC only
          </label>
        </div>

        {term.trim() && (refanged !== term.trim() || guessed) && (
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            Searching for <span className="font-mono">{refanged}</span>
            {guessed && ` · looks like ${guessed}`}
          </p>
        )}
      </Card>

      {results.data && results.data.total > 0 && (
        <p className="text-xs text-[var(--color-content-muted)]">
          {results.data.total} indicator(s)
          {results.data.pages > 1 &&
            ` · showing ${(results.data.page - 1) * results.data.size + 1}–${
              (results.data.page - 1) * results.data.size + results.data.items.length
            }`}
        </p>
      )}

      {results.isError && (
        <Card>
          <ErrorState onRetry={() => void results.refetch()} />
        </Card>
      )}

      {results.data?.items.length === 0 && (
        <Card>
          <p className="py-6 text-center text-sm text-[var(--color-content-muted)]">
            {term.trim() ? 'Never seen on any case.' : 'No observables recorded yet.'}
          </p>
        </Card>
      )}

      {results.data?.items.map((row) => (
        <Card key={row.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--color-content-muted)]">
                  {row.type}
                </span>
                <IndicatorLookup
                  type={row.type}
                  value={row.normalized}
                  blockedReason={row.lookupBlockedReason}
                >
                  <span className="font-mono text-sm break-all">{row.normalized}</span>
                </IndicatorLookup>
                {row.isIoc && (
                  <span className="rounded border border-[var(--color-severity-high)] px-1.5 py-0.5 text-[11px] text-[var(--color-severity-high)]">
                    IOC
                  </span>
                )}
                {row.isNoisy && (
                  <span
                    className="rounded border border-[var(--color-severity-medium)] px-1.5 py-0.5 text-[11px] text-[var(--color-severity-medium)]"
                    title="Seen on too many cases to link automatically"
                  >
                    noisy
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                First seen {formatDateTime(row.firstSeenAt)} · last seen{' '}
                {formatDateTime(row.lastSeenAt)}
              </p>
            </div>
            <span
              className={cx(
                'text-sm whitespace-nowrap',
                row.sightingCount > 1
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-content-muted)]',
              )}
            >
              {row.sightingCount} case(s)
            </span>
          </div>

          <ul className="mt-3 space-y-1 border-t border-[var(--color-border-subtle)] pt-3">
            {row.cases.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link to={`/cases/${entry.id}`} className="font-mono text-xs hover:underline">
                  {entry.reference}
                </Link>
                <Link to={`/cases/${entry.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {entry.title}
                </Link>
                <StatusChip value={entry.status} />
                <SeverityChip value={entry.severity} />
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {results.data && results.data.pages > 1 && (
        <div className="flex items-center justify-between rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-5 py-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-[var(--color-content-muted)]">
            Page {results.data.page} of {results.data.pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= results.data.pages}
            onClick={() => goToPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
