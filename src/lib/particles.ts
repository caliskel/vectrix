export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  initialSize: number;
  color: string;
  age: number;
  lifetime: number;
  glowStrong: number;
  glowSoft: number;
  drag: number; // applied per second-equivalent multiplier (frame-rate independent)
  /** Render as a soft radial "dust" puff (baked sprite) instead of the
   *  default sharp square. The player movement trail uses this so it
   *  reads as kicked-up dust rather than pixel confetti. */
  soft?: boolean;
};

export type FloatingText = {
  x: number;
  y: number;
  vy: number;
  text: string;
  size: number;
  color: string;
  age: number;
  lifetime: number;
};

// Spring-entry parameters tuned to feel "punchy" without crossing into
// gummy / wobble territory. First 18 % of life: scale ramps from
// SPRING_FROM up to SPRING_PEAK on easeOutBack, then settles to 1.0
// by the end of the window. Rest of life: hold at 1, fade alpha.
const SPRING_WINDOW = 0.18;
const SPRING_FROM = 0.55;
const SPRING_PEAK = 1.25;

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function entryScale(t: number): number {
  if (t >= SPRING_WINDOW) return 1;
  const u = t / SPRING_WINDOW;
  // Spring up to peak by 65 % of the window, then ease down to 1.
  if (u < 0.65) {
    const k = easeOutBack(u / 0.65);
    return SPRING_FROM + (SPRING_PEAK - SPRING_FROM) * k;
  }
  const k = (u - 0.65) / 0.35;
  return SPRING_PEAK + (1 - SPRING_PEAK) * k;
}

// Centralised floating-text renderer. Replaces per-text drawNeon
// (shadowBlur is the most expensive Canvas 2D state) with a cheap
// stroke + fill pair that still reads as "punched out of the world".
// All three modes (sandbox / rooms / tutorial) call this so a
// styling tweak lands once.
export function drawFloatingTexts(
  ctx: CanvasRenderingContext2D,
  list: FloatingText[],
): void {
  if (list.length === 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 0;
  for (const ft of list) {
    const lifeFrac = ft.lifetime > 0 ? ft.age / ft.lifetime : 1;
    const alpha = Math.max(0, 1 - lifeFrac);
    if (alpha <= 0) continue;
    const scale = entryScale(lifeFrac);
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${ft.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    if (scale !== 1) {
      ctx.save();
      ctx.translate(ft.x, ft.y);
      ctx.scale(scale, scale);
      // Dark outline behind the fill — readability without shadowBlur.
      ctx.lineWidth = Math.max(2, ft.size * 0.18);
      ctx.strokeStyle = "rgba(10, 14, 26, 0.85)";
      ctx.strokeText(ft.text, 0, 0);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    } else {
      ctx.lineWidth = Math.max(2, ft.size * 0.18);
      ctx.strokeStyle = "rgba(10, 14, 26, 0.85)";
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
  }
  ctx.restore();
}

export type Ring = {
  x: number;
  y: number;
  age: number;
  lifetime: number;
  startR: number;
  endR: number;
  color: string;
  /** Optional linear-tapered stroke width over the ring's lifetime.
   *  When unset the renderer falls back to the historic 2 px stroke. */
  startLineWidth?: number;
  endLineWidth?: number;
  /** Optional shadowBlur for a glow that fades with alpha. */
  glowBlur?: number;
};

// === Object pools ===
// Boss combat spawns particles + rings in bursts (16-24 particles per
// hit, 10+ rings during a mine detonation). Each push({...}) is an
// object literal allocation; each `list.filter(...)` allocates a fresh
// array per frame. Together that's GC churn that shows up as
// occasional frame stutters in Chrome during heavy combat.
//
// Callers use `pushParticle(list, ...)` / `pushRing(list, ...)` to add
// to a list — the helper pulls a recycled instance from the pool when
// available, falls back to a fresh allocation when the pool is empty.
// `compactParticles(list, keep)` / `compactRings(list, keep)` replace
// `list = list.filter(...)` to reuse the array AND return dead items
// to the pool so the next acquire can recycle them.

const particlePool: Particle[] = [];
const ringPool: Ring[] = [];

export function pushParticle(
  list: Particle[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  initialSize: number,
  color: string,
  lifetime: number,
  glowStrong: number,
  glowSoft: number,
  drag: number,
  soft = false,
): void {
  const recycled = particlePool.pop();
  if (recycled) {
    recycled.x = x;
    recycled.y = y;
    recycled.vx = vx;
    recycled.vy = vy;
    recycled.initialSize = initialSize;
    recycled.color = color;
    recycled.age = 0;
    recycled.lifetime = lifetime;
    recycled.glowStrong = glowStrong;
    recycled.glowSoft = glowSoft;
    recycled.drag = drag;
    recycled.soft = soft;
    list.push(recycled);
    return;
  }
  list.push({
    x,
    y,
    vx,
    vy,
    initialSize,
    color,
    age: 0,
    lifetime,
    glowStrong,
    glowSoft,
    drag,
    soft,
  });
}

export function compactParticles(
  list: Particle[],
  keep: (p: Particle) => boolean,
): void {
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < list.length; readIdx++) {
    const p = list[readIdx];
    if (keep(p)) {
      list[writeIdx++] = p;
    } else {
      particlePool.push(p);
    }
  }
  list.length = writeIdx;
}

export function pushRing(
  list: Ring[],
  x: number,
  y: number,
  lifetime: number,
  startR: number,
  endR: number,
  color: string,
  startLineWidth: number | undefined,
  endLineWidth: number | undefined,
  glowBlur: number | undefined,
): void {
  const recycled = ringPool.pop();
  if (recycled) {
    recycled.x = x;
    recycled.y = y;
    recycled.age = 0;
    recycled.lifetime = lifetime;
    recycled.startR = startR;
    recycled.endR = endR;
    recycled.color = color;
    recycled.startLineWidth = startLineWidth;
    recycled.endLineWidth = endLineWidth;
    recycled.glowBlur = glowBlur;
    list.push(recycled);
    return;
  }
  list.push({
    x,
    y,
    age: 0,
    lifetime,
    startR,
    endR,
    color,
    startLineWidth,
    endLineWidth,
    glowBlur,
  });
}

export function compactRings(
  list: Ring[],
  keep: (r: Ring) => boolean,
): void {
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < list.length; readIdx++) {
    const r = list[readIdx];
    if (keep(r)) {
      list[writeIdx++] = r;
    } else {
      ringPool.push(r);
    }
  }
  list.length = writeIdx;
}

// FloatingText pool — score number "+500" floaters fire on every
// dash-through, every kill, every multiplier tier crossing. Per-frame
// counts are small but cumulative over a long run.
const floatingTextPool: FloatingText[] = [];

export function pushFloatingText(
  list: FloatingText[],
  x: number,
  y: number,
  text: string,
  size: number,
  color: string,
  lifetime: number,
  vy: number,
): void {
  const recycled = floatingTextPool.pop();
  if (recycled) {
    recycled.x = x;
    recycled.y = y;
    recycled.vy = vy;
    recycled.text = text;
    recycled.size = size;
    recycled.color = color;
    recycled.age = 0;
    recycled.lifetime = lifetime;
    list.push(recycled);
    return;
  }
  list.push({
    x,
    y,
    vy,
    text,
    size,
    color,
    age: 0,
    lifetime,
  });
}

export function compactFloatingTexts(
  list: FloatingText[],
  keep: (t: FloatingText) => boolean,
): void {
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < list.length; readIdx++) {
    const t = list[readIdx];
    if (keep(t)) {
      list[writeIdx++] = t;
    } else {
      floatingTextPool.push(t);
    }
  }
  list.length = writeIdx;
}

export function addFloatingText(
  list: FloatingText[],
  text: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    color?: string;
    lifetime?: number;
    vy?: number;
  } = {},
): void {
  pushFloatingText(
    list,
    x,
    y,
    text,
    opts.size ?? 20,
    opts.color ?? "#ffffff",
    opts.lifetime ?? 0.5,
    opts.vy ?? -55,
  );
}

export function addRing(
  list: Ring[],
  x: number,
  y: number,
  opts: {
    startR?: number;
    endR?: number;
    color?: string;
    lifetime?: number;
    startLineWidth?: number;
    endLineWidth?: number;
    glowBlur?: number;
  } = {},
): void {
  // Routes through the pool so callers like impacts.ts get the same
  // recycling benefit as direct pushRing users.
  pushRing(
    list,
    x,
    y,
    opts.lifetime ?? 0.1,
    opts.startR ?? 8,
    opts.endR ?? 32,
    opts.color ?? "#facc15",
    opts.startLineWidth,
    opts.endLineWidth,
    opts.glowBlur,
  );
}
