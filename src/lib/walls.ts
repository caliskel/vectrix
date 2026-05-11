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

// True if the bullet's center sits inside any wall's AABB.
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

const WALL_FILL = "rgba(28, 35, 60, 0.85)";
const WALL_STROKE = "#7dd3fc";
const WALL_STROKE_ALPHA = 0.6;
const WALL_GLOW_BLUR = 12;
const DASHABLE_GLOW_BLUR = 14;

export function drawWalls(
  ctx: CanvasRenderingContext2D,
  walls: Wall[],
): void {
  if (walls.length === 0) return;

  // Single fill pass for all walls — same colour, batch as one path.
  ctx.save();
  ctx.fillStyle = WALL_FILL;
  ctx.shadowBlur = 0;
  for (const w of walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  ctx.restore();

  // Stroke passes grouped by style so shadowBlur is set once per group
  // (one expensive shadow render per category, not per wall).
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
}
