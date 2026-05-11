import { PALETTE } from "./palette";

export type PickupType = "hp" | "shield" | "scoreBoost" | "breaker";

export const PICKUP_TYPES: PickupType[] = [
  "hp",
  "shield",
  "scoreBoost",
  "breaker",
];

export type Pickup = {
  x: number;
  y: number;
  type: PickupType;
  age: number;
  lifetime: number;
};

export const PICKUP_COLORS: Record<PickupType, string> = {
  hp: PALETTE.pickupHP,
  shield: PALETTE.pickupShield,
  scoreBoost: PALETTE.pickupBoost,
  breaker: PALETTE.pickupBreaker,
};

export const PICKUP_LABELS: Record<PickupType, string> = {
  hp: "+1 HP",
  shield: "SHIELD",
  scoreBoost: "MULT BOOST",
  breaker: "BULLET BREAKER",
};

// rendered radius (half size) of pickup shapes; used both for drawing
// and for computing the pickup hitbox (radius * pickupRadiusMul)
export const PICKUP_HALF = 11;

export function rollPickupType(weights: Record<PickupType, number>): PickupType {
  const total = PICKUP_TYPES.reduce((s, t) => s + weights[t], 0);
  if (total <= 0) return "hp";
  let r = Math.random() * total;
  for (const t of PICKUP_TYPES) {
    if (r < weights[t]) return t;
    r -= weights[t];
  }
  return PICKUP_TYPES[PICKUP_TYPES.length - 1];
}

// Per-type drawing helpers — caller controls alpha via globalAlpha.
function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  const arm = PICKUP_HALF;
  const thick = 5;
  ctx.fillStyle = color;
  ctx.fillRect(x - arm, y - thick / 2, arm * 2, thick);
  ctx.fillRect(x - thick / 2, y - arm, thick, arm * 2);
}

function drawShieldShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, PICKUP_HALF, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, PICKUP_HALF - 4, 0, Math.PI * 2);
  ctx.stroke();
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, y - PICKUP_HALF);
  ctx.lineTo(x + PICKUP_HALF, y);
  ctx.lineTo(x, y + PICKUP_HALF);
  ctx.lineTo(x - PICKUP_HALF, y);
  ctx.closePath();
  ctx.stroke();
}

function drawTriangleUp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, y - PICKUP_HALF);
  ctx.lineTo(x + PICKUP_HALF, y + PICKUP_HALF * 0.85);
  ctx.lineTo(x - PICKUP_HALF, y + PICKUP_HALF * 0.85);
  ctx.closePath();
  ctx.stroke();
}

// === Sprite cache ===
// Each pickup type's shape + neon glow is baked into an offscreen
// canvas once and blitted thereafter. drawPickup() used to be wrapped
// in drawNeon (two shadowBlur passes), which is ~10× more expensive
// in Safari/WebKit than in Chrome/Skia. With the sprite, per-frame
// cost is a single drawImage regardless of how many pickups are on
// screen at once.
const PICKUP_GLOW_BLUR_STRONG = 22;
const PICKUP_GLOW_BLUR_SOFT = 8;
const PICKUP_SPRITE_PADDING = PICKUP_GLOW_BLUR_STRONG * 2;
const pickupSpriteCache = new Map<PickupType, HTMLCanvasElement>();
const pickupSpriteAnchor =
  PICKUP_SPRITE_PADDING + PICKUP_HALF + 2; /* +2 stroke leeway */

function buildPickupSprite(type: PickupType): HTMLCanvasElement {
  const dim = (PICKUP_HALF + 2) * 2 + PICKUP_SPRITE_PADDING * 2;
  const c = document.createElement("canvas");
  c.width = dim;
  c.height = dim;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const color = PICKUP_COLORS[type];
  // Origin in sprite space — the shape's centre.
  const cx = pickupSpriteAnchor;
  const cy = pickupSpriteAnchor;
  // Outer + inner glow stack, same recipe as drawNeon. Both passes
  // burn shadowBlur ONCE here, then we forget about it.
  ctx.shadowColor = color;
  ctx.shadowBlur = PICKUP_GLOW_BLUR_STRONG;
  drawPickupShape(ctx, type, cx, cy, color);
  ctx.shadowBlur = PICKUP_GLOW_BLUR_SOFT;
  drawPickupShape(ctx, type, cx, cy, color);
  return c;
}

function drawPickupShape(
  ctx: CanvasRenderingContext2D,
  type: PickupType,
  x: number,
  y: number,
  color: string,
): void {
  switch (type) {
    case "hp":
      drawCross(ctx, x, y, color);
      return;
    case "shield":
      drawShieldShape(ctx, x, y, color);
      return;
    case "scoreBoost":
      drawDiamond(ctx, x, y, color);
      return;
    case "breaker":
      drawTriangleUp(ctx, x, y, color);
      return;
  }
}

function getPickupSprite(type: PickupType): HTMLCanvasElement {
  let s = pickupSpriteCache.get(type);
  if (!s) {
    s = buildPickupSprite(type);
    pickupSpriteCache.set(type, s);
  }
  return s;
}

export function drawPickup(
  ctx: CanvasRenderingContext2D,
  p: Pickup,
  blinkDuration: number,
) {
  const remaining = p.lifetime - p.age;
  let alpha = 1;
  if (remaining < blinkDuration && remaining > 0) {
    // ~6Hz on/off blink
    const phase = Math.sin(p.age * 6 * Math.PI * 2);
    alpha = phase > 0 ? 1 : 0.25;
  }
  const sprite = getPickupSprite(p.type);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    sprite,
    p.x - pickupSpriteAnchor,
    p.y - pickupSpriteAnchor,
  );
  ctx.restore();
}

// HUD-row icon (smaller, fits a status line)
export function drawPickupIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: PickupType,
) {
  const color = PICKUP_COLORS[type];
  const r = 7;
  ctx.save();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  switch (type) {
    case "hp": {
      const t = 3;
      ctx.fillRect(x - r, y - t / 2, r * 2, t);
      ctx.fillRect(x - t / 2, y - r, t, r * 2);
      break;
    }
    case "shield":
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "scoreBoost":
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.stroke();
      break;
    case "breaker":
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.85);
      ctx.lineTo(x - r, y + r * 0.85);
      ctx.closePath();
      ctx.stroke();
      break;
  }
  ctx.restore();
}
