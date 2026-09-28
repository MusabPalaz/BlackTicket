#!/usr/bin/env bash
#
# Regenerates every runtime brand asset from the master render.
#
# The masters are a 2496x2496 / 60 fps / 20 MB video export and a 2508x2508
# still lockup — fine as sources of truth, impossible to put on a page as they
# are. Everything the browser actually downloads is derived here so the
# transforms stay reproducible instead of living in someone's video editor.
#
# Requires ffmpeg. Run from anywhere:  bash design/brand/build-assets.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
master="$here/logo-animation.master.mp4"
full="$here/logo-full.master.png"
out="$root/packages/web/public/brand"

# Bounding box of the painted mark inside the square master, with a little
# breathing room. Used for the still cut-outs only.
crop="crop=2236:1140:130:600"

# The animation fills its whole panel on the page, edge to edge, so there is no
# seam between "video" and "page" to give itself away. Two things have to be
# true in the file for that to hold:
#
#   1. The mark is scaled to 75% inside a black frame here, not shrunk with a
#      CSS transform. A transform leaves a smaller video box sitting inside a
#      larger panel, and that box has an edge.
#   2. Everything outside the mark reaches *true* black. The render carries a
#      vignette that is still ~8/255 at the frame edge, and screen-blending
#      that onto the surface lifts it to a plainly visible rectangle. The
#      falloff below multiplies it down to zero by the edge.
#
# The falloff is a smoothstep, not a linear ramp. A linear ramp has a corner in
# its derivative at both ends, and the eye reads those corners as an outline —
# swapping one visible edge for another, rounder one.
field=720          # rendered frame, square
mark=540           # 75% of the frame
pad=$(( (field - mark) / 2 ))
fade_out="1.00"    # normalised radius where the picture reaches black
fade_in="0.58"     # …and where it starts leaving the mark alone (tips sit at 0.62)
mask="$here/.falloff-mask.png"

# A frame where the glitch pass has settled; the very first frame is mid-fade.
still_at="4.2"

# Black is the animation's background, not part of the mark, so luminance
# doubles as the alpha channel. The gain and lift clip the vignette away
# without eating the dimmer particles at the wing tips.
alpha="format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(1.35*max(max(r(X,Y),g(X,Y)),b(X,Y))-14,0,255)'"

mkdir -p "$out"

# The falloff is a still ramp multiplied over every frame. Built once as an
# image because evaluating the expression per pixel per frame is minutes of
# work; multiplying by a prepared mask is milliseconds. It is fed with -loop so
# that the single still does not become the shortest input and cut the encode
# down to one frame.
trap 'rm -f "$mask"' EXIT
ffmpeg -v error -y -f lavfi -i "color=c=black:s=${field}x${field}" -frames:v 1   -vf "format=gray,geq=lum='255*(pow(clip(($fade_out-hypot((X-W/2)/(W/2),(Y-H/2)/(H/2)))/($fade_out-$fade_in),0,1),2)*(3-2*clip(($fade_out-hypot((X-W/2)/(W/2),(Y-H/2)/(H/2)))/($fade_out-$fade_in),0,1)))',format=rgb24"   "$mask"

# Scale the mark down inside the frame, then multiply the falloff over it.
field_in="[0:v]scale=$mark:$mark:flags=lanczos,pad=$field:$field:$pad:$pad:color=black,format=gbrp[m];[1:v]format=gbrp[k];[m][k]blend=all_mode=multiply:shortest=1,format=yuv420p[v]"

echo "→ logo-animation.mp4"
ffmpeg -v error -y -i "$master" -loop 1 -i "$mask" \
  -filter_complex "$field_in" -map "[v]" -r 30 \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -preset slow -crf 30 -g 60 \
  -an -movflags +faststart \
  "$out/logo-animation.mp4"

echo "→ logo-animation.webm"
ffmpeg -v error -y -i "$master" -loop 1 -i "$mask" \
  -filter_complex "$field_in" -map "[v]" -r 30 \
  -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -deadline good -cpu-used 2 \
  -an \
  "$out/logo-animation.webm"

echo "→ logo-poster.webp"
ffmpeg -v error -y -ss "$still_at" -i "$master" -i "$mask" \
  -filter_complex "$field_in" -map "[v]" -frames:v 1 -quality 82 \
  "$out/logo-poster.webp"

echo "→ logo-mark.png"
ffmpeg -v error -y -ss "$still_at" -i "$master" -frames:v 1 \
  -vf "$crop,scale=512:-1:flags=lanczos,$alpha" \
  "$out/logo-mark.png"

echo "→ favicon.png"
ffmpeg -v error -y -ss "$still_at" -i "$master" -frames:v 1 \
  -vf "$crop,scale=256:-1:flags=lanczos,$alpha,pad=256:256:0:(oh-ih)/2:color=#00000000" \
  "$out/favicon.png"

echo "→ logo-watermark.webp"
# The full lockup — mark plus wordmark — used as the watermark behind the
# signed-in app. Kept at its own brightness: how far it recedes is a CSS
# decision ("--watermark-veil"), not something baked into the file.
ffmpeg -v error -y -i "$full"   -vf "scale=1280:1280:flags=lanczos" -quality 78   "$out/logo-watermark.webp"

echo
ls -l "$out"
