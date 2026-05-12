// Key pickup — golden diamond + stem + teeth. Doesn't expire (lives
// at the kill site until the player walks over it). One key per room
// for now; rooms-game tracks a `keyHeld: boolean`.

const KEY_COLOR = "#ffd60a";
const KEY_RADIUS = 10;
const KEY_PICKUP_RADIUS = 28;
const KEY_GLOW_BLUR = 18;
const KEY_GLOW_SOFT = 6;
const KEY_SPAWN_DURATION_SEC = 0.25;
const KEY_BOB_HZ = 1.6;
const KEY_BOB_AMPLITUDE_PX = 3;

// === Sprite cache ===
// drawKey was using drawNeon (two shadowBlur passes per frame) which
// is ~10× more expensive in Safari/WebKit than in Chrome/Skia. The
// key shape is static, so we bake the glow + body into an offscreen
// canvas ONCE and blit it every frame. Per-frame cost drops from
// 2 × shadowBlur to a single drawImage.
let keySprite: HTMLCanvasElement | null = null;
let keySpriteAnchor = 0;

function buildKeySprite(): { canvas: HTMLCanvasElement; anchor: number } {
  // The key body extends from y = -KEY_RADIUS to roughly y = KEY_RADIUS + 11
  // (diamond + stem + teeth). With KEY_GLOW_BLUR = 18 of padding on each
  // side, the sprite needs ~ (KEY_RADIUS * 2 + 11 + 4 * KEY_GLOW_BLUR)
  // square — generous padding keeps the bloom unclipped.
  const padding = KEY_GLOW_BLUR * 2;
  const w = KEY_RADIUS * 2 + padding * 2 + 8; // +8 for tooth width to the right
  const h = KEY_RADIUS * 2 + 12 + padding * 2; // +12 for stem + teeth tail
  const c = document.createElement("canvas");
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  const ctx = c.getContext("2d");
  // Anchor — distance from the sprite's top-left to the key's
  // logical origin (the centre of the diamond).
  const anchorX = padding + KEY_RADIUS;
  const anchorY = padding + KEY_RADIUS;
  if (!ctx) return { canvas: c, anchor: anchorX };
  ctx.save();
  ctx.translate(anchorX, anchorY);
  // Outer glow pass (strong blur).
  ctx.fillStyle = KEY_COLOR;
  ctx.shadowColor = KEY_COLOR;
  ctx.shadowBlur = KEY_GLOW_BLUR;
  drawKeyBody(ctx);
  // Inner glow pass (sharp blur).
  ctx.shadowBlur = KEY_GLOW_SOFT;
  drawKeyBody(ctx);
  ctx.restore();
  return { canvas: c, anchor: anchorX };
}

function drawKeyBody(ctx: CanvasRenderingContext2D): void {
  // Diamond head.
  ctx.beginPath();
  ctx.moveTo(0, -KEY_RADIUS);
  ctx.lineTo(KEY_RADIUS, 0);
  ctx.lineTo(0, KEY_RADIUS);
  ctx.lineTo(-KEY_RADIUS, 0);
  ctx.closePath();
  ctx.fillStyle = KEY_COLOR;
  ctx.fill();
  // Stem + teeth.
  ctx.fillRect(-2, 0, 4, KEY_RADIUS + 4);
  ctx.fillRect(2, KEY_RADIUS + 2, 4, 3);
  ctx.fillRect(2, KEY_RADIUS + 8, 3, 3);
}

function getKeySprite(): HTMLCanvasElement {
  if (!keySprite) {
    const built = buildKeySprite();
    keySprite = built.canvas;
    keySpriteAnchor = built.anchor;
  }
  return keySprite;
}

export type Key = {
  x: number;
  y: number;
  collected: boolean;
  /** Counts up while the key is on the floor; drives spawn-pop and bob. */
  age: number;
};

export function createKey(x: number, y: number): Key {
  return { x, y, collected: false, age: 0 };
}

export function updateKey(key: Key, dt: number): void {
  if (key.collected) return;
  key.age += dt;
}

export function checkKeyPickup(
  key: Key,
  px: number,
  py: number,
): boolean {
  if (key.collected) return false;
  const dx = px - key.x;
  const dy = py - key.y;
  return dx * dx + dy * dy < KEY_PICKUP_RADIUS * KEY_PICKUP_RADIUS;
}

export function drawKey(ctx: CanvasRenderingContext2D, key: Key): void {
  if (key.collected) return;
  // Spawn pop: scale from 0.4 → 1.0 over the first 250 ms so the key
  // doesn't appear as a hard pop at the kill site.
  const spawnT = Math.min(1, key.age / KEY_SPAWN_DURATION_SEC);
  const scale = 0.4 + 0.6 * spawnT;
  // Subtle hover so the player notices it.
  const bobY = Math.sin(key.age * KEY_BOB_HZ * Math.PI * 2) * KEY_BOB_AMPLITUDE_PX;
  const sprite = getKeySprite();
  ctx.save();
  ctx.translate(key.x, key.y + bobY);
  ctx.scale(scale, scale);
  ctx.drawImage(sprite, -keySpriteAnchor, -keySpriteAnchor);
  ctx.restore();
}

/** HUD slot(s) — golden silhouette outline when not yet collected,
 *  solid filled key icon when held. For `required > 1`, renders
 *  `required` slots in a horizontal row; first `held` slots are
 *  filled gold, the rest are dim silhouettes. (x, y) is the
 *  left-most icon's center in screen px. */
export function drawKeyHudIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  held: number,
  required = 1,
): void {
  const slotSpacing = 18;
  for (let i = 0; i < required; i++) {
    const slotX = x + i * slotSpacing;
    drawSingleKeyHudSlot(ctx, slotX, y, i < held);
  }
}

function drawSingleKeyHudSlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  filled: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = filled ? 1 : 0.4;
  const r = 6;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r, 0);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = KEY_COLOR;
    ctx.fill();
  }
  ctx.strokeStyle = KEY_COLOR;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (filled) {
    ctx.fillStyle = KEY_COLOR;
    ctx.fillRect(-1.5, 0, 3, 8);
    ctx.fillRect(1.5, 6, 3, 2);
  } else {
    ctx.strokeRect(-1.5, 0, 3, 8);
  }
  ctx.restore();
}

export const KEY_PICKUP_RADIUS_PX = KEY_PICKUP_RADIUS;
