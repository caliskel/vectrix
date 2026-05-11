// Cheap ambient background — drifting dust so the arena reads as a
// living place instead of a flat sheet of grid lines. Two render slots:
//   drawBack(ctx, w, h) — currently a no-op (reserved for future
//     static / non-centered atmosphere layers; a centered radial
//     pulse used to live here but read as a spotlight following the
//     camera and was removed).
//   drawFront(ctx) — dust over the grid but under entities, so motes
//     feel close to the play surface without obscuring bullets.
// Screen-space; pass viewport size to drawBack each frame. Caller
// owns time advance via update(dt) so pause-state freezes the
// background without a separate clock.

const DUST_COUNT = 36;
const DUST_MIN_SPEED = 6;
const DUST_MAX_SPEED = 22;
const DUST_MIN_SIZE = 0.6;
const DUST_MAX_SIZE = 1.8;
const DUST_MIN_ALPHA = 0.06;
const DUST_MAX_ALPHA = 0.18;


interface DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  hue: number; // 0..1 lerp between cool and warm tint
}

export class BackgroundFx {
  private particles: DustParticle[] = [];
  private time = 0;
  private viewW = 0;
  private viewH = 0;

  resize(viewW: number, viewH: number): void {
    if (viewW === this.viewW && viewH === this.viewH) return;
    this.viewW = viewW;
    this.viewH = viewH;
    this.seed();
  }

  private seed(): void {
    this.particles.length = 0;
    for (let i = 0; i < DUST_COUNT; i++) {
      const speed =
        DUST_MIN_SPEED + Math.random() * (DUST_MAX_SPEED - DUST_MIN_SPEED);
      const angle = Math.random() * Math.PI * 2;
      this.particles.push({
        x: Math.random() * this.viewW,
        y: Math.random() * this.viewH,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size:
          DUST_MIN_SIZE + Math.random() * (DUST_MAX_SIZE - DUST_MIN_SIZE),
        alpha:
          DUST_MIN_ALPHA + Math.random() * (DUST_MAX_ALPHA - DUST_MIN_ALPHA),
        hue: Math.random(),
      });
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -4) p.x = this.viewW + 4;
      else if (p.x > this.viewW + 4) p.x = -4;
      if (p.y < -4) p.y = this.viewH + 4;
      else if (p.y > this.viewH + 4) p.y = -4;
    }
  }

  drawBack(_ctx: CanvasRenderingContext2D, _viewW: number, _viewH: number): void {
    // Reserved slot — nothing drawn here right now. Kept on the API so
    // callers don't shuffle render order when a future atmosphere layer
    // gets added.
  }

  drawFront(ctx: CanvasRenderingContext2D): void {
    if (this.particles.length === 0) return;
    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      // Mix cyan ↔ pink hue per particle for a tasteful palette spread.
      const r = Math.round(180 + p.hue * 75);
      const g = Math.round(220 + (1 - p.hue) * 35);
      const b = Math.round(255 - p.hue * 60);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(
        p.x - p.size / 2,
        p.y - p.size / 2,
        p.size,
        p.size,
      );
    }
    ctx.restore();
  }

  // Diagonal energy pulse — a single bright line travelling from the
  // upper-right corner to the lower-left of the supplied bounds once
  // every GRID_PULSE_PERIOD_SEC. One stroke + glow per frame; cheap
  // enough to call inside large rooms (cost dwarfed by enemy bullets).
  // Caller picks the coordinate space — pass roomW/roomH inside a
  // camera transform for rooms, or viewW/viewH for sandbox.
  drawGridPulse(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const PERIOD = 6.0;
    const total = width + height;
    const phase = (this.time % PERIOD) / PERIOD;
    const wavePos = phase * total;

    // Line x + y = wavePos, clipped to [0..width] × [0..height].
    const x1 = Math.max(0, wavePos - height);
    const y1 = wavePos - x1;
    const x2 = Math.min(width, wavePos);
    const y2 = wavePos - x2;
    if (x1 === x2 && y1 === y2) return;

    // Fade in/out at the path ends so the pulse doesn't snap on/off.
    const fadeWindow = 0.08;
    let fade = 1.0;
    if (phase < fadeWindow) fade = phase / fadeWindow;
    else if (phase > 1 - fadeWindow) fade = (1 - phase) / fadeWindow;

    ctx.save();
    ctx.globalAlpha = 0.55 * fade;
    ctx.strokeStyle = "#7dd3fc";
    ctx.shadowColor = "#7dd3fc";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
}
