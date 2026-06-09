// Full-screen vignette overlays shared by sandbox / rooms / tutorial.
//
// All three render loops used to call ctx.createRadialGradient() every
// frame for the ambient corner vignette (and a second one while the hit
// vignette was fading). Gradient creation allocates and re-rasterises
// per call — cheap-ish in Chrome, measurably expensive in Safari and
// Firefox where it showed up as a steady per-frame cost. The gradients
// only depend on the viewport size, so they're cached here and rebuilt
// on resize; the hit vignette is baked at full strength and faded via
// globalAlpha instead of re-baking the color stops each frame.

let cornerGrad: CanvasGradient | null = null;
let cornerW = 0;
let cornerH = 0;

let hitGrad: CanvasGradient | null = null;
let hitW = 0;
let hitH = 0;

/** Ambient corner vignette — constant rgba(0,0,0,0.4) edge falloff. */
export function drawCornerVignette(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
): void {
  if (!cornerGrad || cornerW !== viewW || cornerH !== viewH) {
    cornerGrad = ctx.createRadialGradient(
      viewW / 2,
      viewH / 2,
      Math.min(viewW, viewH) * 0.3,
      viewW / 2,
      viewH / 2,
      Math.max(viewW, viewH) * 0.7,
    );
    cornerGrad.addColorStop(0, "rgba(0,0,0,0)");
    cornerGrad.addColorStop(1, "rgba(0,0,0,0.4)");
    cornerW = viewW;
    cornerH = viewH;
  }
  ctx.save();
  ctx.fillStyle = cornerGrad;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.restore();
}

/** Red hit vignette. `t` 0..1 scales the fade (1 = freshly hit). */
export function drawHitVignette(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  t: number,
): void {
  if (t <= 0) return;
  if (!hitGrad || hitW !== viewW || hitH !== viewH) {
    hitGrad = ctx.createRadialGradient(
      viewW / 2,
      viewH / 2,
      Math.min(viewW, viewH) * 0.25,
      viewW / 2,
      viewH / 2,
      Math.max(viewW, viewH) * 0.65,
    );
    hitGrad.addColorStop(0, "rgba(60,0,0,0)");
    hitGrad.addColorStop(1, "rgba(60,0,0,0.7)");
    hitW = viewW;
    hitH = viewH;
  }
  ctx.save();
  ctx.globalAlpha = t;
  ctx.fillStyle = hitGrad;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.restore();
}
