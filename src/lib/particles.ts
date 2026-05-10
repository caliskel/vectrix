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
