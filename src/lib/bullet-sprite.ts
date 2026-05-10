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

const BLUR_PX = 12; // matches the value used by the previous inline shadow pass
const PADDING_PX = BLUR_PX * 2;

const cache = new Map<string, HTMLCanvasElement>();

function build(color: string, size: number): HTMLCanvasElement {
  const dim = Math.ceil(size + PADDING_PX * 2);
  const c = document.createElement("canvas");
  c.width = dim;
  c.height = dim;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  // Bullet square + neon halo, baked once.
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = BLUR_PX;
  ctx.fillRect(PADDING_PX, PADDING_PX, size, size);
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
