import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CaseResolution, ExtractedObservable, Severity } from '@black-ticket/shared';
import { api } from '@/lib/api';
import { Badge, Card, cx } from '@/components/ui';
import { ResolutionChip, SeverityChip, formatDateTime } from '@/components/case-bits';

interface RadarCase {
  caseId: string;
  reference: string;
  title: string;
  status: string;
  severity: Severity;
}

interface RadarIndicator {
  type: string;
  value: string;
  sightings: number;
  whitelisted: boolean;
  noisy: boolean;
  lastVerdict: {
    caseId: string;
    reference: string;
    resolution: CaseResolution;
    closedAt: string;
    summary: string | null;
  } | null;
  recent: RadarCase[];
}

interface RadarResponse {
  indicators: RadarIndicator[];
  openCases: (RadarCase & { assignee: string | null; shared: string[] })[];
}

export function indicatorKey(indicator: { type: string; normalized: string }): string {
  return `${indicator.type}|${indicator.normalized}`;
}

/**
 * A case opened elsewhere in a new tab, so the form being written here is not
 * lost. Opened with its opener on purpose: that is what carries this tab's
 * session (kept in session storage) across, so the new tab is signed in.
 */
function openInNewTab(caseId: string) {
  window.open(`/cases/${caseId}`, '_blank');
}

/**
 * The empty panel: a scope sweeping for something to find. Drawn, not an
 * image, so it takes the theme's colours; the sweep stops for anyone who asked
 * for reduced motion.
 */
function RadarScope() {
  return (
    <svg viewBox="0 0 200 200" className="h-44 w-44" aria-hidden="true">
      <defs>
        <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="var(--color-border-strong)" strokeWidth="1">
        <circle cx="100" cy="100" r="92" />
        <circle cx="100" cy="100" r="64" />
        <circle cx="100" cy="100" r="36" />
        <path d="M100 8v184M8 100h184" strokeDasharray="2 4" />
      </g>
      <g className="radar-sweep">
        <path d="M100 100 L192 100 A92 92 0 0 0 165 35 Z" fill="url(#radar-sweep)" />
        <path d="M100 100 L192 100" stroke="var(--color-accent)" strokeWidth="1.5" />
      </g>
      <circle className="radar-blip" cx="138" cy="72" r="3" fill="var(--color-accent)" />
      <circle
        className="radar-blip radar-blip-late"
        cx="70"
        cy="128"
        r="2.5"
        fill="var(--color-accent)"
      />
    </svg>
  );
}

function CaseLink({ item }: { item: { caseId: string; reference: string } }) {
  return (
    <button
      type="button"
      onClick={() => openInNewTab(item.caseId)}
      title="Opens in a new tab, so this form stays as it is"
      className="font-mono text-sm text-[var(--color-content)] underline decoration-[var(--color-border-strong)] underline-offset-2 hover:text-[var(--color-accent)]"
    >
      {item.reference}
    </button>
  );
}

/**
 * Case Radar: what the team already knows, shown while the case is written.
 *
 * Correlation normally starts once a case exists. Here the indicators in the
 * title and description are looked up as they are typed — where each was seen,
 * the last verdict reached on one, whether correlation would ignore it — and an
 * open case sharing them is flagged before a duplicate is opened beside it.
 * The analyst decides which of the indicators go onto the new case.
 */
export function CaseRadar({
  indicators,
  excluded,
  onToggle,
}: {
  indicators: ExtractedObservable[];
  excluded: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  // Looked up once typing settles, not on every keystroke.
  const lookupKey = indicators.map(indicatorKey).join('\n');
  const [settledKey, setSettledKey] = useState(lookupKey);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledKey(lookupKey), 400);
    return () => window.clearTimeout(timer);
  }, [lookupKey]);

  const radar = useQuery({
    queryKey: ['case-radar', settledKey],
    queryFn: () =>
      api.post<RadarResponse>('/observables/radar', {
        items: settledKey.split('\n').map((key) => {
          const [type, ...rest] = key.split('|');
          return { type, value: rest.join('|') };
        }),
      }),
    enabled: settledKey !== '',
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const known = new Map(
    (radar.data?.indicators ?? []).map((entry) => [`${entry.type}|${entry.value}`, entry]),
  );
  const included = indicators.filter((indicator) => !excluded.has(indicatorKey(indicator)));

  return (
    <Card
      title="Case Radar"
      description="What the team already knows about this incident, before it is opened"
      className="lg:min-h-[32rem]"
      actions={
        radar.isFetching ? (
          <span className="text-xs text-[var(--color-content-faint)]">Checking…</span>
        ) : undefined
      }
    >
      {indicators.length === 0 ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center text-sm text-[var(--color-content-muted)]">
          <RadarScope />
          <p className="max-w-sm">
            Type or paste indicators into the title or description — IP addresses, domains, URLs,
            hashes, e-mail addresses. Defanged ones like{' '}
            <span className="font-mono">185.220.101[.]4</span> are understood.
          </p>
          <p className="max-w-sm">
            For each one the radar shows where it has been seen, the verdict reached last time, and
            whether an open case already covers it.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {radar.isError && (
            <p role="alert" className="text-sm text-[var(--color-severity-critical)]">
              Could not check these indicators. The case can still be opened.
            </p>
          )}

          {radar.data && radar.data.openCases.length > 0 && (
            <div
              role="status"
              className="space-y-2 rounded-[var(--radius-control)] border border-[var(--color-severity-medium)]/50 bg-[var(--color-severity-medium)]/8 p-3"
            >
              <p className="text-sm font-medium text-[var(--color-severity-medium)]">
                Possible duplicate
              </p>
              <p className="text-sm text-[var(--color-content-muted)]">
                An open case already has some of these indicators. Check it before opening a new
                one.
              </p>
              <ul className="space-y-1.5">
                {radar.data.openCases.map((open) => (
                  <li key={open.caseId} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <CaseLink item={open} />
                      <SeverityChip value={open.severity} />
                      <span className="text-sm text-[var(--color-content-muted)]">
                        {open.status.replace('_', ' ')} · {open.assignee ?? 'unassigned'}
                      </span>
                    </div>
                    <p className="truncate text-sm text-[var(--color-content-muted)]">
                      {open.title} — shares {open.shared.length} indicator
                      {open.shared.length === 1 ? '' : 's'}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {indicators.map((indicator) => {
              const key = indicatorKey(indicator);
              const info = known.get(key);
              const checked = !excluded.has(key);
              return (
                <li key={key} className="py-2.5 first:pt-0 last:pb-0">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={() => onToggle(key)}
                      aria-label={`Add ${indicator.normalized} to the case`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="w-20 shrink-0 text-xs text-[var(--color-content-faint)]">
                          {indicator.type}
                        </span>
                        <span
                          className={cx(
                            'min-w-0 font-mono text-sm break-all',
                            !checked && 'text-[var(--color-content-faint)] line-through',
                          )}
                        >
                          {indicator.normalized}
                        </span>
                      </span>
                    </span>
                  </label>

                  {info && (
                    <div className="mt-1.5 ml-6 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--color-content-muted)]">
                        {info.whitelisted ? (
                          <Badge>whitelisted · will not link</Badge>
                        ) : info.noisy ? (
                          <Badge tone="warn">noisy · will not link</Badge>
                        ) : info.sightings === 0 ? (
                          <Badge tone="accent">first sighting</Badge>
                        ) : null}
                        {info.sightings > 0 && (
                          <span>
                            Seen on {info.sightings} case{info.sightings === 1 ? '' : 's'}
                            {info.recent.length > 0 && ': '}
                          </span>
                        )}
                        {info.recent.map((found, index) => (
                          <span key={found.caseId}>
                            <CaseLink item={found} />
                            {index < info.recent.length - 1 && ','}
                          </span>
                        ))}
                      </div>

                      {info.lastVerdict && (
                        <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--color-content-muted)]">
                            <span>Last verdict</span>
                            <ResolutionChip value={info.lastVerdict.resolution} />
                            <CaseLink item={info.lastVerdict} />
                            <span>· {formatDateTime(info.lastVerdict.closedAt)}</span>
                          </p>
                          {info.lastVerdict.summary && (
                            <p className="mt-1 line-clamp-3 text-sm text-[var(--color-content)] italic">
                              {info.lastVerdict.summary}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="border-t border-[var(--color-border-subtle)] pt-3 text-sm text-[var(--color-content-muted)]">
            {included.length === 0
              ? 'No indicators will be added. Tick the ones that belong on the case.'
              : `${included.length} of ${indicators.length} indicator${indicators.length === 1 ? '' : 's'} will be added to the case when it is opened, and correlated straight away.`}
          </p>
        </div>
      )}
    </Card>
  );
}
