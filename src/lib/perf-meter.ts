// Frame-time breakdown overlay. Lets us actually MEASURE which render
// section is eating the frame budget instead of guessing.
//
// Usage from a game render():
//
//   perfBegin("bullets");
//   ... draw bullets ...
//   perfEnd("bullets");
//
// Sections accumulate ms across the frame; `perfFlush(now)` writes
// them to the rolling window and resets the per-frame counters.
// `drawPerfOverlay(ctx, viewW)` paints the breakdown in the top-right
// when `perfEnabled` is on.
//
// Toggled by `togglePerfOverlay()` — wired to F2 in the game's
// keydown handler (the existing `drawFpsOverlay` uses F3 / dev menu
// route, this is its companion).

const SECTIONS = [
  // === update pass ===
  "update",
  "upd_enemies",
  "upd_bullets",
  "upd_player",
  "upd_audio",
  // === render pass ===
  "bg",
  "energy",
  "bgtext",
  "arenabg",
  "grid",
  "walls",
  "enemies",
  "detection",
  "lasers",
  "bullets",
  "trails",
  "particles",
  "player",
  "rings",
  "hud",
] as const;

type Section = (typeof SECTIONS)[number];

const sectionAccum: Record<Section, number> = Object.create(null);
const sectionLast: Record<Section, number> = Object.create(null);
const sectionStart: Record<Section, number> = Object.create(null);
for (const s of SECTIONS) {
  sectionAccum[s] = 0;
  sectionLast[s] = 0;
  sectionStart[s] = 0;
}

// Smoothed rolling-mean window — single buffer position per section
// so consecutive frame's spikes don't flatten the read. Updates each
// flush; the overlay reads `sectionLast` for display.
const SMOOTHING = 0.85;

let frameStart = 0;
let lastTotal = 0;
let enabled = false;

export function togglePerfOverlay(): void {
  enabled = !enabled;
}

export function isPerfOverlayOn(): boolean {
  return enabled;
}

export function perfFrameStart(now: number): void {
  frameStart = now;
  for (const s of SECTIONS) sectionAccum[s] = 0;
}

export function perfBegin(section: Section): void {
  if (!enabled) return;
  sectionStart[section] = performance.now();
}

export function perfEnd(section: Section): void {
  if (!enabled) return;
  sectionAccum[section] += performance.now() - sectionStart[section];
}

export function perfFrameEnd(now: number): void {
  if (!enabled) return;
  for (const s of SECTIONS) {
    sectionLast[s] = sectionLast[s] * SMOOTHING + sectionAccum[s] * (1 - SMOOTHING);
  }
  lastTotal = lastTotal * SMOOTHING + (now - frameStart) * (1 - SMOOTHING);
}

const COLOR_OK = "#22c55e";
const COLOR_MID = "#fbbf24";
const COLOR_BAD = "#ef4444";

function ms2color(ms: number): string {
  if (ms < 1) return COLOR_OK;
  if (ms < 3) return COLOR_MID;
  return COLOR_BAD;
}

export function drawPerfOverlay(
  ctx: CanvasRenderingContext2D,
  viewW: number,
): void {
  if (!enabled) return;
  ctx.save();
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "right";
  const x = viewW - 12;
  let y = 80;
  const lineH = 14;
  // Backplate so the text is readable over any background.
  const colW = 230;
  const rowsH = (SECTIONS.length + 2) * lineH + 8;
  ctx.fillStyle = "rgba(10, 14, 26, 0.78)";
  ctx.fillRect(x - colW, y - 4, colW + 4, rowsH);

  ctx.fillStyle = "#7dd3fc";
  ctx.fillText("FRAME BREAKDOWN — F2 to toggle", x, y);
  y += lineH;
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(`TOTAL ${lastTotal.toFixed(2)} ms`, x, y);
  y += lineH;

  for (const s of SECTIONS) {
    const ms = sectionLast[s];
    if (ms < 0.05) continue;
    ctx.fillStyle = ms2color(ms);
    ctx.fillText(`${s.padEnd(10, " ")}  ${ms.toFixed(2)} ms`, x, y);
    y += lineH;
  }
  ctx.restore();
}
