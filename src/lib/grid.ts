export const GRID_STEP = 60;

// Neon node-graph grid — drawn via a cached 60×60 tile turned into a
// CanvasPattern, so painting an arena floor of any size collapses to
// one fillRect (GPU-accelerated tiling). Replaces the previous live
// loop of ~Nx × Ny ctx.arc calls, which started costing 5–8 ms in the
// large rooms once intersection dots were added.
//
// Cyan/blue family on purpose — the player + bullets own the hot
// accents (red/cyan flash on dash), so the floor stays in the cool
// half of the palette to keep contrast where it matters.

const GRID_LINE_COLOR = "rgba(125, 211, 252, 0.22)";
const GRID_NODE_COLOR = "rgba(125, 211, 252, 0.4)";
const GRID_NODE_RADIUS = 1.2;

let cachedTile: HTMLCanvasElement | null = null;

function getOrBuildTile(): HTMLCanvasElement | null {
  if (cachedTile) return cachedTile;
  const tile = document.createElement("canvas");
  tile.width = GRID_STEP;
  tile.height = GRID_STEP;
  const tctx = tile.getContext("2d");
  if (!tctx) return null;
  // Edge lines — top + left only. Pattern repetition stitches each
  // tile's top edge to the neighbour-below's bottom line, so we never
  // draw double-overlapping strokes at seams.
  tctx.strokeStyle = GRID_LINE_COLOR;
  tctx.lineWidth = 1;
  tctx.beginPath();
  tctx.moveTo(0, 0.5);
  tctx.lineTo(GRID_STEP, 0.5);
  tctx.moveTo(0.5, 0);
  tctx.lineTo(0.5, GRID_STEP);
  tctx.stroke();
  // Node at the top-left corner of the tile.
  tctx.fillStyle = GRID_NODE_COLOR;
  tctx.beginPath();
  tctx.arc(0.5, 0.5, GRID_NODE_RADIUS, 0, Math.PI * 2);
  tctx.fill();
  cachedTile = tile;
  return tile;
}

function paintGridArea(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const tile = getOrBuildTile();
  if (!tile) return;
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.shadowBlur = 0;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// World-space variant for rooms — paint the floor clamped to the
// room's logical bounds so the pattern stops at the perimeter walls
// instead of bleeding into the letterbox.
export function drawRoomGrid(
  ctx: CanvasRenderingContext2D,
  roomW: number,
  roomH: number,
): void {
  paintGridArea(ctx, roomW, roomH);
}

// Build an offscreen canvas with the arena grid pattern on a
// transparent background. Kept for sandbox / tutorial which prefer
// blitting a single offscreen image once per frame; the underlying
// pattern is the same tile drawRoomGrid uses, so visuals match.
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
  paintGridArea(gctx, viewW, viewH);
  return gc;
}
