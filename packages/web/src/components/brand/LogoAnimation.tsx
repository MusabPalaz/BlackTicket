import { useCallback, useState } from 'react';
import { BRANDING } from '@black-ticket/shared';
import { cx } from '@/components/ui';
import { useReducedMotion } from '@/lib/use-media-query';
import { BRAND_ASSETS } from './assets';

const FIT = {
  /** Fills the box, cropping the square render's top and bottom. */
  cover: 'object-cover',
  /** Fits the box whole. */
  contain: 'object-contain',
} as const;

// Tailwind has no `duration-*` theme namespace, so the token is referenced
// through an arbitrary value rather than a named utility.
const FADE = 'transition-opacity duration-[var(--duration-brand)]';

/**
 * The animated logo.
 *
 * Two things make it sit on the page instead of on top of it:
 *
 * - `mix-blend-mode: screen`. The render has a black background rather than an
 *   alpha channel, and screen blending maps black to "nothing" — so the mark
 *   lands directly on whatever surface it is over, with no visible video box.
 *   The caller must give the element behind it an opaque background and its
 *   own stacking context, or there is nothing well-defined to blend against.
 *   The render reaches true black before its own edge (the falloff is applied
 *   in `design/brand/build-assets.sh`, not here) so there is no pedestal left
 *   to lift the element clear of the page it sits on.
 * - The poster frame is a real layer underneath, not the `poster` attribute.
 *   It paints immediately and cross-fades out as the video takes over, so the
 *   panel is never empty — including when the video stalls or the codec is
 *   refused, where a bare `poster` would have been hidden along with it.
 *
 * Reduced motion gets the still frame and no video request at all.
 */
export function LogoAnimation({
  fit = 'cover',
  className,
}: {
  fit?: keyof typeof FIT;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);

  const label = `${BRANDING.productName} logo`;
  // Every layer occupies the same single grid cell, which stacks them without
  // absolute positioning — so the caller stays free to position the wrapper
  // itself without the two position utilities fighting each other. The track
  // is an explicit 1fr; an implicit one would size to the media instead of to
  // the box, and the layers would spill past it.
  const layer = cx('col-start-1 row-start-1 h-full w-full mix-blend-screen', FIT[fit], FADE);

  // Subscribing from the ref rather than through an onLoadedData prop: the
  // first frame is often already decoded by the time React would attach, and a
  // media event that has been and gone takes the fade with it.
  const attach = useCallback((element: HTMLVideoElement | null) => {
    if (!element) return;
    if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setReady(true);
      return;
    }
    const onReady = () => setReady(true);
    element.addEventListener('loadeddata', onReady, { once: true });
    return () => element.removeEventListener('loadeddata', onReady);
  }, []);

  return (
    <div className={cx('grid grid-cols-1 grid-rows-1 overflow-hidden', className)}>
      <img
        src={BRAND_ASSETS.animationPoster}
        alt={label}
        className={cx(layer, !reducedMotion && ready && 'opacity-0')}
      />

      {!reducedMotion && (
        <video
          ref={attach}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          className={cx(layer, ready ? 'opacity-100' : 'opacity-0')}
        >
          <source src={BRAND_ASSETS.animationWebm} type="video/webm" />
          <source src={BRAND_ASSETS.animationMp4} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
