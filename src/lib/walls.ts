import { PALETTE } from "./palette";
import type { Player } from "./player";

export type Wall = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** When true, the player phases through this wall while in dash
   *  i-frames. Other entities (enemies, bullets, lasers) still treat
   *  it as solid. Tagged on Tutorial Room 0's dash gate and the Room
   *  4 corridor's section dividers. */
  dashable?: boolean;
};

/** Anything we resolve walls against. Player and the moving enemies
 *  (Watcher, Hunter) all satisfy this shape, so the resolver is shared. */
export type WallEntity = { x: number; y: number; vx: number; vy: number };

/**
 * AABB resolve: pushes the entity out of any wall it overlaps along
 * the axis with the smallest penetration, zeroing the matching
 * velocity component so the entity slides along the wall instead of
 * locking in. Used by both player movement and enemy chases.
 */
export function resolveEntityWallCollisions(
  entity: WallEntity,
  walls: Wall[],
  halfSize: number,
): { stoppedX: boolean; stoppedY: boolean } {
  let stoppedX = false;
  let stoppedY = false;
  for (const w of walls) {
    const px1 = entity.x - halfSize;
    const px2 = entity.x + halfSize;
    const py1 = entity.y - halfSize;
    const py2 = entity.y + halfSize;
    const wx1 = w.x;
    const wx2 = w.x + w.w;
    const wy1 = w.y;
    const wy2 = w.y + w.h;
    if (px2 <= wx1 || px1 >= wx2 || py2 <= wy1 || py1 >= wy2) continue;
    const oLeft = px2 - wx1;
    const oRight = wx2 - px1;
    const oTop = py2 - wy1;
    const oBottom = wy2 - py1;
    const m = Math.min(oLeft, oRight, oTop, oBottom);
    if (m === oLeft) {
      entity.x -= oLeft;
      if (entity.vx > 0) entity.vx = 0;
      stoppedX = true;
    } else if (m === oRight) {
      entity.x += oRight;
      if (entity.vx < 0) entity.vx = 0;
      stoppedX = true;
    } else if (m === oTop) {
      entity.y -= oTop;
      if (entity.vy > 0) entity.vy = 0;
      stoppedY = true;
    } else {
      entity.y += oBottom;
      if (entity.vy < 0) entity.vy = 0;
      stoppedY = true;
    }
  }
  return { stoppedX, stoppedY };
}

/** Backwards-compatible alias for the previous player-only signature. */
export function resolvePlayerWallCollisions(
  player: Player,
  walls: Wall[],
  halfSize: number,
): { stoppedX: boolean; stoppedY: boolean } {
  return resolveEntityWallCollisions(player, walls, halfSize);
}

// True if the bullet's center sits inside any wall's AABB. Returns the
// hit wall so callers can spawn an impact ripple at the contact point.
export function bulletInsideWall(
  bx: number,
  by: number,
  walls: Wall[],
): boolean {
  for (const w of walls) {
    if (bx >= w.x && bx <= w.x + w.w && by >= w.y && by <= w.y + w.h) {
      return true;
    }
  }
  return false;
}

// Variant that returns the first wall hit, for spawning impact FX on
// the wall surface. Returns null when the point is outside every wall.
export function findContainingWall(
  bx: number,
  by: number,
  walls: Wall[],
): Wall | null {
  for (const w of walls) {
    if (bx >= w.x && bx <= w.x + w.w && by >= w.y && by <= w.y + w.h) {
      return w;
    }
  }
  return null;
}

const WALL_FILL = "rgba(28, 35, 60, 0.85)";
const WALL_STROKE = "#7dd3fc";
const WALL_STROKE_ALPHA = 0.6;
const WALL_GLOW_BLUR = 12;
const DASHABLE_GLOW_BLUR = 14;
const BRACKET_LEN_PX = 14;
const BRACKET_INSET_PX = 2;
const BRACKET_LINE_WIDTH = 2.5;
const HATCH_SPACING_PX = 8;
const HATCH_ALPHA = 0.05;
const MARCHING_DASH_INSET_PX = 4;
const MARCHING_DASH_PATTERN = [10, 14] as const;
const MARCHING_DASH_SPEED = 28; // px/s lineDashOffset drift
const MARCHING_DASH_ALPHA = 0.35;
const PERIMETER_PULSE_INTERVAL_MIN = 4.0;
const PERIMETER_PULSE_INTERVAL_MAX = 9.0;
const PERIMETER_PULSE_SPEED = 380; // px/s along perimeter
const PERIMETER_PULSE_HEAD_RADIUS = 3.2;
const PERIMETER_PULSE_GLOW = 14;
const PERIMETER_PULSE_COLOR = "#a5f3fc";
const RIPPLE_LIFETIME_SEC = 0.45;
const RIPPLE_RADIUS_START = 4;
const RIPPLE_RADIUS_END = 28;
const RIPPLE_LINE_WIDTH_START = 2.5;
const RIPPLE_LINE_WIDTH_END = 0.5;
const RIPPLE_GLOW = 10;
const RIPPLE_COLOR = "#a5f3fc";
const RIPPLE_FRAGMENT_COUNT = 0; // reserved for later; keep ring-only for now

// Wall layer cache: walls don't move within a room, so we bake them
// into an offscreen canvas the first frame the array is seen and blit
// per frame afterwards. Animated overlays (marching dashes, perimeter
// pulses, impact ripples) draw live on top via drawWallOverlay.
type CachedLayer = {
  canvas: HTMLCanvasElement;
  extentX: number;
  extentY: number;
  // Wall count at cache time. Tutorial Room 0 mutates the walls array
  // mid-room (phase 2 pushes the dashable dash gate); the array
  // reference is unchanged but contents differ, so we also key on
  // length here. Without this, the cached image stays from phase 1
  // and the dash wall renders invisibly.
  wallCount: number;
};
const layerCache = new WeakMap<Wall[], CachedLayer>();

type PerimeterPulse = {
  wallIndex: number;
  progress: number; // px travelled along the perimeter
  perimeter: number;
};

type WallRipple = {
  x: number;
  y: number;
  age: number; // 0..RIPPLE_LIFETIME_SEC
};

// FX state is animation-only (timers + spawned entities). The walls
// array is passed per call so tutorial Room 0's phase mutations
// (.push of the dash wall, .filter reassign in combat) are picked up
// without needing a separate sync step on every phase change.
export type WallFx = {
  marchOffset: number;
  pulses: PerimeterPulse[];
  ripples: WallRipple[];
  pulseTimer: number;
};

export function createWallFx(_walls?: Wall[]): WallFx {
  return {
    marchOffset: 0,
    pulses: [],
    ripples: [],
    pulseTimer: pickInterval(PERIMETER_PULSE_INTERVAL_MIN, PERIMETER_PULSE_INTERVAL_MAX) * 0.5,
  };
}

export function updateWallFx(fx: WallFx, dt: number, walls: Wall[]): void {
  fx.marchOffset = (fx.marchOffset + MARCHING_DASH_SPEED * dt) % 24;

  // Pulse spawn — pick a non-dashable wall (dashable walls are
  // semantic markers, the pulse would clash with their existing
  // marching dashed outline).
  fx.pulseTimer -= dt;
  if (fx.pulseTimer <= 0) {
    fx.pulseTimer = pickInterval(PERIMETER_PULSE_INTERVAL_MIN, PERIMETER_PULSE_INTERVAL_MAX);
    const eligible: number[] = [];
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (!w.dashable && w.w >= 40 && w.h >= 40) eligible.push(i);
    }
    if (eligible.length > 0) {
      const idx = eligible[Math.floor(Math.random() * eligible.length)];
      const w = walls[idx];
      const perimeter = 2 * (w.w + w.h);
      fx.pulses.push({
        wallIndex: idx,
        progress: Math.random() * perimeter,
        perimeter,
      });
    }
  }
  for (let i = fx.pulses.length - 1; i >= 0; i--) {
    const p = fx.pulses[i];
    p.progress += PERIMETER_PULSE_SPEED * dt;
    if (p.progress > p.perimeter * 1.5) fx.pulses.splice(i, 1);
  }

  // Ripples — age out.
  for (let i = fx.ripples.length - 1; i >= 0; i--) {
    const r = fx.ripples[i];
    r.age += dt;
    if (r.age >= RIPPLE_LIFETIME_SEC) fx.ripples.splice(i, 1);
  }
}

export function addWallImpact(fx: WallFx, x: number, y: number): void {
  fx.ripples.push({ x, y, age: 0 });
}

function paintWalls(ctx: CanvasRenderingContext2D, walls: Wall[]): void {
  // 1. Solid fill — one batched pass.
  ctx.save();
  ctx.fillStyle = WALL_FILL;
  ctx.shadowBlur = 0;
  for (const w of walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  ctx.restore();

  // 2. Inner diagonal hatching — adds texture without adding visual
  // weight. Clipped to each wall so the lines stop at the boundary.
  ctx.save();
  ctx.strokeStyle = WALL_STROKE;
  ctx.globalAlpha = HATCH_ALPHA;
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  for (const w of walls) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    const minD = w.x - w.h;
    const maxD = w.x + w.w;
    ctx.beginPath();
    for (let d = minD; d <= maxD; d += HATCH_SPACING_PX) {
      ctx.moveTo(d, w.y);
      ctx.lineTo(d + w.h, w.y + w.h);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // 3. Outer stroke — grouped by style so shadowBlur fires once per
  // group instead of per wall.
  const solidWalls: Wall[] = [];
  const dashableWalls: Wall[] = [];
  for (const w of walls) {
    if (w.dashable) dashableWalls.push(w);
    else solidWalls.push(w);
  }

  if (solidWalls.length > 0) {
    ctx.save();
    ctx.globalAlpha = WALL_STROKE_ALPHA;
    ctx.strokeStyle = WALL_STROKE;
    ctx.shadowColor = WALL_STROKE;
    ctx.shadowBlur = WALL_GLOW_BLUR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const w of solidWalls) {
      ctx.rect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (dashableWalls.length > 0) {
    ctx.save();
    ctx.strokeStyle = PALETTE.playerDash;
    ctx.shadowColor = PALETTE.playerDash;
    ctx.shadowBlur = DASHABLE_GLOW_BLUR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    for (const w of dashableWalls) {
      ctx.rect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 4. Corner brackets — sit on top of the outline. Brighter, thicker
  // strokes at each corner make the wall read as a "technical" panel
  // rather than a flat box. Skipped for dashable walls so their
  // signature dashed silhouette stays unambiguous.
  if (solidWalls.length > 0) {
    ctx.save();
    ctx.strokeStyle = WALL_STROKE;
    ctx.shadowColor = WALL_STROKE;
    ctx.shadowBlur = WALL_GLOW_BLUR;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = BRACKET_LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const w of solidWalls) {
      const len = Math.min(BRACKET_LEN_PX, Math.min(w.w, w.h) * 0.3);
      const x1 = w.x + BRACKET_INSET_PX;
      const y1 = w.y + BRACKET_INSET_PX;
      const x2 = w.x + w.w - BRACKET_INSET_PX;
      const y2 = w.y + w.h - BRACKET_INSET_PX;
      // top-left
      ctx.moveTo(x1, y1 + len); ctx.lineTo(x1, y1); ctx.lineTo(x1 + len, y1);
      // top-right
      ctx.moveTo(x2 - len, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + len);
      // bottom-right
      ctx.moveTo(x2, y2 - len); ctx.lineTo(x2, y2); ctx.lineTo(x2 - len, y2);
      // bottom-left
      ctx.moveTo(x1 + len, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - len);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function getWallLayer(walls: Wall[]): CachedLayer | null {
  if (walls.length === 0) return null;
  let maxX = 0;
  let maxY = 0;
  for (const w of walls) {
    const right = w.x + w.w + WALL_GLOW_BLUR;
    const bottom = w.y + w.h + WALL_GLOW_BLUR;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  const extentX = Math.ceil(maxX + WALL_GLOW_BLUR);
  const extentY = Math.ceil(maxY + WALL_GLOW_BLUR);

  const cached = layerCache.get(walls);
  if (
    cached &&
    cached.extentX === extentX &&
    cached.extentY === extentY &&
    cached.wallCount === walls.length
  ) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = extentX;
  canvas.height = extentY;
  const wctx = canvas.getContext("2d");
  if (!wctx) return null;
  paintWalls(wctx, walls);
  const layer: CachedLayer = {
    canvas,
    extentX,
    extentY,
    wallCount: walls.length,
  };
  layerCache.set(walls, layer);
  return layer;
}

export function drawWalls(
  ctx: CanvasRenderingContext2D,
  walls: Wall[],
): void {
  if (walls.length === 0) return;
  const layer = getWallLayer(walls);
  if (!layer) return;
  ctx.drawImage(layer.canvas, 0, 0);
}

// Animated overlay — drawn on top of the cached wall layer each frame.
// Marching dashes (perimeter flow), data pulses traversing a wall's
// perimeter, and bullet-impact ripples. Skipped per-wall via dashable
// or zero-area filters where appropriate.
export function drawWallOverlay(
  ctx: CanvasRenderingContext2D,
  fx: WallFx,
  walls: Wall[],
): void {
  if (walls.length === 0) return;
  const solidWalls: Wall[] = [];
  for (const w of walls) if (!w.dashable) solidWalls.push(w);

  // 1. Marching dashes inside the outline — subtle "energy flow".
  if (solidWalls.length > 0) {
    ctx.save();
    ctx.strokeStyle = WALL_STROKE;
    ctx.globalAlpha = MARCHING_DASH_ALPHA;
    ctx.lineWidth = 1;
    ctx.setLineDash([...MARCHING_DASH_PATTERN]);
    ctx.lineDashOffset = -fx.marchOffset;
    ctx.shadowColor = WALL_STROKE;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (const w of solidWalls) {
      const ix = w.x + MARCHING_DASH_INSET_PX + 0.5;
      const iy = w.y + MARCHING_DASH_INSET_PX + 0.5;
      const iw = w.w - MARCHING_DASH_INSET_PX * 2 - 1;
      const ih = w.h - MARCHING_DASH_INSET_PX * 2 - 1;
      if (iw <= 0 || ih <= 0) continue;
      ctx.rect(ix, iy, iw, ih);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 2. Perimeter data pulses — bright head dot tracking around the
  // wall's perimeter clockwise from the top-left.
  if (fx.pulses.length > 0) {
    ctx.save();
    ctx.fillStyle = PERIMETER_PULSE_COLOR;
    ctx.shadowColor = PERIMETER_PULSE_COLOR;
    ctx.shadowBlur = PERIMETER_PULSE_GLOW;
    for (const p of fx.pulses) {
      const w = walls[p.wallIndex];
      if (!w) continue;
      const pos = perimeterPoint(w, p.progress % p.perimeter);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PERIMETER_PULSE_HEAD_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 3. Impact ripples — small expanding ring at the bullet hit point.
  if (fx.ripples.length > 0) {
    ctx.save();
    ctx.strokeStyle = RIPPLE_COLOR;
    ctx.shadowColor = RIPPLE_COLOR;
    ctx.shadowBlur = RIPPLE_GLOW;
    for (const r of fx.ripples) {
      const u = r.age / RIPPLE_LIFETIME_SEC;
      const radius = RIPPLE_RADIUS_START + (RIPPLE_RADIUS_END - RIPPLE_RADIUS_START) * u;
      const lw = RIPPLE_LINE_WIDTH_START + (RIPPLE_LINE_WIDTH_END - RIPPLE_LINE_WIDTH_START) * u;
      ctx.globalAlpha = 1 - u;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // RIPPLE_FRAGMENT_COUNT reserved for future spark particles on
  // impact; the ring alone reads clearly so we ship without.
  void RIPPLE_FRAGMENT_COUNT;
}

function perimeterPoint(w: Wall, s: number): { x: number; y: number } {
  // Walk the rectangle perimeter starting at top-left going clockwise:
  // top edge (w.w) → right edge (w.h) → bottom edge (w.w) → left edge (w.h).
  const top = w.w;
  const right = top + w.h;
  const bottom = right + w.w;
  if (s < top) return { x: w.x + s, y: w.y };
  if (s < right) return { x: w.x + w.w, y: w.y + (s - top) };
  if (s < bottom) return { x: w.x + w.w - (s - right), y: w.y + w.h };
  return { x: w.x, y: w.y + w.h - (s - bottom) };
}

function pickInterval(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
