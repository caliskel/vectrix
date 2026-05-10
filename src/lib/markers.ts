import { drawNeon } from "./neon";

// Tutorial markers: numbered checkpoints the player walks through to
// learn movement / dash. Used by Tutorial Room 0; the game engine
// tracks an active index, advances on overlap, and unlocks the room
// door once every marker has been reached.

const MARKER_RADIUS = 35;
const MARKER_PULSE_HZ = 0.67; // ~1.5 s period
const MARKER_PULSE_AMPLITUDE = 0.1; // ±10 % size
const MARKER_GLOW_BLUR = 18;
const MARKER_REACH_RADIUS = 28; // pickup radius (slightly inside the visual)
// Pale cyan shared with the HUD tutorial-hint text — every tutorial
// element lives in the same tonal family so the player reads them as
// "this is the tutorial layer" rather than mistaking markers for a
// gameplay pickup. Deliberately not piped through PALETTE because
// markers are the only consumer of this hue.
const MARKER_COLOR = "#7dd3fc";
const MARKER_FILL = "rgba(125, 211, 252, 0.2)";

export type Marker = {
  x: number;
  y: number;
  number: number;
  /** Floating label shown above the marker while still active. */
  label: string;
  /** Animation phase advanced each frame; drives the breathing pulse. */
  pulsePhase: number;
  /** Set true once the player has touched this marker. Reached
   *  markers stop ticking, render, and overlap-checking — they're
   *  effectively retired. */
  reached: boolean;
};

export function createMarker(
  x: number,
  y: number,
  number: number,
  label: string,
): Marker {
  return { x, y, number, label, pulsePhase: 0, reached: false };
}

export function tickMarker(marker: Marker, dt: number): void {
  marker.pulsePhase += dt * MARKER_PULSE_HZ * Math.PI * 2;
}

export function markerOverlapsPlayer(
  marker: Marker,
  px: number,
  py: number,
): boolean {
  const dx = px - marker.x;
  const dy = py - marker.y;
  return dx * dx + dy * dy < MARKER_REACH_RADIUS * MARKER_REACH_RADIUS;
}

/**
 * Draw an unreached marker. Active markers (the next-up in sequence)
 * get the full glow + label + pulse; future markers render as a
 * silhouette so the path ahead is visible but the player knows
 * which one to chase. Reached markers are skipped.
 */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  marker: Marker,
  isActive: boolean,
): void {
  if (marker.reached) return;
  if (!isActive) {
    // Silhouette — flat alpha, no pulse, no label.
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = MARKER_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, MARKER_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = MARKER_COLOR;
    ctx.font = "600 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(marker.number), marker.x, marker.y);
    ctx.restore();
    return;
  }
  const pulse = 1 + Math.sin(marker.pulsePhase) * MARKER_PULSE_AMPLITUDE;
  const r = MARKER_RADIUS * pulse;
  ctx.save();
  drawNeon(
    ctx,
    () => {
      ctx.fillStyle = MARKER_FILL;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = MARKER_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, r, 0, Math.PI * 2);
      ctx.stroke();
    },
    MARKER_COLOR,
    MARKER_GLOW_BLUR,
    8,
  );
  // Number digit
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(marker.number), marker.x, marker.y);
  // Floating label
  ctx.fillStyle = MARKER_COLOR;
  ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = MARKER_COLOR;
  ctx.shadowBlur = 10;
  ctx.fillText(marker.label, marker.x, marker.y - r - 14);
  ctx.shadowBlur = 0;
  ctx.restore();
}

export const MARKER_REACH_RADIUS_PX = MARKER_REACH_RADIUS;
