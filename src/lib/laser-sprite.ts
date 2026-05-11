// Pre-rendered watcher laser sprite — a horizontal beam strip with
// shadowBlur, mid glow and hot white core baked into an offscreen
// canvas. Drawn at runtime via translate+rotate+drawImage stretched
// to the live beam length, so the firing pass costs ONE drawImage
// instead of three shadowBlur strokes (16 + 8 + 12 px blur on a
// 1400-px arena beam was the dominant frame cost in Room 3 / boss
// fights once two watchers or a sweep laser kicked in).
//
// Sprite layout (horizontal):
//   - canvas is `SPRITE_LEN_PX` wide × `SPRITE_HEIGHT_PX` tall
//   - beam runs left-to-right along the canvas's horizontal axis
//   - canvas height contains the full halo radius so the bloom isn't
//     clipped when the sprite is drawn rotated
//   - the player blits with `drawImage(sprite, 0, -h/2, length, h)`
//     after translating to the start point and rotating to the beam
//     angle, so the sprite stretches lengthwise and stays centred
//     across the beam axis.

import { PALETTE } from "./palette";

// Sprite dimensions. SPRITE_LEN_PX picked large enough that stretching
// up to a 1400 px arena beam doesn't soften the bake noticeably; the
// halo is generated at full radius so the bloom stays crisp.
const SPRITE_LEN_PX = 64;
// 64 px tall comfortably contains the 16 px outer halo on each side
// of the 14 px-thick core (14 + 2 × 16 = 46 → 64 with margin).
const SPRITE_HEIGHT_PX = 64;
const HALO_BLUR = 16;
const MID_BLUR = 8;
const IMPACT_BLUR = 12;

type LaserSprite = {
  canvas: HTMLCanvasElement;
  /** Logical height of the sprite — the value the caller should use
   *  for the `height` argument of drawImage. */
  height: number;
};

const cache = new Map<string, LaserSprite>();

function build(color: string): LaserSprite {
  const c = document.createElement("canvas");
  c.width = SPRITE_LEN_PX;
  c.height = SPRITE_HEIGHT_PX;
  const ctx = c.getContext("2d");
  if (!ctx) return { canvas: c, height: SPRITE_HEIGHT_PX };
  const cy = SPRITE_HEIGHT_PX / 2;

  // Outer halo — wide blur, lw 14, full canvas length.
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = HALO_BLUR;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(SPRITE_LEN_PX, cy);
  ctx.stroke();

  // Hot white core — narrow blur, lw 4, painted on top.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.shadowBlur = MID_BLUR;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(SPRITE_LEN_PX, cy);
  ctx.stroke();

  return { canvas: c, height: SPRITE_HEIGHT_PX };
}

export function getLaserBeamSprite(color: string): LaserSprite {
  let sprite = cache.get(color);
  if (!sprite) {
    sprite = build(color);
    cache.set(color, sprite);
  }
  return sprite;
}

// Impact glow sprite — small radial dot used at the beam's wall-hit
// point. Single shadowBlur, same colour as the beam. Cached so the
// runtime draw is a drawImage.
const impactCache = new Map<string, HTMLCanvasElement>();

function buildImpact(color: string, radius: number): HTMLCanvasElement {
  const padding = IMPACT_BLUR * 2;
  const size = Math.ceil(radius * 2 + padding * 2);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const cx = size / 2;
  const cy = size / 2;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = IMPACT_BLUR;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function getLaserImpactSprite(
  color: string,
  radius: number,
): HTMLCanvasElement {
  // Round to nearest 2px to avoid cache bloat on per-pixel variation.
  const r = Math.round(radius / 2) * 2;
  const key = `${color}|${r}`;
  let sprite = impactCache.get(key);
  if (!sprite) {
    sprite = buildImpact(color, r);
    impactCache.set(key, sprite);
  }
  return sprite;
}

/** Offset from sprite top-left to the centre — used to align the
 *  impact dot at (l.endX, l.endY). */
export function getLaserImpactOffset(radius: number): number {
  const r = Math.round(radius / 2) * 2;
  return r + IMPACT_BLUR * 2;
}

// Re-export the palette colour the watcher uses so callers don't have
// to import PALETTE separately just for the laser draw.
export const LASER_BEAM_COLOR = PALETTE.bullet;
