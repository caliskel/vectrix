import { PALETTE } from "./palette";

export const GRID_STEP = 60;

// Build an offscreen canvas with the arena background + grid pattern.
// Caller redraws this on resize and blits via drawImage each frame.
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
  gctx.fillStyle = PALETTE.bg;
  gctx.fillRect(0, 0, viewW, viewH);
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
