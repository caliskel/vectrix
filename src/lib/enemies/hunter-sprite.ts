// Pre-rendered hunter body sprite — the arrow polygon + neon stroke +
// translucent inner fill, baked once with a mid-range glow. Used by
// both the live body draw and every trail-ghost sample so per-frame
// cost collapses from N shadowBlur passes (one per ghost + one for the
// live body) to N drawImage calls.
//
// In Room 4 the hunter trail emits a ghost every 25 ms while aggro, so
// the live render path was doing 6+ shadowBlur ops per hunter per
// frame. With 6 hunters in flight (the lazy-spawn pool) that's ~36
// shadow ops just for trails. Sprite cache drops that to one cached
// fill+stroke at build time.
//
// Tradeoff: the per-speed glow ramp (blur 12 idle → 20 max) is lost,
// since the sprite is baked at a single blur value. In practice the
// ramp was a subtle visual tell that didn't survive past the size
// shake of fast motion anyway.

const HUNTER_COLOR = "#fb923c";
const POLY: Array<readonly [number, number]> = [
  [-22, -12],
  [22, 0],
  [-22, 12],
  [-10, 0],
];
const POLY_HALF_EXTENT = 22; // max(|x|, |y|) across POLY vertices

const FILL_ALPHA = 0.4;
const STROKE_WIDTH = 2;
const BAKED_GLOW_BLUR = 16; // midpoint of the live 12..20 ramp

const PADDING = BAKED_GLOW_BLUR * 2 + 8;
const DIM = (POLY_HALF_EXTENT + PADDING) * 2;
export const HUNTER_SPRITE_ANCHOR = DIM / 2;

let sprite: HTMLCanvasElement | null = null;

function tracePoly(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  ctx.beginPath();
  ctx.moveTo(ox + POLY[0][0], oy + POLY[0][1]);
  for (let i = 1; i < POLY.length; i++) {
    ctx.lineTo(ox + POLY[i][0], oy + POLY[i][1]);
  }
  ctx.closePath();
}

function build(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = DIM;
  c.height = DIM;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const ox = DIM / 2;
  const oy = DIM / 2;

  // Inner translucent fill — flat, no shadow.
  ctx.globalAlpha = FILL_ALPHA;
  ctx.fillStyle = HUNTER_COLOR;
  tracePoly(ctx, ox, oy);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Outer neon stroke with layered glow (mirrors drawNeon strong+soft).
  ctx.strokeStyle = HUNTER_COLOR;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.shadowColor = HUNTER_COLOR;
  for (const blur of [BAKED_GLOW_BLUR, 4]) {
    ctx.shadowBlur = blur;
    tracePoly(ctx, ox, oy);
    ctx.stroke();
  }
  return c;
}

export function getHunterSprite(): HTMLCanvasElement {
  if (!sprite) sprite = build();
  return sprite;
}
