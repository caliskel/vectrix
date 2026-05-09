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
  hp: "#4ade80",
  shield: "#60a5fa",
  scoreBoost: "#c084fc",
  breaker: "#fb923c",
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
  ctx.save();
  ctx.globalAlpha = alpha;
  const color = PICKUP_COLORS[p.type];
  switch (p.type) {
    case "hp":
      drawCross(ctx, p.x, p.y, color);
      break;
    case "shield":
      drawShieldShape(ctx, p.x, p.y, color);
      break;
    case "scoreBoost":
      drawDiamond(ctx, p.x, p.y, color);
      break;
    case "breaker":
      drawTriangleUp(ctx, p.x, p.y, color);
      break;
  }
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
