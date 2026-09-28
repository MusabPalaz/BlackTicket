/**
 * Brand asset paths.
 *
 * Everything here is served from `public/brand/` rather than imported, so the
 * files are streamed on demand instead of being inlined or fingerprinted into
 * the JS bundle — the animation alone is larger than the whole app.
 *
 * These files are generated: edit `design/brand/build-assets.sh`, not the
 * output. The 20 MB master render lives in `design/brand/` and never ships.
 */
export const BRAND_ASSETS = {
  /** Looping logo animation, 720², 30 fps, no audio. Black background. */
  animationMp4: '/brand/logo-animation.mp4',
  animationWebm: '/brand/logo-animation.webm',
  /** Single frame of the animation; poster and reduced-motion stand-in. */
  animationPoster: '/brand/logo-poster.webp',
  /** The mark on its own, background keyed out. */
  mark: '/brand/logo-mark.png',
} as const;
