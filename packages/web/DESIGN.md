# Interface design structure

This document explains how the interface is built: which decision is made where,
and what to touch — and what not to — when adding a new screen.

The goal in one sentence: **if there is a saturated colour on screen, it means
something.** An analyst looks at this screen for a whole shift; apart from
severity, TLP and "you can click here", nothing tries to draw attention.

---

## 1. Layers

Decisions live in four layers. Moving one layer's job up into the next means
repeating the same decision in dozens of files.

| Layer | Where | Provides |
|---|---|---|
| Design tokens | `src/styles/index.css` → `@theme` | Colour, shadow, radius, duration. No raw `#hex` or `px` shadows. |
| Primitive components | `src/components/ui.tsx` | `Button`, `Input`, `Field`, `Card`, `Alert`, `Badge`, `EmptyState`, `Skeleton`… |
| Brand | `src/components/brand/` | `BrandMark` (lock-up), `LogoAnimation` (animation), `assets.ts` (file paths). |
| Layout | `src/app/layout/` | `AppShell` (the signed-in application), `AuthLayout` (screens before sign-in). |

Screens live under `src/features/<area>/` and only combine these four.

## 2. Tokens

All of them live in `@theme` and are used from Tailwind classes through `var(--…)`:

```tsx
className="border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]"
```

**Surfaces**, back to front: `--color-surface` → `-raised` → `-overlay` → `-hover`.
The page background is `surface`, a panel is `surface-raised`, a panel inside a
panel is `surface-overlay`. If a fourth level seems necessary, the layout is wrong.

**Content**: `--color-content` → `-muted` → `-faint`. Respectively: text to be
read, labels and descriptions, secondary hints.

**Borders**: `--color-border-subtle` by default, `-strong` only for hover and focus
transitions.

**Accent**: `--color-accent` is the one saturated colour, and it means "this is
clickable / this is the primary action". It is never used for decoration.

**Colours that carry meaning** — `--color-severity-*` and `--color-tlp-*`. They
follow the published conventions. If something is red here, it is because it is
critical, not because red looks good. These variables are used for nothing else.

**Elevation**: three steps — `--shadow-card`, `--shadow-raised`, `--shadow-overlay`.
More would mean nothing looks raised.

**Radius**: two steps — `--radius-control` (buttons, fields), `--radius-panel`
(cards, dialogs).

**Duration**: `--duration-hover` (150ms), `--duration-enter` (180ms), and
`--duration-brand` (700ms), reserved for the brand animation. One easing:
`--ease-out-soft`.

## 3. Accessibility and motion

- The focus ring is defined globally through `:focus-visible`; where a component
  writes `outline-none`, a visible focus state goes in its place.
- The whole product can be used from the keyboard. Shortcuts are gathered in one
  place in `AppShell` and do not fire while a field has focus.
- `prefers-reduced-motion` is honoured in two places: the stylesheet neutralises
  CSS animations, and `useReducedMotion` drops the video to a still frame without
  requesting it at all — `display: none` does not stop a video from downloading.

## 4. Screens before sign-in

`AuthLayout` carries sign-in (`LoginPage`) and the mandatory password change
(`ChangePasswordPage`). On a wide screen the form is a full-height rail on the
right, and the animation is everything to its left:

```
┌────────────────────────────────┬─────────┐
│  fixed layer: animation+scrim  │ BLACK…  │
│                                │ Sign in │
│         ╱───★───╲              │ [form]  │
│                                │         │
│                                │ Auth…   │
└────────────────────────────────┴─────────┘
   ← the backdrop ends here          28rem
```

The rail is opaque, and the backdrop stops where the rail begins
(`lg:right-[28rem]`) instead of running underneath it. The mark therefore sits in
the middle of the space it actually owns, not off-centre behind a panel.

Below `lg` there is no room for the rail: the animation goes full screen and the
same content becomes a floating card. The rail's shell — border, background,
shadow — moves from the inner panel to the column and back.

The rail width is written in two separate places. Tailwind scans source text, so a
shared constant would never reach the stylesheet.

Two invariants hold the rest together:

- The backdrop is `fixed`, with its own opaque background and its own stacking
  context (`isolation: isolate`). `mix-blend-mode: screen` needs a defined
  background to blend with.
- Whatever carries the form is opaque. A semi-transparent panel over a moving
  image is where sign-in forms become unreadable.

The mark is scaled down inside the render: at full scale it looked pressed against
the glass; like this it reads as a background. `object-cover` crops the top and
bottom of the square render; the band in the middle of the composition survives
at any ratio, and the cropped rows are pure black anyway.

### The frame

`BrandFrame` draws a 2px frame near the corners of the backdrop and sits **above**
the scrim — the frame is the shell, and it is not veiled along with the animation.

- No line touches another: each stops 40px short of the corner. The bottom pair
  sits exactly on the frame's bottom edge (`translate-y-1/2`), and the verticals
  stop 40px above it — the bottom line used to sit 18px above the edge, with the
  verticals hanging below it.
- The bottom edge is broken in the middle; in the gap the `BLACK TICKET` wordmark
  types itself in the terminal font, bold, under a block cursor. When typing
  finishes it waits 5 seconds, then types again. Its width is reserved in advance
  with an invisible copy of the text — otherwise the lines on either side would
  shift with every keystroke.
- The cursor only blinks once typing has finished; while typing it stays solid.
- On the **inner** face of the vertical lines — the side facing the mark — sit
  four bold `*` each. They do not drift: like a loading indicator they light up
  one by one, 1.7 seconds apart, stay lit together for 1.2 seconds, then go out at
  once and the count starts again.
- Each column keeps its own clock. The right one starts 3.2 seconds late; since
  both cycles are the same length, this one-off offset is permanent and the
  columns never count together. The right one also sits near the start of its
  vertical line, the left one in the middle.
- The timing lives in the component rather than in CSS: all four going out *at the
  same time* cannot be expressed as a shared keyframe timeline with a separate
  delay on each.
- It stays out of the accessibility tree (`aria-hidden`): the rail already states
  the product name. Below `lg` it is not drawn at all; the card takes its place.

Inside `LogoAnimation` the animation behaves like this:

1. The poster frame is underneath and paints immediately.
2. When the video is ready it appears on top, and the poster fades out at the
   same time. Because the crossfade is a real layer rather than the `poster`
   attribute, the screen stays filled even if the video stalls or the codec is
   refused.
3. `mix-blend-mode: screen` — the render has no alpha and a black background;
   screen treats black as "nothing", so the mark sits directly on the surface.
4. The video covers the panel **edge to edge**; the shrinking is done inside the
   render, not with a CSS `transform`. A transform leaves a small video box inside
   the large panel, and that box has an edge. In the file the mark is fitted into
   75% of the frame and the edge fade is baked into the pixels — details in
   [`design/brand/README.md`](../../design/brand/README.md).

The video downloads at every width: it is the design of the page, so dropping it
on narrow screens would leave an empty screen. It costs ~240 KB, less than the JS
bundle. The one exception is `prefers-reduced-motion`: there the video is never
requested, and the 28 KB still frame remains.

Producing the assets: [`design/brand/README.md`](../../design/brand/README.md).

## 5. The background after sign-in

The content column of the signed-in application is not flat black: the
`.app-backdrop` class draws the full lock-up (mark + wordmark) into `AppShell`'s
content column as a watermark.

- The watermark belongs to the column, not the whole shell — so it is centred in
  the area the reader looks at, and the sidebar does not push it off axis.
- The image has a black background and no alpha. For the same reason as the
  video, it is drawn with `background-blend-mode: screen`: black corresponds to
  "nothing", and the mark sits directly on the surface.
- Everything above it is opaque — the top bar, every card. The watermark only
  shows in the gaps.

How far it recedes is a single variable: `--watermark-veil`. It is the share of the
veil made of the surface colour; a higher value means a fainter logo. The default
is `82%`, so the mark is at about 18% strength — on a screen where tables are read
for a whole shift, it should be felt, not read.

## 6. Adding a new screen

1. Put it under `src/features/<area>/`, and add the route to the table in
   `src/app/App.tsx` and, if needed, to `NAV_ITEMS` in `AppShell`. Every route that
   needs a permission uses the `permission` field of `RequireAuth`.
2. `PageHeader` for the heading, `Card` for the body. Do not build your own
   heading layout.
3. Field groups are wrapped in `Field` — label, hint and error text in one place.
4. Loading state `Skeleton` / `TableSkeleton`, empty state `EmptyState`. Neither is
   skipped: a layout that jumps until the data arrives and an empty table with no
   explanation are two forms of the same bug.
5. Errors `Alert`, transient notifications `Toast`.
6. The product name is never written out; it comes from `BRANDING`. The logo is
   never drawn; use `BrandMark`.

## 7. Checks

```bash
npm run typecheck -w @black-ticket/web
npx eslint packages/web/src
npx prettier --check "packages/web/src/**/*.{ts,tsx,css}"
```
