import { useEffect, useState } from 'react';
import { BRANDING } from '@black-ticket/shared';
import { cx } from '@/components/ui';
import { useReducedMotion } from '@/lib/use-media-query';

const WORDMARK = BRANDING.productName.toUpperCase();

/** Milliseconds per character. Slow enough to read as typing, not as a glitch. */
const KEYSTROKE = 95;
/** How long the finished wordmark rests before it types itself again. */
const HOLD = 5_000;

const STARS = 4;
/** Gap between two stars lighting up. */
const STAR_STEP = 1_700;
/** How long all four stay lit before the set goes dark and starts over. */
const STAR_HOLD = 1_200;
/**
 * How late the right-hand set joins. The two cycles are the same length, so a
 * one-off offset holds forever — the columns never count together.
 */
const RIGHT_PHASE = 3_200;

/** Distance the rules stop short of each corner, so no two ends meet. */
const CORNER = 'top-10 bottom-10';

/**
 * Stars on the inner face of a vertical rule.
 *
 * A loading tell rather than an ambient one: they arrive one at a time, hold
 * together, then all go dark at once and the count starts again. Each column
 * keeps its own clock and its own start, so the two sides never sync up.
 */
function Stars({
  side,
  anchor,
  phase,
}: {
  side: 'left' | 'right';
  anchor: 'middle' | 'high';
  phase: number;
}) {
  const reducedMotion = useReducedMotion();
  const [lit, setLit] = useState(0);
  const [running, setRunning] = useState(phase === 0);

  useEffect(() => {
    if (reducedMotion || running) return;
    const timer = window.setTimeout(() => setRunning(true), phase);
    return () => window.clearTimeout(timer);
  }, [running, phase, reducedMotion]);

  useEffect(() => {
    if (reducedMotion || !running) return;
    const timer = window.setTimeout(
      () => setLit((count) => (count >= STARS ? 0 : count + 1)),
      lit >= STARS ? STAR_HOLD : STAR_STEP,
    );
    return () => window.clearTimeout(timer);
  }, [lit, running, reducedMotion]);

  const shown = reducedMotion ? STARS : lit;

  return (
    <div
      className={cx(
        'absolute flex flex-col gap-3.5',
        side === 'left' ? 'left-3.5' : 'right-3.5',
        anchor === 'middle' ? 'top-1/2 -translate-y-1/2' : 'top-20',
      )}
    >
      {Array.from({ length: STARS }, (_, index) => (
        <span
          key={index}
          className={cx(
            'font-mono text-2xl leading-none font-bold text-[var(--color-brand-star)]',
            'transition-opacity duration-500',
            index < shown ? 'opacity-100' : 'opacity-0',
          )}
        >
          *
        </span>
      ))}
    </div>
  );
}

/**
 * The hairline frame around the sign-in backdrop.
 *
 * It is chrome, not content: the rail already names the product for anyone
 * reading the page, so everything here is hidden from assistive technology and
 * exists to make the panel feel like an instrument rather than a wallpaper.
 *
 * No two rules touch. Each stops short of the corner, and the bottom pair sits
 * exactly on the frame's lower edge — the verticals end above it rather than
 * running past it.
 *
 * The wordmark types itself out under a block caret, rests, and types again.
 * Its width is reserved up front by an invisible copy of the full string —
 * without that, the two rules flanking it would shuffle sideways on every
 * keystroke.
 */
export function BrandFrame({ className }: { className?: string }) {
  const reducedMotion = useReducedMotion();
  const [typed, setTyped] = useState(0);
  const complete = typed >= WORDMARK.length;

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setTimeout(
      () => setTyped((count) => (count >= WORDMARK.length ? 0 : count + 1)),
      complete ? HOLD : KEYSTROKE,
    );
    return () => window.clearTimeout(timer);
  }, [typed, complete, reducedMotion]);

  const rule = 'bg-[var(--color-brand-rule)]';

  return (
    <div className={cx('pointer-events-none absolute', className)} aria-hidden="true">
      <span className={cx('absolute top-0 right-10 left-10 h-0.5', rule)} />

      <div className={cx('absolute left-0 w-0.5', CORNER, rule)}>
        <Stars side="left" anchor="middle" phase={0} />
      </div>
      <div className={cx('absolute right-0 w-0.5', CORNER, rule)}>
        <Stars side="right" anchor="high" phase={RIGHT_PHASE} />
      </div>

      {/* Centred on the frame's lower edge, so the rules land on it instead of
          18px above it. The bottom rule breaks for the wordmark. */}
      <div className="absolute right-10 bottom-0 left-10 flex translate-y-1/2 items-center gap-6">
        <span className={cx('h-0.5 flex-1', rule)} />

        <span className="relative font-mono text-2xl font-bold tracking-[0.4em] whitespace-nowrap lg:text-3xl">
          <span className="invisible">{WORDMARK}</span>
          <span className="absolute inset-0">
            {reducedMotion ? WORDMARK : WORDMARK.slice(0, typed)}
            <span className={cx('brand-caret', complete && 'brand-caret-blink')} />
          </span>
        </span>

        <span className={cx('h-0.5 flex-1', rule)} />
      </div>
    </div>
  );
}
