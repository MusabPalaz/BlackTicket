import { BRANDING } from '@black-ticket/shared';
import { cx } from '@/components/ui';
import { BRAND_ASSETS } from './assets';

const MARK_SIZE = {
  sm: 'h-5',
  md: 'h-7',
  lg: 'h-12',
} as const;

const NAME_SIZE = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl',
} as const;

/**
 * Product lockup: the mark, optionally with the name and tagline beside it.
 *
 * Every place that needs to say "this is Black Ticket" uses this rather than
 * re-typing the name — the strings come from the shared branding module and
 * the artwork from one generated file.
 */
export function BrandMark({
  size = 'md',
  withText = true,
  withTagline = true,
  className,
}: {
  size?: keyof typeof MARK_SIZE;
  withText?: boolean;
  withTagline?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('flex min-w-0 items-center gap-3', className)}>
      <img
        src={BRAND_ASSETS.mark}
        alt={withText ? '' : BRANDING.productName}
        aria-hidden={withText || undefined}
        className={cx('w-auto shrink-0 select-none', MARK_SIZE[size])}
      />
      {withText && (
        <div className="min-w-0">
          <p className={cx('truncate leading-tight font-semibold tracking-tight', NAME_SIZE[size])}>
            {BRANDING.productName}
          </p>
          {/* Wraps rather than truncating: cut off mid-word in the sidebar it
              read as "IO…", which says nothing. */}
          {withTagline && (
            <p className="text-[11px] leading-snug text-[var(--color-content-faint)]">
              {BRANDING.tagline}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
