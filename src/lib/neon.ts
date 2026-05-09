// Two-pass neon render: a strong outer halo + a sharp inner halo, both
// using the canvas drop-shadow. Cheap when used per-object; for many
// objects (particles) callers can fall back to a flat draw.
export function drawNeon(
  ctx: CanvasRenderingContext2D,
  drawFn: () => void,
  color: string,
  blurStrong: number,
  blurSoft: number,
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blurStrong;
  drawFn();
  ctx.shadowBlur = blurSoft;
  drawFn();
  ctx.restore();
}
