import type { ReactNode } from 'react';
import { BRANDING } from '@black-ticket/shared';
import { BrandFrame } from '@/components/brand/BrandFrame';
import { LogoAnimation } from '@/components/brand/LogoAnimation';

/**
 * Chrome for the screens you see before the app proper: sign-in and the forced
 * password change.
 *
 * On a wide screen the form is a full-height rail down the right edge and the
 * animation owns everything to the left of it. The rail is opaque and the
 * backdrop stops where the rail begins rather than running underneath it — so
 * the mark stays centred in the space it actually has, instead of sitting
 * off-centre behind a panel.
 *
 * Below `lg` there is no room for a rail. The animation goes full-bleed and the
 * same content becomes a floating card, so the rail's chrome — its border,
 * background and shadow — moves from the inner panel to the column and back.
 *
 * The rail width is spelled out at both ends — the rail itself and the edge
 * the backdrop stops at. Tailwind scans source text, so a shared constant
 * would simply never reach the stylesheet.
 *
 * Two constants hold the rest together:
 *
 * - The backdrop is a fixed layer with its own opaque background and its own
 *   stacking context, because `mix-blend-mode: screen` needs something
 *   well-defined behind it to blend against.
 * - Whatever carries the form is opaque. A translucent panel over a moving
 *   image is where login forms go to become illegible.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full">
      <div
        className="fixed inset-y-0 right-0 left-0 isolate bg-[var(--color-surface)] lg:right-[28rem]"
        aria-hidden="true"
      >
        {/* Edge to edge: the mark is scaled down inside the render itself, so
            there is no smaller video box sitting in a larger panel to give
            itself away. See design/brand/build-assets.sh. */}
        <LogoAnimation className="absolute inset-0" />
        <div className="brand-scrim absolute inset-0" />
        {/* Above the scrim: the frame is chrome and should not be veiled with
            the animation. Only where there is room for it. */}
        <BrandFrame className="inset-12 hidden lg:block" />
      </div>

      {/* Positioned, so it paints above the fixed backdrop rather than under it. */}
      <div className="relative ml-auto flex w-full flex-col justify-center p-6 lg:w-[28rem] lg:border-l lg:border-[var(--color-border-subtle)] lg:bg-[var(--color-surface-raised)] lg:p-12 lg:shadow-[var(--shadow-overlay)]">
        <div className="mx-auto w-full max-w-sm">
          <div className="animate-in rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-7 shadow-[var(--shadow-overlay)] lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            <header className="mb-6">
              <p className="text-[11px] font-medium tracking-wider text-[var(--color-content-faint)] uppercase">
                {BRANDING.productName}
              </p>
              <h1 className="mt-1.5 text-xl font-semibold tracking-tight">{title}</h1>
              {description && (
                <p className="mt-1.5 text-sm text-[var(--color-content-muted)]">{description}</p>
              )}
            </header>

            {children}

            {footer && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4 text-xs text-[var(--color-content-faint)]">
                {footer}
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] text-[var(--color-content-faint)]">
            Authorised access only. Every action is recorded.
          </p>
        </div>
      </div>
    </div>
  );
}
