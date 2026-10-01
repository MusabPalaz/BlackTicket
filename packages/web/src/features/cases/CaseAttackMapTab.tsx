import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ATTACK_TACTICS, type Severity } from '@black-ticket/shared';
import { api } from '@/lib/api';
import { Card, ErrorState, Skeleton, cx } from '@/components/ui';
import { SeverityChip } from '@/components/case-bits';

interface MapTechnique {
  id: string;
  name: string;
  tactic: string;
}

interface MapCase {
  id: string;
  reference: string;
  title: string;
  status: string;
  severity: Severity;
  resolution: string | null;
  occurredAt: string;
  depth: number;
  techniques: MapTechnique[];
}

interface AttackMap {
  caseId: string;
  cases: MapCase[];
  links: { source: string; target: string; indicators: string[]; manual: string[] }[];
  truncated: boolean;
  tactics: { tactic: string; short: string; cases: number; current: boolean }[];
  predictions: {
    history: {
      basedOn: number;
      items: {
        techniqueId: string;
        name: string;
        tactic: string;
        cases: number;
        examples: { caseId: string; reference: string }[];
      }[];
    };
    framework: {
      tactic: string;
      techniques: { id: string; name: string; timesTagged: number }[];
    }[];
  };
}

const SEVERITY_COLOR: Record<string, string> = {
  LOW: 'var(--color-severity-low)',
  MEDIUM: 'var(--color-severity-medium)',
  HIGH: 'var(--color-severity-high)',
  CRITICAL: 'var(--color-severity-critical)',
};

/** Projected stages are drawn in the colour of a threat, not of a fact. */
const NEXT_COLOR = 'var(--color-severity-high)';

const UNMAPPED = 'No technique tagged';

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The fourteen ATT&CK stages as one strip: reached, this case's own, and the
 * ones that would come next — the whole campaign's position at a glance.
 */
function KillChain({ map, next }: { map: AttackMap; next: Set<string> }) {
  return (
    <div className="overflow-x-auto">
      <ol
        className="grid min-w-[56rem] gap-1.5"
        style={{ gridTemplateColumns: `repeat(${ATTACK_TACTICS.length}, minmax(0, 1fr))` }}
      >
        {map.tactics.map((entry, index) => {
          const reached = entry.cases > 0;
          const projected = !reached && next.has(entry.tactic);
          return (
            <li
              key={entry.tactic}
              title={
                reached
                  ? `${entry.tactic}: ${entry.cases} case(s) in this campaign${entry.current ? ', including this one' : ''}`
                  : projected
                    ? `${entry.tactic}: a likely next stage`
                    : `${entry.tactic}: not seen`
              }
              className={cx(
                'relative flex min-h-16 flex-col justify-between rounded-[var(--radius-control)] border px-2 py-1.5',
                reached
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : projected
                    ? 'border-dashed'
                    : 'border-[var(--color-border-subtle)] opacity-60',
              )}
              style={projected ? { borderColor: NEXT_COLOR } : undefined}
            >
              <span className="text-[10px] text-[var(--color-content-faint)] tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span
                className={cx(
                  'text-[11px] leading-tight font-medium',
                  reached ? 'text-[var(--color-content)]' : 'text-[var(--color-content-muted)]',
                )}
                style={projected ? { color: NEXT_COLOR } : undefined}
              >
                {entry.short}
              </span>
              <span className="text-[10px] text-[var(--color-content-muted)]">
                {reached
                  ? `${entry.cases} case${entry.cases === 1 ? '' : 's'}`
                  : projected
                    ? 'next?'
                    : ' '}
              </span>
              {entry.current && (
                <span
                  className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface-raised)] bg-[var(--color-accent)]"
                  aria-label="This case"
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The campaign as a picture: cases left to right in the order they happened;
 * above them, an arc for every pair the correlation (or an analyst) linked;
 * below, a lane per tactic with a dot where a case was tagged with it.
 */
function CampaignGraph({ map }: { map: AttackMap }) {
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);

  const lanes = [
    ...ATTACK_TACTICS.map((t) => t.name).filter((name) =>
      map.cases.some((c) => c.techniques.some((t) => t.tactic === name)),
    ),
    ...(map.cases.some((c) => c.techniques.length === 0) ? [UNMAPPED] : []),
  ];

  const COLUMN = 112;
  // The lane names sit in their own column outside the scroller, so they stay
  // readable however far the campaign is scrolled.
  const LABEL = 120;
  const LANE = 34;
  const columnOf = new Map(map.cases.map((c, index) => [c.id, index]));
  const longestSpan = Math.max(
    1,
    ...map.links.map((l) =>
      Math.abs((columnOf.get(l.source) ?? 0) - (columnOf.get(l.target) ?? 0)),
    ),
  );
  const ARCS = Math.min(96, 24 + longestSpan * 12);
  const HEADER = ARCS + 22;
  const LANES_TOP = HEADER + 14;
  const width = map.cases.length * COLUMN + 16;
  const height = LANES_TOP + lanes.length * LANE + 26;
  const x = (index: number) => 8 + index * COLUMN + COLUMN / 2;
  const laneY = (lane: string) => LANES_TOP + lanes.indexOf(lane) * LANE + LANE / 2;

  // A wide campaign scrolls; it opens on this case rather than on its oldest one.
  const currentColumn = columnOf.get(map.caseId) ?? 0;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollLeft = 8 + currentColumn * COLUMN + COLUMN / 2 - element.clientWidth / 2;
  }, [currentColumn]);

  return (
    <div className="flex">
      <div className="relative shrink-0" style={{ width: LABEL, height }} aria-hidden="true">
        {lanes.map((lane) => (
          <span
            key={lane}
            className="absolute right-3 text-[11px] whitespace-nowrap text-[var(--color-content-muted)]"
            style={{ top: laneY(lane) - 8 }}
          >
            {lane === UNMAPPED
              ? 'Untagged'
              : (ATTACK_TACTICS.find((t) => t.name === lane)?.short ?? lane)}
          </span>
        ))}
      </div>
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Campaign of ${map.cases.length} linked cases on the ATT&CK kill chain`}
          className="min-w-full"
        >
          {/* Lanes */}
          {lanes.map((lane) => (
            <line
              key={lane}
              x1={0}
              x2={width}
              y1={laneY(lane)}
              y2={laneY(lane)}
              style={{ stroke: 'var(--color-border-subtle)' }}
              strokeDasharray={lane === UNMAPPED ? '2 4' : undefined}
            />
          ))}

          {/* Correlation arcs */}
          {map.links.map((link) => {
            const a = columnOf.get(link.source);
            const b = columnOf.get(link.target);
            if (a === undefined || b === undefined || a === b) return null;
            const [from, to] = a < b ? [a, b] : [b, a];
            const lift = Math.min(ARCS - 6, 14 + (to - from) * 12);
            const top = HEADER - 14;
            const manual = link.indicators.length === 0;
            const touchesCurrent = link.source === map.caseId || link.target === map.caseId;
            return (
              <path
                key={`${link.source}-${link.target}`}
                d={`M ${x(from)} ${top} C ${x(from)} ${top - lift}, ${x(to)} ${top - lift}, ${x(to)} ${top}`}
                fill="none"
                strokeWidth={touchesCurrent ? 2 : 1.25}
                strokeDasharray={manual ? '4 4' : undefined}
                style={{
                  stroke: 'var(--color-accent)',
                  opacity: touchesCurrent ? 0.9 : 0.4,
                }}
              >
                <title>
                  {manual
                    ? `Linked by an analyst: ${link.manual.join('; ')}`
                    : `Shared: ${link.indicators.join(', ')}`}
                </title>
              </path>
            );
          })}

          {/* Cases */}
          {map.cases.map((entry, index) => {
            const isCurrent = entry.id === map.caseId;
            const caseLanes = [...new Set(entry.techniques.map((t) => t.tactic))].filter((l) =>
              lanes.includes(l),
            );
            const dots = caseLanes.length > 0 ? caseLanes : [UNMAPPED];
            const ys = dots.map(laneY);
            const colour = SEVERITY_COLOR[entry.severity] ?? 'var(--color-content-muted)';
            return (
              <g
                key={entry.id}
                className="cursor-pointer"
                onClick={() => navigate(`/cases/${entry.id}?tab=attack`)}
              >
                <title>
                  {`${entry.reference} — ${entry.title}\n${entry.severity} · ${entry.status.replace('_', ' ')}${
                    entry.techniques.length
                      ? `\n${entry.techniques.map((t) => `${t.id} ${t.name}`).join('\n')}`
                      : ''
                  }`}
                </title>
                <rect
                  x={x(index) - COLUMN / 2 + 4}
                  y={HEADER - 14}
                  width={COLUMN - 8}
                  height={height - HEADER + 12}
                  rx={8}
                  style={{
                    fill: isCurrent ? 'var(--color-accent-soft)' : 'transparent',
                  }}
                />
                <text
                  x={x(index)}
                  y={HEADER}
                  textAnchor="middle"
                  className="font-mono"
                  style={{
                    fill: isCurrent ? 'var(--color-accent)' : 'var(--color-content)',
                    fontSize: 11,
                    fontWeight: isCurrent ? 700 : 500,
                  }}
                >
                  {entry.reference.replace(/^BT-\d{4}-0*/, '#')}
                </text>
                {ys.length > 1 && (
                  <line
                    x1={x(index)}
                    x2={x(index)}
                    y1={Math.min(...ys)}
                    y2={Math.max(...ys)}
                    style={{ stroke: colour, opacity: 0.5 }}
                    strokeWidth={2}
                  />
                )}
                {dots.map((lane) => (
                  <circle
                    key={lane}
                    cx={x(index)}
                    cy={laneY(lane)}
                    r={isCurrent ? 8 : 6}
                    strokeWidth={isCurrent ? 3 : lane === UNMAPPED ? 2 : 0}
                    style={{
                      fill: lane === UNMAPPED ? 'var(--color-surface-raised)' : colour,
                      stroke: isCurrent ? 'var(--color-accent)' : colour,
                    }}
                  />
                ))}
                <text
                  x={x(index)}
                  y={height - 8}
                  textAnchor="middle"
                  style={{ fill: 'var(--color-content-faint)', fontSize: 10 }}
                >
                  {shortDate(entry.occurredAt)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function NextMoves({ map }: { map: AttackMap }) {
  const navigate = useNavigate();
  const { history, framework } = map.predictions;
  const tagged = map.cases.some((c) => c.techniques.length > 0);
  const reached = map.tactics.filter((t) => t.cases > 0);
  const furthest = reached[reached.length - 1];

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-[var(--color-content-muted)] uppercase">
          From your own history
        </h3>
        {history.items.length > 0 ? (
          <ul className="space-y-3">
            {history.items.map((item) => {
              const share = history.basedOn ? Math.round((item.cases / history.basedOn) * 100) : 0;
              return (
                <li key={item.techniqueId}>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="text-xs" style={{ color: NEXT_COLOR }}>
                      {item.tactic}
                    </span>
                    <span className="font-mono text-xs">{item.techniqueId}</span>
                    <span className="font-medium">{item.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-overlay)]">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(4, share)}%`, background: NEXT_COLOR }}
                      />
                    </span>
                    <span className="w-48 text-right text-xs text-[var(--color-content-muted)] tabular-nums">
                      followed {item.cases} of {history.basedOn} linked intrusion
                      {history.basedOn === 1 ? '' : 's'}
                    </span>
                  </div>
                  {item.examples.length > 0 && (
                    <p className="mt-1 text-xs text-[var(--color-content-faint)]">
                      e.g.{' '}
                      {item.examples.map((example, index) => (
                        <span key={example.caseId}>
                          <button
                            type="button"
                            onClick={() => navigate(`/cases/${example.caseId}`)}
                            className="font-mono underline decoration-[var(--color-border-strong)] underline-offset-2 hover:text-[var(--color-accent)]"
                          >
                            {example.reference}
                          </button>
                          {index < item.examples.length - 1 && ', '}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-content-muted)]">
            {!tagged
              ? 'Tag ATT&CK techniques on this campaign’s cases and the radar can compare them with what followed in your other campaigns.'
              : history.basedOn === 0
                ? 'No other campaign in your history starts with these techniques yet. The more cases are tagged and linked, the sooner patterns appear here.'
                : `These techniques appear in ${history.basedOn} other linked intrusion${history.basedOn === 1 ? '' : 's'}, but nothing new followed them there yet.`}
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-[var(--color-content-muted)] uppercase">
          From the ATT&CK kill chain
        </h3>
        {framework.length === 0 ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            The campaign has already reached the last stage, Impact.
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-[var(--color-content-muted)]">
              {furthest
                ? `Furthest stage reached: ${furthest.tactic}. Intrusions usually move on to:`
                : 'Nothing is tagged yet; intrusions usually begin with:'}
            </p>
            <ul className="space-y-2">
              {framework.map((stage) => (
                <li
                  key={stage.tactic}
                  className="rounded-[var(--radius-control)] border border-dashed p-2.5"
                  style={{ borderColor: NEXT_COLOR }}
                >
                  <p className="text-sm font-medium" style={{ color: NEXT_COLOR }}>
                    {stage.tactic}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {stage.techniques.map((technique) => (
                      <li key={technique.id} className="flex items-baseline gap-2 text-xs">
                        <span className="w-20 shrink-0 font-mono">{technique.id}</span>
                        <span className="min-w-0 flex-1">{technique.name}</span>
                        <span className="text-[var(--color-content-faint)] tabular-nums">
                          {technique.timesTagged > 0
                            ? `tagged ${technique.timesTagged}× here`
                            : 'not seen here yet'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p className="border-t border-[var(--color-border-subtle)] pt-3 text-xs text-[var(--color-content-faint)]">
        Patterns, not certainties: drawn from links between your own cases and the order of the
        ATT&CK kill chain. Use them to decide what to watch for next.
      </p>
    </div>
  );
}

/**
 * Attack Map: the campaign this case belongs to and where it may go next.
 *
 * Everything shown is derived from data the team already has — correlation
 * links and the ATT&CK techniques tagged on cases — so each element can be
 * traced back to a case and an indicator.
 */
export function CaseAttackMapTab({ caseId }: { caseId: string }) {
  const map = useQuery({
    queryKey: ['attack-map', caseId],
    queryFn: () => api.get<AttackMap>(`/cases/${caseId}/attack-map`),
  });

  if (map.isError) {
    return (
      <Card>
        <ErrorState onRetry={() => void map.refetch()} />
      </Card>
    );
  }
  if (!map.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const data = map.data;
  const next = new Set([
    ...data.predictions.framework.map((stage) => stage.tactic),
    ...data.predictions.history.items.map((item) => item.tactic),
  ]);
  const current = data.cases.find((entry) => entry.id === caseId);
  const others = data.cases.length - 1;

  return (
    <div className="space-y-4">
      <Card
        title="Kill Chain"
        description={
          others > 0
            ? `This case and ${others} linked case${others === 1 ? '' : 's'}, by the ATT&CK stages tagged on them`
            : 'This case on its own: it is not linked to any other case yet'
        }
      >
        <KillChain map={data} next={next} />
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--color-content-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border border-[var(--color-accent)] bg-[var(--color-accent-soft)]" />
            reached in this campaign
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm border border-dashed"
              style={{ borderColor: NEXT_COLOR }}
            />
            likely next
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
            this case
          </span>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
        <Card
          title="Campaign"
          description="Cases in the order they happened. Arcs are correlations — dashed where an analyst made the link. Click a case to open its map."
          actions={current ? <SeverityChip value={current.severity} /> : undefined}
        >
          {data.cases.length > 1 || (current && current.techniques.length > 0) ? (
            <CampaignGraph map={data} />
          ) : (
            <p className="text-sm text-[var(--color-content-muted)]">
              Nothing to draw yet. Add indicators to this case: as soon as one is shared with
              another case, the campaign appears here.
            </p>
          )}
          {data.truncated && (
            <p className="mt-2 text-xs text-[var(--color-content-faint)]">
              Showing the {data.cases.length} closest cases; the campaign reaches further.
            </p>
          )}
        </Card>

        <Card title="Next Likely Moves" description="What tends to follow, and why">
          <NextMoves map={data} />
        </Card>
      </div>
    </div>
  );
}
