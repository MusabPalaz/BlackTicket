# Brand assets

This folder is the **source**; `packages/web/public/brand/` is the **output**. None
of the files sent to the browser is edited by hand; all of them are produced from
the master renders here.

| File | What |
|---|---|
| `logo-animation.master.mp4` | The animation render — 2496×2496, 60 fps, 20 MB. Never shipped. |
| `logo-full.master.png` | The full lock-up (mark + wordmark) — 2508×2508, 1.3 MB. Never shipped. |
| `build-assets.sh` | The ffmpeg script that produces every runtime asset from the masters. |

## Rebuilding

```bash
bash design/brand/build-assets.sh
```

Requires ffmpeg. The script rewrites `packages/web/public/brand/` from scratch:

| Output | For | Size |
|---|---|---|
| `logo-animation.webm` | VP9, the browser's first choice | ~240 KB |
| `logo-animation.mp4` | H.264, fallback for Safari and older browsers | ~250 KB |
| `logo-poster.webp` | The frame shown until the video loads; replaces the video under reduced-motion preference | ~28 KB |
| `logo-mark.png` | The bare mark with its background turned into alpha — sidebar and narrow-screen lock-up | ~190 KB |
| `favicon.png` | Tab icon | ~55 KB |
| `logo-watermark.webp` | The watermark behind the signed-in application | ~84 KB |

21.6 MB in total → 844 KB. The only large file the sign-in screen downloads on
first load is the ~240 KB webm.

## If you change a master

`build-assets.sh` depends on two constants tied to the composition, which a new
render can shift:

- `crop` — the box inside the square master where the mark sits. Used only for
  the still crops (`logo-mark`, `favicon`); the video keeps the full frame,
  because the vignette is part of the animation.
- `still_at` — the second at which the still crops are taken. The first frame is
  mid-transition, so a moment from the middle is chosen.

## How the animation is packaged

The video covers the whole panel on the page. For there to be no visible edge at
all, two things are done inside the file rather than in CSS:

1. **The mark is fitted into 75% of the frame** (`mark` / `field`). Shrinking it
   with a CSS `transform` would leave a small video box inside the large panel,
   and that box would have an edge.
2. **The edges fall to true black.** The render's vignette is still ~8/255 at the
   frame edge; once screen blending lifts that above the surface, a sharp
   rectangle appears on the page. A **smoothstep** mask between `fade_in` and
   `fade_out` brings it to zero before the edge. A linear ramp was tried and did
   not work: its derivative has a corner at both ends, and the eye reads those
   corners as an outline — the rectangular edge went away and a rounded one took
   its place.

The mask is produced once as a single image and multiplied with every frame;
evaluating the expression per pixel per frame took minutes. The input is given
with `-loop`, otherwise the one-frame still becomes the shortest input and cuts
the encode down to a single frame.

The watermark is produced at its own brightness; how far it recedes is a CSS
decision (`--watermark-veil`), not something baked into the file. The setting is
described in [`packages/web/DESIGN.md`](../../packages/web/DESIGN.md).

No render has an alpha channel: the background is black, so brightness is used as
alpha (the `alpha` filter in `build-assets.sh`). For the same reason the video is
drawn in the interface with `mix-blend-mode: screen` — black corresponds to
"nothing", so the video box is invisible.

## A note on repository size

The masters are ~21.6 MB of binary in total and take up permanent space in the git
history. If you want to keep the repository small, move them to Git LFS or to
shared storage and leave only a link here — but do not delete them, as they are
the only copy.
