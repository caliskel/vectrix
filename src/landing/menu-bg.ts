// Animated menu background — runs in its own full-viewport canvas
// behind the menu content. Five layered effects driven by a single
// requestAnimationFrame loop:
//   1. Solid bg + soft radial gradient (depth)
//   2. Scanlines, slowly scrolling down (CRT feel)
//   3. Faint cyan grid, slowly scrolling diagonally
//   4. Dust particles drifting in random directions (looping at edges)
//   5. Glitch overlays — micro-tears every 8–15 s, big flash every
//      30–60 s; the big flash also requests a static-crackle audio cue.
//
// All timings + intensities live in the constants block below so a
// tweak doesn't require reading the render fn. The state object is
// returned to the caller for cleanup (cancelAnimationFrame / resize
// listener removal) when the menu unmounts — but in practice the
// menu page never unmounts, it just navigates away.

const PARTICLE_COUNT = 16;
const PARTICLE_SPEED_MIN = 5;
const PARTICLE_SPEED_MAX = 15;
const SCANLINE_SPACING = 4;
const SCANLINE_SPEED = 30;            // px/s
const SCANLINE_COLOR = "rgba(255, 255, 255, 0.025)";
const GRID_SPACING = 80;
const GRID_SPEED_X = 18;              // px/s
const GRID_SPEED_Y = 14;              // px/s
const GRID_COLOR = "rgba(0, 229, 255, 0.06)";
const MICRO_GLITCH_INTERVAL_MIN = 8;
const MICRO_GLITCH_INTERVAL_MAX = 15;
const MICRO_GLITCH_DURATION = 0.08;
const BIG_GLITCH_INTERVAL_MIN = 30;
const BIG_GLITCH_INTERVAL_MAX = 60;
const BIG_GLITCH_DURATION = 0.06;
const PARTICLE_COLOR = "rgba(255, 255, 255, 0.15)";
const RADIAL_INNER = "rgba(40, 60, 100, 0.22)";
const RADIAL_OUTER = "rgba(0, 0, 0, 0)";
const BG_FILL = "#0a0e1a";

type Particle = { x: number; y: number; vx: number; vy: number; size: number };
type MicroGlitch = { y: number; h: number; dx: number; remaining: number };
type BigGlitch = { remaining: number };

export type MenuBg = {
  canvas: HTMLCanvasElement;
  /** Optional callback fired once per big-glitch flash so the caller
   *  can layer a static-crackle audio cue on top. */
  onBigGlitch?: () => void;
  dispose: () => void;
};

export function startMenuBg(
  canvas: HTMLCanvasElement,
  opts: { onBigGlitch?: () => void } = {},
): MenuBg {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { canvas, onBigGlitch: opts.onBigGlitch, dispose: () => {} };
  }
  let width = 0;
  let height = 0;
  let dpr = window.devicePixelRatio || 1;
  let particles: Particle[] = [];
  let scanlineOffset = 0;
  let gridOffsetX = 0;
  let gridOffsetY = 0;
  let microTimer = pickInterval(MICRO_GLITCH_INTERVAL_MIN, MICRO_GLITCH_INTERVAL_MAX);
  let micro: MicroGlitch | null = null;
  let bigTimer = pickInterval(BIG_GLITCH_INTERVAL_MIN, BIG_GLITCH_INTERVAL_MAX);
  let big: BigGlitch | null = null;
  let lastTime = performance.now();
  let raf: number | null = null;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (particles.length === 0) seedParticles();
  }

  function seedParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = PARTICLE_SPEED_MIN +
        Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + Math.random(),
      });
    }
  }

  function frame(now: number) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    render();
    raf = requestAnimationFrame(frame);
  }

  function update(dt: number) {
    scanlineOffset = (scanlineOffset + SCANLINE_SPEED * dt) % SCANLINE_SPACING;
    gridOffsetX = (gridOffsetX + GRID_SPEED_X * dt) % GRID_SPACING;
    gridOffsetY = (gridOffsetY + GRID_SPEED_Y * dt) % GRID_SPACING;

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -2) p.x += width + 4;
      else if (p.x > width + 2) p.x -= width + 4;
      if (p.y < -2) p.y += height + 4;
      else if (p.y > height + 2) p.y -= height + 4;
    }

    microTimer -= dt;
    if (microTimer <= 0 && !micro) {
      micro = {
        y: Math.random() * height,
        h: 20 + Math.random() * 20,
        dx: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 12),
        remaining: MICRO_GLITCH_DURATION,
      };
      microTimer = pickInterval(
        MICRO_GLITCH_INTERVAL_MIN,
        MICRO_GLITCH_INTERVAL_MAX,
      );
    }
    if (micro) {
      micro.remaining -= dt;
      if (micro.remaining <= 0) micro = null;
    }

    bigTimer -= dt;
    if (bigTimer <= 0 && !big) {
      big = { remaining: BIG_GLITCH_DURATION };
      bigTimer = pickInterval(
        BIG_GLITCH_INTERVAL_MIN,
        BIG_GLITCH_INTERVAL_MAX,
      );
      opts.onBigGlitch?.();
    }
    if (big) {
      big.remaining -= dt;
      if (big.remaining <= 0) big = null;
    }
  }

  function render() {
    const c = ctx!;
    // 1. Solid bg + radial center glow
    c.fillStyle = BG_FILL;
    c.fillRect(0, 0, width, height);
    const grad = c.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.7,
    );
    grad.addColorStop(0, RADIAL_INNER);
    grad.addColorStop(1, RADIAL_OUTER);
    c.fillStyle = grad;
    c.fillRect(0, 0, width, height);

    // 3. Grid (drawn before scanlines so scanlines layer on top)
    c.strokeStyle = GRID_COLOR;
    c.lineWidth = 1;
    c.beginPath();
    for (let x = -GRID_SPACING + gridOffsetX; x < width; x += GRID_SPACING) {
      const xx = Math.floor(x) + 0.5;
      c.moveTo(xx, 0);
      c.lineTo(xx, height);
    }
    for (let y = -GRID_SPACING + gridOffsetY; y < height; y += GRID_SPACING) {
      const yy = Math.floor(y) + 0.5;
      c.moveTo(0, yy);
      c.lineTo(width, yy);
    }
    c.stroke();

    // 2. Scanlines
    c.fillStyle = SCANLINE_COLOR;
    for (
      let y = -SCANLINE_SPACING + scanlineOffset;
      y < height;
      y += SCANLINE_SPACING
    ) {
      c.fillRect(0, y, width, 1);
    }

    // 5. Particles (dust)
    c.fillStyle = PARTICLE_COLOR;
    for (const p of particles) {
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }

    // 4. Glitch overlays — last so they sit on top of the world
    if (micro) {
      // CRT tear: snapshot the affected horizontal strip and re-blit
      // it onto itself with a horizontal offset + red tint. The
      // canvas can drawImage itself; the underlying pixels were just
      // rendered above.
      c.save();
      c.drawImage(
        canvas,
        0,
        micro.y * dpr,
        width * dpr,
        micro.h * dpr,
        micro.dx,
        micro.y,
        width,
        micro.h,
      );
      c.globalCompositeOperation = "source-atop";
      c.fillStyle = "rgba(255, 45, 85, 0.18)";
      c.fillRect(micro.dx, micro.y, width, micro.h);
      c.restore();
    }
    if (big) {
      c.fillStyle = "rgba(255, 255, 255, 0.08)";
      c.fillRect(0, 0, width, height);
    }
  }

  resize();
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(frame);

  return {
    canvas,
    onBigGlitch: opts.onBigGlitch,
    dispose: () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    },
  };
}

function pickInterval(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
