// Pre-rendered bullet sprites — one offscreen canvas per (color, size)
// combo, stamped into the world via drawImage instead of paying for a
// per-bullet shadowBlur fillRect. Phase 3 of the boss fight runs ~50-80
// bullets steady-state; per-bullet shadowBlur was dominating the frame
// budget (each call rasterises an offscreen buffer scaled to the blur
// radius), and replacing it with a cached drawImage drops per-bullet
// cost by ~10-20x.
//
// Cache is keyed on color + size so a settings change still works (live
// tweaks build a new sprite on first paint, then reuse it). The sprite
// includes 2 * BLUR_PX of padding on each side so the soft halo isn't
// clipped at the edges.

const BLUR_PX = 14;
const PADDING_PX = BLUR_PX * 2;
// Hot-core inset — the inner bright spot that reads as "energy
// concentrated at the centre". Scales with bullet size so small
// bullets still get a visible core and big ones don't lose it
// to the halo.
const CORE_INSET_FRAC = 0.35;
const CORE_ALPHA = 0.92;

const cache = new Map<string, HTMLCanvasElement>();

function build(color: string, size: number): HTMLCanvasElement {
  const dim = Math.ceil(size + PADDING_PX * 2);
  const c = document.createElement("canvas");
  c.width = dim;
  c.height = dim;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const cx = PADDING_PX;
  const cy = PADDING_PX;

  // Outer body with layered glow — two passes give the bullet a sharp
  // core and a soft halo without a separate stroke pass. Squared corners
  // because the bullet shape is a tilted square, but a small rotation
  // would also work if we ever want diamond projectiles.
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = BLUR_PX;
  ctx.fillRect(cx, cy, size, size);
  // Tighter glow on top — punches up the body edge.
  ctx.shadowBlur = BLUR_PX * 0.5;
  ctx.fillRect(cx, cy, size, size);

  // Hot-core white square, no glow. Sits visually inside the colour
  // body so each bullet reads as "energy". Drawn after the body so it
  // sits on top.
  const coreSize = Math.max(1, size * (1 - CORE_INSET_FRAC * 2));
  const coreOff = (size - coreSize) / 2;
  ctx.shadowBlur = 0;
  ctx.globalAlpha = CORE_ALPHA;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx + coreOff, cy + coreOff, coreSize, coreSize);
  ctx.globalAlpha = 1;

  return c;
}

export function getBulletSprite(
  color: string,
  size: number,
): HTMLCanvasElement {
  const key = `${color}|${size}`;
  let sprite = cache.get(key);
  if (!sprite) {
    sprite = build(color, size);
    cache.set(key, sprite);
  }
  return sprite;
}

/** Distance from sprite's top-left corner to the bullet's centre.
 *  Callers blit at `(b.x - offset, b.y - offset)`. */
export function getBulletSpriteOffset(size: number): number {
  return PADDING_PX + size / 2;
}
