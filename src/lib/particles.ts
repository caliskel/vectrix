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
  list.push({
    x,
    y,
    vy: opts.vy ?? -55,
    text,
    size: opts.size ?? 20,
    color: opts.color ?? "#ffffff",
    age: 0,
    lifetime: opts.lifetime ?? 0.5,
  });
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
  list.push({
    x,
    y,
    age: 0,
    lifetime: opts.lifetime ?? 0.1,
    startR: opts.startR ?? 8,
    endR: opts.endR ?? 32,
    color: opts.color ?? "#facc15",
    startLineWidth: opts.startLineWidth,
    endLineWidth: opts.endLineWidth,
    glowBlur: opts.glowBlur,
  });
}
