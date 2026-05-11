// Cheap ambient background — dust drift + slow radial pulse — so the
// arena reads as a living place instead of a flat sheet of grid lines.
// Two render slots:
//   drawBack(ctx, w, h) — paints under everything (call right after the
//     bg fill / before the grid blit). Currently the slow synthwave
//     pulse: a radial gradient that breathes between cyan and magenta
//     so the screen has a "horizon" that crossfades hue.
//   drawFront(ctx, w, h) — paints over the grid but under entities, so
//     dust feels close to the play surface without obscuring bullets.
// Both are screen-space; pass in the viewport size each frame. Caller
// owns the time advance via update(dt) so pause-state can freeze the
// background without a separate clock.

const DUST_COUNT = 36;
const DUST_MIN_SPEED = 6;
const DUST_MAX_SPEED = 22;
const DUST_MIN_SIZE = 0.6;
const DUST_MAX_SIZE = 1.8;
const DUST_MIN_ALPHA = 0.10;
const DUST_MAX_ALPHA = 0.32;

// Hue cycle for the radial pulse — cyan → magenta → cyan over PULSE_PERIOD_SEC.
const PULSE_PERIOD_SEC = 8.0;
const PULSE_ALPHA_BASE = 0.05;
const PULSE_ALPHA_SWING = 0.05;

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

  drawBack(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    // Slow cool↔warm radial pulse, two superimposed gradients out of
    // phase so the centre "breathes" through the cyan / magenta axis.
    const cx = viewW * 0.5;
    const cy = viewH * 0.5;
    const r = Math.max(viewW, viewH) * 0.7;
    const phase = (this.time / PULSE_PERIOD_SEC) * Math.PI * 2;

    const aCyan =
      PULSE_ALPHA_BASE + PULSE_ALPHA_SWING * (0.5 + 0.5 * Math.sin(phase));
    const aMagenta =
      PULSE_ALPHA_BASE +
      PULSE_ALPHA_SWING * (0.5 + 0.5 * Math.sin(phase + Math.PI));

    ctx.save();
    const gCyan = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gCyan.addColorStop(0, `rgba(0, 229, 255, ${aCyan.toFixed(3)})`);
    gCyan.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gCyan;
    ctx.fillRect(0, 0, viewW, viewH);

    const gMag = ctx.createRadialGradient(
      cx + viewW * 0.15,
      cy - viewH * 0.1,
      0,
      cx + viewW * 0.15,
      cy - viewH * 0.1,
      r * 0.9,
    );
    gMag.addColorStop(0, `rgba(255, 60, 180, ${aMagenta.toFixed(3)})`);
    gMag.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gMag;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
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
}
