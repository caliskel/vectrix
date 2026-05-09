import { PALETTE } from "./palette";
import type { Player } from "./player";

export type Wall = { x: number; y: number; w: number; h: number };

// AABB resolve: pushes the player out of any wall it overlaps along the
// axis with the smallest penetration, zeroing the matching velocity.
export function resolvePlayerWallCollisions(
  player: Player,
  walls: Wall[],
  halfSize: number,
): { stoppedX: boolean; stoppedY: boolean } {
  let stoppedX = false;
  let stoppedY = false;
  for (const w of walls) {
    const px1 = player.x - halfSize;
    const px2 = player.x + halfSize;
    const py1 = player.y - halfSize;
    const py2 = player.y + halfSize;
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
      player.x -= oLeft;
      if (player.vx > 0) player.vx = 0;
      stoppedX = true;
    } else if (m === oRight) {
      player.x += oRight;
      if (player.vx < 0) player.vx = 0;
      stoppedX = true;
    } else if (m === oTop) {
      player.y -= oTop;
      if (player.vy > 0) player.vy = 0;
      stoppedY = true;
    } else {
      player.y += oBottom;
      if (player.vy < 0) player.vy = 0;
      stoppedY = true;
    }
  }
  return { stoppedX, stoppedY };
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

export function drawWalls(
  ctx: CanvasRenderingContext2D,
  walls: Wall[],
): void {
  ctx.save();
  ctx.fillStyle = PALETTE.bgGrid;
  for (const w of walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  ctx.strokeStyle = `rgba(168, 85, 247, 0.3)`; // PALETTE.player at alpha 0.3
  ctx.lineWidth = 1;
  for (const w of walls) {
    ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
  }
  ctx.restore();
}
