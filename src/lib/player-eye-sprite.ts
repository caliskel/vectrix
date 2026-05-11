// Pre-rendered player outer-ring sprite — replaces the per-frame
// drawNeon(blur 25 + 10) on the eye's outer ring with a cached
// drawImage. The ring is the biggest per-frame shadowBlur on screen
// (large blur radius × always on screen), so caching it is the single
// biggest player-side win.
//
// Two sprite variants per profile:
//   idle: haloColor = profile.outerRing (matches the body cue)
//   dash: haloColor = profile.dashParticles (matches the trail cue)
//
// Cached by `${ringColor}|${haloColor}` — profile changes (live
// editor on the landing page → return to a game) rebuild on first use
// of the new colour. Each cache entry is one 100×100ish canvas; even
// dozens of profile permutations would fit in a few MB of GPU.
//
// Pupil stays live for now. Pupil drawNeon uses blur 10 + 4 (smaller
// radii, smaller cost) and the pupil position moves per frame, so the
// saving is much smaller than the ring.

import { PLAYER_SIZE } from "./config";

const BASE_RADIUS = PLAYER_SIZE / 2;
const RING_LINE_WIDTH = 2;
const BLUR_STRONG = 25;
const BLUR_SOFT = 10;
const PADDING = BLUR_STRONG * 2 + 4;
const SPRITE_DIM = (BASE_RADIUS + PADDING) * 2;

export const PLAYER_RING_SPRITE_ANCHOR = SPRITE_DIM / 2;
export const PLAYER_RING_SPRITE_BASE_RADIUS = BASE_RADIUS;

const cache = new Map<string, HTMLCanvasElement>();

function build(ringColor: string, haloColor: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SPRITE_DIM;
  c.height = SPRITE_DIM;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const cx = SPRITE_DIM / 2;
  const cy = SPRITE_DIM / 2;

  ctx.strokeStyle = ringColor;
  ctx.lineWidth = RING_LINE_WIDTH;
  ctx.shadowColor = haloColor;
  for (const blur of [BLUR_STRONG, BLUR_SOFT]) {
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.arc(cx, cy, BASE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}

export function getPlayerRingSprite(
  ringColor: string,
  haloColor: string,
): HTMLCanvasElement {
  const key = `${ringColor}|${haloColor}`;
  let s = cache.get(key);
  if (!s) {
    s = build(ringColor, haloColor);
    cache.set(key, s);
  }
  return s;
}
