// Minimal frame-time meter for in-dev perf debugging. Owned by the
// rooms loop right now; tutorial/sandbox can wire it the same way.
//
// Records the last FPS_BUFFER_SIZE frame deltas in a ring buffer and
// derives instantaneous FPS, p50, and p95 frame times. Cheap enough
// to leave on permanently — one Date.now subtraction per frame, one
// array slot write, and a 3-line text draw.
//
// Intentionally not gated on import.meta.env or hostname: this is a
// prototype with no production deploy. If the overlay needs to be
// hidden for a screenshot or recording, append `?fps=0` to the URL
// and the draw call short-circuits.

const FPS_BUFFER_SIZE = 120; // ~2 s at 60 fps
const deltas: number[] = new Array(FPS_BUFFER_SIZE).fill(16.6);
let writeIdx = 0;
let lastNow: number | null = null;
let frameCount = 0;

const overlayDisabled = (() => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("fps") === "0";
})();

export function recordFrame(now: number): void {
  if (lastNow !== null) {
    const dt = now - lastNow;
    deltas[writeIdx] = dt;
    writeIdx = (writeIdx + 1) % FPS_BUFFER_SIZE;
    frameCount++;
  }
  lastNow = now;
}

type FpsStats = {
  /** Average instantaneous FPS over the buffer. */
  fps: number;
  /** Median frame time in ms — the typical frame. */
  p50ms: number;
  /** 95th percentile frame time in ms — the bad frames. */
  p95ms: number;
};

function computeStats(): FpsStats {
  const sample = Math.min(frameCount, FPS_BUFFER_SIZE);
  if (sample === 0) return { fps: 0, p50ms: 0, p95ms: 0 };
  const sorted = deltas.slice(0, sample).sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sample;
  const p50 = sorted[Math.floor(sample * 0.5)];
  const p95 = sorted[Math.min(sample - 1, Math.floor(sample * 0.95))];
  return {
    fps: avg > 0 ? 1000 / avg : 0,
    p50ms: p50,
    p95ms: p95,
  };
}

export function drawFpsOverlay(
  ctx: CanvasRenderingContext2D,
  viewW: number,
): void {
  if (overlayDisabled) return;
  const { fps, p50ms, p95ms } = computeStats();
  // Color hint: green ≥55 fps, yellow 30–55, red <30. Reads at a glance
  // while the eye is on the boss.
  const color =
    fps >= 55 ? "#86efac" : fps >= 30 ? "#fde68a" : "#fca5a5";
  const lines = [
    `${fps.toFixed(0)} FPS`,
    `p50 ${p50ms.toFixed(1)}ms`,
    `p95 ${p95ms.toFixed(1)}ms`,
  ];
  ctx.save();
  ctx.font = "600 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  // Backplate so text reads over both dark playfield and bright FX.
  const padX = 8;
  const padY = 6;
  const lineH = 14;
  const boxW = 88;
  const boxH = padY * 2 + lineH * lines.length;
  const boxX = viewW - boxW - 12;
  const boxY = 12;
  ctx.fillStyle = "rgba(10, 14, 26, 0.6)";
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = color;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], boxX + boxW - padX, boxY + padY + i * lineH);
  }
  ctx.restore();
}
