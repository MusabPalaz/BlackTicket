import type { ComponentProps, ReactNode } from 'react';

/** Primitives so screens stay readable instead of drowning in classes. */

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ buttons

// ComponentProps rather than the bare attributes: it carries `ref`, which
// React 19 passes as an ordinary prop (a dialog has to focus its safe button).
type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  className,
  ...props
}: ButtonProps) {
  const styles = {
    primary:
      'bg-[var(--color-accent)] text-black shadow-[var(--shadow-card)] hover:bg-[var(--color-accent-strong)]',
    secondary:
      'border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]',
    ghost:
      'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-content)]',
    danger:
      'border border-[var(--color-severity-critical)]/40 bg-[var(--color-severity-critical)]/10 text-[var(--color-severity-critical)] hover:bg-[var(--color-severity-critical)]/20',
  }[variant];

  const sizing = size === 'sm' ? 'gap-1.5 px-2.5 py-1 text-xs' : 'gap-2 px-4 py-2 text-sm';

  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-[var(--radius-control)] font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        sizing,
        styles,
        className,
      )}
    >
      {loading ? (
        <>
          <Spinner className="h-3.5 w-3.5" />
          <span>Working…</span>
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('animate-spin', className)} aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
        fill="none"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ------------------------------------------------------------------- inputs

const fieldBase =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] ' +
  'px-3 py-2 text-sm outline-none transition-colors placeholder:text-[var(--color-content-faint)] ' +
  'hover:border-[var(--color-border-strong)] focus:border-[var(--color-accent)] disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cx(fieldBase, className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select {...props} className={cx(fieldBase, 'cursor-pointer pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(fieldBase, 'resize-y', className)} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium tracking-wide text-[var(--color-content-muted)] uppercase">
        {label}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-[var(--color-severity-critical)]">{error}</span>
      ) : (
        hint && <span className="block text-xs text-[var(--color-content-faint)]">{hint}</span>
      )}
    </label>
  );
}

// ------------------------------------------------------------------ surfaces

export function Card({
  id,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  /** For linking to a section from elsewhere on the page. */
  id?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      className={cx(
        'rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)]',
        'bg-[var(--color-surface-raised)] shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-3">
          <div>
            {title && <h2 className="text-sm font-medium">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb && (
          <div className="mb-1 text-xs text-[var(--color-content-faint)]">{breadcrumb}</div>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// -------------------------------------------------------------- status bits

export function Alert({
  tone = 'error',
  children,
  onDismiss,
}: {
  tone?: 'error' | 'warning' | 'success' | 'info';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const styles = {
    error:
      'border-[var(--color-severity-critical)]/50 bg-[var(--color-severity-critical)]/8 text-[var(--color-severity-critical)]',
    warning:
      'border-[var(--color-severity-medium)]/50 bg-[var(--color-severity-medium)]/8 text-[var(--color-severity-medium)]',
    success:
      'border-[var(--color-tlp-green)]/50 bg-[var(--color-tlp-green)]/8 text-[var(--color-tlp-green)]',
    info: 'border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] text-[var(--color-content-muted)]',
  }[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'animate-in flex gap-3 rounded-[var(--radius-control)] border px-3.5 py-2.5 text-sm',
        styles,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 opacity-60 hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}) {
  const styles = {
    neutral: 'border-[var(--color-chip-border)] text-[var(--color-chip-text)]',
    good: 'border-[var(--color-tlp-green)]/60 text-[var(--color-tlp-green)]',
    warn: 'border-[var(--color-severity-medium)]/60 text-[var(--color-severity-medium)]',
    bad: 'border-[var(--color-severity-critical)]/60 text-[var(--color-severity-critical)]',
    accent: 'border-[var(--color-accent)]/60 text-[var(--color-accent)]',
  }[tone];

  return (
    <span
      className={cx(
        'rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        styles,
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------ loading/empty

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cx('skeleton rounded', className)} style={style} aria-hidden="true" />;
}

/** Table placeholder that keeps the layout still while data arrives. */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-3">
          {Array.from({ length: columns }).map((_, column) => (
            <Skeleton key={column} className={cx('h-4', column === 1 ? 'flex-[3]' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-[var(--color-content-faint)]">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-[var(--color-content-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * A request that failed, said plainly.
 *
 * The alternative this replaces is worse than it looks: a list whose query
 * failed renders as a list with nothing in it, which reads as "there is
 * nothing" rather than "we could not ask". On a screen an analyst uses to
 * decide whether something has been seen before, those two are not close.
 */
export function ErrorState({
  title = 'Could not load this',
  description = 'The server did not answer. This is not an empty result — it is a missing one.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-sm font-medium text-[var(--color-severity-critical)]">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-[var(--color-content-muted)]">{description}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Headline number with a label; the dashboard's top row is built from these. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'urgent';
}) {
  return (
    <>
      <p className="text-xs tracking-wide text-[var(--color-content-muted)] uppercase">{label}</p>
      <p
        className={cx(
          'mt-2 text-2xl font-semibold tabular-nums',
          tone === 'urgent' && 'text-[var(--color-severity-critical)]',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-[var(--color-content-faint)]">{hint}</p>}
    </>
  );
}
