import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui';

interface Props {
  children: ReactNode;
  /** Shown instead of the default panel; used to keep a widget inside its card. */
  fallback?: (reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken render from taking the page with it.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * which on a single-page app means a blank window and no way back except a
 * reload. A boundary around each dashboard widget keeps one bad chart to
 * itself; the one at the root is the last resort for everything else.
 *
 * This has to be a class: there is still no hook equivalent of
 * `componentDidCatch`.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept on the console rather than swallowed: this is the only trace of a
    // render failure until there is somewhere to report it.
    console.error('Unhandled render error', error, info.componentStack);
  }

  private readonly reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <p className="text-sm font-medium text-[var(--color-severity-critical)]">
          Something in this screen failed to render.
        </p>
        <p className="max-w-md text-sm text-[var(--color-content-muted)]">
          Nothing was lost — the page stopped drawing, it did not stop working. Try again, or reload
          if it keeps happening.
        </p>
        <div className="mt-1 flex gap-2">
          <Button variant="secondary" onClick={this.reset}>
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }
}
