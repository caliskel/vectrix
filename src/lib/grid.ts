import { PALETTE } from "./palette";

export const GRID_STEP = 60;

// Draw the same neon grid sandbox uses, but in world space and clamped
// to a room's logical bounds. Called inside the camera transform so the
// pattern scrolls with the world and stops at the room edges instead of
// bleeding into the letterbox. No bg fill — rooms-game has already
// painted PALETTE.bg over the whole canvas.
export function drawRoomGrid(
  ctx: CanvasRenderingContext2D,
  roomW: number,
  roomH: number,
): void {
  ctx.save();
  ctx.strokeStyle = PALETTE.bgGrid;
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  for (let x = GRID_STEP; x < roomW; x += GRID_STEP) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, roomH);
  }
  for (let y = GRID_STEP; y < roomH; y += GRID_STEP) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(roomW, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

// Build an offscreen canvas with the arena grid pattern on a transparent
// background. Caller paints PALETTE.bg first (so backgrounds like the
// synthwave pulse can show through between grid cells), then blits this
// via drawImage each frame.
export function createGridCanvas(
  viewW: number,
  viewH: number,
  dpr: number,
): HTMLCanvasElement | null {
  const gc = document.createElement("canvas");
  gc.width = Math.max(1, Math.floor(viewW * dpr));
  gc.height = Math.max(1, Math.floor(viewH * dpr));
  const gctx = gc.getContext("2d");
  if (!gctx) return null;
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gctx.strokeStyle = PALETTE.bgGrid;
  gctx.lineWidth = 1;
  gctx.beginPath();
  for (let x = GRID_STEP; x < viewW; x += GRID_STEP) {
    gctx.moveTo(x + 0.5, 0);
    gctx.lineTo(x + 0.5, viewH);
  }
  for (let y = GRID_STEP; y < viewH; y += GRID_STEP) {
    gctx.moveTo(0, y + 0.5);
    gctx.lineTo(viewW, y + 0.5);
  }
  gctx.stroke();
  return gc;
}
