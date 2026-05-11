// Void background — slow drifting vector grid + faint dust + radial
// fade to black at the edges. Shared between the intro cinematic and
// the tutorial bridge room (roomIntro) so the visual handoff between
// them is exactly seamless.

export type VoidBgState = {
  gridOffsetX: number;
  gridOffsetY: number;
  dust: VoidDust[];
};

type VoidDust = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
};

const GRID_SPACING = 100;
const GRID_DRIFT_X = 8; // px/s
const GRID_DRIFT_Y = 5;
const DUST_COUNT = 60;

export function createVoidBg(
  canvasW: number,
  canvasH: number,
): VoidBgState {
  const dust: VoidDust[] = [];
  for (let i = 0; i < DUST_COUNT; i++) {
    dust.push({
      x: Math.random() * canvasW,
      y: Math.random() * canvasH,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      size: 0.8 + Math.random() * 1.4,
      alpha: 0.08 + Math.random() * 0.18,
    });
  }
  return {
    gridOffsetX: 0,
    gridOffsetY: 0,
    dust,
  };
}

export function tickVoidBg(
  state: VoidBgState,
  dt: number,
  canvasW: number,
  canvasH: number,
  speedMul = 1,
): void {
  state.gridOffsetX =
    (state.gridOffsetX + GRID_DRIFT_X * dt * speedMul) % GRID_SPACING;
  state.gridOffsetY =
    (state.gridOffsetY + GRID_DRIFT_Y * dt * speedMul) % GRID_SPACING;
  for (const m of state.dust) {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.x < -10) m.x = canvasW + 10;
    if (m.x > canvasW + 10) m.x = -10;
    if (m.y < -10) m.y = canvasH + 10;
    if (m.y > canvasH + 10) m.y = -10;
  }
}

export function drawVoidBg(
  ctx: CanvasRenderingContext2D,
  state: VoidBgState,
  canvasW: number,
  canvasH: number,
  focalX: number,
  focalY: number,
): void {
  // Pure black backdrop.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Drifting vector grid.
  ctx.save();
  ctx.strokeStyle = "rgba(40, 80, 130, 0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const offX = state.gridOffsetX;
  const offY = state.gridOffsetY;
  for (
    let x = -GRID_SPACING + (offX % GRID_SPACING);
    x < canvasW + GRID_SPACING;
    x += GRID_SPACING
  ) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasH);
  }
  for (
    let y = -GRID_SPACING + (offY % GRID_SPACING);
    y < canvasH + GRID_SPACING;
    y += GRID_SPACING
  ) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvasW, y);
  }
  ctx.stroke();

  // Radial wash — fades the grid to deep black at the edges so the
  // composition pools around the focal point.
  const washR = Math.hypot(canvasW, canvasH) * 0.5;
  const wash = ctx.createRadialGradient(
    focalX,
    focalY,
    80,
    focalX,
    focalY,
    washR,
  );
  wash.addColorStop(0, "rgba(0, 0, 0, 0)");
  wash.addColorStop(1, "rgba(0, 0, 0, 0.85)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.restore();

  // Dust motes.
  ctx.save();
  for (const m of state.dust) {
    ctx.fillStyle = `rgba(255, 255, 255, ${m.alpha})`;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Soft inner vignette — darkens the corners further. Optional, used
// by the intro cinematic on top of the wash for extra focal pooling.
export function drawVoidVignette(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  focalX: number,
  focalY: number,
): void {
  const grad = ctx.createRadialGradient(
    focalX,
    focalY,
    220,
    focalX,
    focalY,
    720,
  );
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.75)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasW, canvasH);
}
