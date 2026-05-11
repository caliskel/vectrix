// Pre-rendered player outer-ring sprite — replaces the per-frame
// drawNeon(blur 25 + 10) on the eye's outer ring with a cached
// drawImage. The ring is the biggest per-frame shadowBlur on screen
// (large blur radius × always on screen), so caching it is the single
// biggest player-side win.
//
// Cached by `${ringColor}|${haloColor}|${radius}` — building per
// radius lets the menu previews (64 / 110 px players) get a sharp
// sprite instead of an upscaled, pixelated copy of the in-game ring.
// Blur radii scale with the body so the halo silhouette stays
// proportionally similar across sizes.
//
// Pupil stays live for now. Pupil drawNeon uses blur 10 + 4 (smaller
// radii, smaller cost) and the pupil position moves per frame, so the
// saving is much smaller than the ring.

import { PLAYER_SIZE } from "./config";

const RING_LINE_WIDTH = 2;
const REF_RADIUS = PLAYER_SIZE / 2;
const REF_BLUR_STRONG = 25;
const REF_BLUR_SOFT = 10;
const BLUR_SCALE_CAP = 2.4; // don't let big previews demand huge blur radii

interface RingSpriteEntry {
  canvas: HTMLCanvasElement;
  anchor: number;
}

const cache = new Map<string, RingSpriteEntry>();

function build(
  ringColor: string,
  haloColor: string,
  radius: number,
): RingSpriteEntry {
  // Scale glow with the rendered body so a 110 px profile preview
  // doesn't have the same 25 px blur as a 32 px in-game eye (that
  // looks puny relative to the ring). Capped so absurd radii don't
  // generate impractical sprite sizes.
  const blurScale = Math.min(BLUR_SCALE_CAP, radius / REF_RADIUS);
  const blurStrong = REF_BLUR_STRONG * blurScale;
  const blurSoft = REF_BLUR_SOFT * blurScale;
  const padding = blurStrong * 2 + 4;
  const dim = Math.ceil((radius + padding) * 2);

  const c = document.createElement("canvas");
  c.width = dim;
  c.height = dim;
  const ctx = c.getContext("2d");
  if (!ctx) return { canvas: c, anchor: dim / 2 };
  const cx = dim / 2;
  const cy = dim / 2;

  ctx.strokeStyle = ringColor;
  ctx.lineWidth = RING_LINE_WIDTH;
  ctx.shadowColor = haloColor;
  for (const blur of [blurStrong, blurSoft]) {
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  return { canvas: c, anchor: dim / 2 };
}

export function getPlayerRingSprite(
  ringColor: string,
  haloColor: string,
  radius: number,
): RingSpriteEntry {
  const key = `${ringColor}|${haloColor}|${Math.round(radius)}`;
  let s = cache.get(key);
  if (!s) {
    s = build(ringColor, haloColor, radius);
    cache.set(key, s);
  }
  return s;
}
