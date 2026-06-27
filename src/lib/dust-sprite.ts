// Soft "dust" puff sprite for the player movement trail. A radial
// gradient (opaque-ish core → transparent edge) baked once per color
// into an offscreen canvas, blitted per particle at runtime. This is
// the perf-correct way to get a soft fuzzy edge: no per-frame
// shadowBlur and no per-frame createRadialGradient (both expensive,
// especially in Safari). Mirrors the bullet-sprite / pickup-sprite
// caching pattern.

const DUST_SPRITE_R = 32; // sprite radius in px (64×64 canvas)
const dustSprites = new Map<string, HTMLCanvasElement>();

function hexToRgb(hex: string): [number, number, number] {
  // Accept #rgb / #rrggbb; fall back to a neutral grey on anything else.
  let h = hex.trim();
  if (h[0] === "#") h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return [156, 163, 175];
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [156, 163, 175];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function getDustSprite(color: string): HTMLCanvasElement {
  let sprite = dustSprites.get(color);
  if (sprite) return sprite;

  const R = DUST_SPRITE_R;
  const c = document.createElement("canvas");
  c.width = R * 2;
  c.height = R * 2;
  dustSprites.set(color, c);
  const g = c.getContext("2d");
  if (!g) return c;

  const [r, gr, b] = hexToRgb(color);
  // Soft falloff: a small bright-ish core that fades smoothly to
  // nothing well before the edge, so the puff reads as a hazy mote of
  // dust rather than a hard dot.
  const grad = g.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 0.85)`);
  grad.addColorStop(0.35, `rgba(${r}, ${gr}, ${b}, 0.4)`);
  grad.addColorStop(0.7, `rgba(${r}, ${gr}, ${b}, 0.12)`);
  grad.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.fill();
  return c;
}
