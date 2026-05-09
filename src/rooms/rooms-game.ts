import { createGridCanvas } from "../lib/grid";
import { drawNeon } from "../lib/neon";
import { PALETTE } from "../lib/palette";

// Placeholder rooms-mode loop. Static canvas with a "coming soon" message
// in the same neon palette as sandbox so the two modes feel like the same
// game. A small "← Back to menu" link sits in the corner via DOM, since
// canvas can't easily host clickable text.

export function start(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let dpr = window.devicePixelRatio || 1;
  let viewW = 0;
  let viewH = 0;
  let gridCanvas: HTMLCanvasElement | null = null;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gridCanvas = createGridCanvas(viewW, viewH, dpr);
    render();
  }
  resize();
  window.addEventListener("resize", resize);

  function render() {
    if (!ctx) return;
    if (gridCanvas) {
      ctx.drawImage(gridCanvas, 0, 0, viewW, viewH);
    } else {
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    drawNeon(
      ctx,
      () => {
        ctx.fillStyle = PALETTE.player;
        ctx.font = "700 64px system-ui, -apple-system, sans-serif";
        ctx.fillText("ROOMS", viewW / 2, viewH / 2 - 30);
      },
      PALETTE.player,
      30,
      12,
    );

    drawNeon(
      ctx,
      () => {
        ctx.fillStyle = PALETTE.playerDash;
        ctx.font = "500 22px system-ui, -apple-system, sans-serif";
        ctx.fillText("coming soon", viewW / 2, viewH / 2 + 30);
      },
      PALETTE.playerDash,
      18,
      6,
    );

    ctx.restore();
  }
}
