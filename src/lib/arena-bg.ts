// Arena background — "DEEP FIELD" layer stack drawn UNDER the grid in
// world space. Adds depth and life to the arena floor without competing
// with bullets / enemies / player for the player's attention.
//
// Layers (back to front):
//   0. Floor wash — per-zone radial bloom (theme.washInner at center
//      fading to theme.washOuter at the edges), baked once at reduced
//      resolution and stretched across the arena rect
//   1. Radial gradient from arena center (cool fade-to-dark)
//   2. Parallax dot field — 3 depth layers drifting slowly
//   3. Grid pulses — bright beam travels along a grid line every
//      4–8 s, lighting up nodes as it crosses
//   4. Radar sweeps — soft diagonal gradient sweep every 12–20 s
//
// Sublayer colors (dust dots, grid pulse, radar sweep) come from the
// resolved ZoneThemeState passed to createArenaBg so the deep field
// matches the zone instead of staying fixed cyan under every wash.
//
// Scanlines run at the screen layer, not here (kept in the mode's
// render path so they live outside the camera transform).
//
// State is per-arena: each mode creates one ArenaBg via createArenaBg
// and ticks it every frame. Pulse + sweep arrays are tiny (rarely > 2
// live entries) so per-frame cost is dominated by the dot field, which
// is just additive fillRect calls.

import { GRID_STEP } from "./grid";
import type { ZoneThemeState } from "./zone-theme";

// Spark-glow gradient: thin cool halo around the player's
// consciousness. Kept dim so it reads as the spark's own faint
// light, not a spotlight following them. The VIGNETTE below pulls
// the far corners into near-black so the arena reads as a deep
// dark hall rather than a uniform floor.
const RADIAL_INNER_RGBA = "rgba(70, 120, 180, 0.14)";
const RADIAL_OUTER_RGBA = "rgba(0, 0, 0, 0)";
const VIGNETTE_INNER_RGBA = "rgba(0, 0, 0, 0)";
const VIGNETTE_OUTER_RGBA = "rgba(0, 0, 0, 0.68)";

// Parallax field — point density per 10 000 px² of arena. Tuned so a
// 1200×800 room gets ~115 points per layer, 3 layers ⇒ ~345 dots total.
const DOT_DENSITY_PER_10K = 1.2;
type DotLayer = {
  speedX: number; // px/s drift along world-X
  speedY: number;
  radius: number;
  alpha: number;
};
const DOT_LAYERS: DotLayer[] = [
  // Dust drifting through dead space — kept dim across all layers so
  // it reads as "specks the abandoned ventilation never cleared", not
  // a starfield. Colors come per-instance from the zone theme's
  // dustColors (back→front: [0] far/dim … [2] near/bright).
  { speedX: 3, speedY: 1.5, radius: 0.7, alpha: 0.09 },
  { speedX: 9, speedY: 4, radius: 0.9, alpha: 0.14 },
  { speedX: 17, speedY: 7, radius: 1.1, alpha: 0.20 },
];

const GRID_PULSE_INTERVAL_MIN = 4.0;
const GRID_PULSE_INTERVAL_MAX = 8.0;
const GRID_PULSE_SPEED = 1100; // px/s along the line
const GRID_PULSE_HEAD_LEN = 80;
const GRID_PULSE_TAIL_LEN = 220;

const RADAR_SWEEP_INTERVAL_MIN = 12.0;
const RADAR_SWEEP_INTERVAL_MAX = 20.0;
const RADAR_SWEEP_DURATION = 2.4; // seconds end-to-end
const RADAR_SWEEP_WIDTH = 220;     // px width of the bright band

// Floor-wash bake resolution cap. Rooms go up to 8000×700 world px;
// the wash is a smooth radial gradient, so it scales cleanly from a
// small bake stretched over the full arena rect at blit time.
const WASH_SPRITE_MAX_SIDE = 512;

type Dot = { x: number; y: number };

type GridPulse = {
  axis: "row" | "col";
  // For "col": x is fixed, y = startY + speed*t. For "row": y fixed, x = ...
  fixedCoord: number;
  startCoord: number;
  endCoord: number;
  progress: number; // px travelled
  direction: 1 | -1;
};

type RadarSweep = {
  // Sweep is a diagonal band; track its position along the perpendicular axis.
  angle: number; // radians (direction the band moves perpendicular to its length)
  cosA: number;
  sinA: number;
  startD: number; // perpendicular displacement at start
  endD: number;
  age: number;
};

export type ArenaBg = {
  width: number;
  height: number;
  dotsPerLayer: Dot[][];
  pulses: GridPulse[];
  sweeps: RadarSweep[];
  pulseTimer: number;
  sweepTimer: number;
  // Pre-baked light sprite (spark glow + vignette stacked) — blitted
  // at the player position each frame to avoid recomputing two full-
  // arena radial gradient fills per frame (the dominant cost on the
  // bigger camera rooms before this cache). Built lazily on first
  // draw because document isn't always available at createArenaBg
  // call time (e.g. during module init in tests).
  lightSprite: HTMLCanvasElement | null;
  lightSpriteHalf: number;
  // Per-zone theming, resolved once at create time. The wash sprite
  // bakes the radial bloom (washInner → washOuter at washAlpha ×
  // intensity) at reduced resolution; lazy on first draw, same reason
  // as lightSprite.
  washSprite: HTMLCanvasElement | null;
  washInner: string;
  washOuter: string;
  washAlpha: number; // effective: theme.washAlpha × intensity
  dustColors: [string, string, string];
  pulseColor: string;
  sweepColor: string;
  sweepColorClear: string; // sweepColor's rgb with alpha 0 (gradient edges)
};

export function createArenaBg(
  width: number,
  height: number,
  zone: ZoneThemeState,
): ArenaBg {
  const dotsPerLayer: Dot[][] = [];
  const areaUnits = (width * height) / 10000;
  const count = Math.max(8, Math.floor(areaUnits * DOT_DENSITY_PER_10K));
  for (let i = 0; i < DOT_LAYERS.length; i++) {
    const arr: Dot[] = [];
    for (let j = 0; j < count; j++) {
      arr.push({ x: Math.random() * width, y: Math.random() * height });
    }
    dotsPerLayer.push(arr);
  }
  const theme = zone.theme;
  return {
    width,
    height,
    dotsPerLayer,
    pulses: [],
    sweeps: [],
    pulseTimer: pickInterval(GRID_PULSE_INTERVAL_MIN, GRID_PULSE_INTERVAL_MAX) * 0.5,
    sweepTimer: pickInterval(RADAR_SWEEP_INTERVAL_MIN, RADAR_SWEEP_INTERVAL_MAX) * 0.5,
    lightSprite: null,
    lightSpriteHalf: 0,
    washSprite: null,
    washInner: theme.washInner,
    washOuter: theme.washOuter,
    washAlpha: theme.washAlpha * zone.intensity,
    dustColors: theme.dustColors,
    pulseColor: theme.accent,
    sweepColor: theme.sweepColor,
    sweepColorClear: rgbaWithZeroAlpha(theme.sweepColor),
  };
}

// "rgba(r, g, b, a)" → "rgba(r, g, b, 0)" — parsed once at create
// time so the per-frame sweep gradient never string-munges.
function rgbaWithZeroAlpha(rgba: string): string {
  const m = rgba.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return "rgba(0, 0, 0, 0)";
  const parts = m[1].split(",").map((s) => s.trim());
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, 0)`;
}

// Pre-render the floor wash — a radial bloom brighter at the arena
// center fading to the outer color toward the edges — at reduced
// resolution (long side capped at WASH_SPRITE_MAX_SIDE). The bake
// keeps the arena's aspect ratio, so stretching it over the full
// arena rect at blit time keeps the bloom circular in world space.
function buildWashSprite(
  width: number,
  height: number,
  inner: string,
  outer: string,
  alpha: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const downscale = Math.min(1, WASH_SPRITE_MAX_SIDE / Math.max(width, height));
  const sw = Math.max(1, Math.round(width * downscale));
  const sh = Math.max(1, Math.round(height * downscale));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const cx = sw / 2;
  const cy = sh / 2;
  // Radius reaches the corners so the outer color lands exactly at
  // the arena's farthest points — no flat band past the gradient end.
  const radius = Math.hypot(cx, cy);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sw, sh);
  return c;
}

// Pre-render the combined spark glow + vignette into a square canvas
// big enough to cover the radial gradient extents. Drawn each frame
// at the player position via drawImage, eliminating two full-arena
// radial-gradient fillRect passes that were costing ~5-8ms on the
// bigger camera rooms.
function buildLightSprite(width: number, height: number): {
  sprite: HTMLCanvasElement | null;
  half: number;
} {
  if (typeof document === "undefined") return { sprite: null, half: 0 };
  const sparkRadius = Math.max(width, height) * 0.45;
  const vignetteOuter = Math.max(width, height) * 0.85;
  // Sprite has to cover the larger of the two radii to avoid edge
  // clipping. Add a small pad so the gradient's last stop is exactly
  // transparent at the sprite border.
  const half = Math.ceil(vignetteOuter) + 4;
  const size = half * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return { sprite: null, half: 0 };
  // Spark glow — small inner halo.
  const spark = ctx.createRadialGradient(half, half, 0, half, half, sparkRadius);
  spark.addColorStop(0, RADIAL_INNER_RGBA);
  spark.addColorStop(1, RADIAL_OUTER_RGBA);
  ctx.fillStyle = spark;
  ctx.fillRect(0, 0, size, size);
  // Vignette — pushes far edges to near-black. Inner stop at 0.35
  // of max(w,h) so the dark band lands the same on any aspect.
  const vignetteInner = Math.max(width, height) * 0.35;
  const vignette = ctx.createRadialGradient(
    half, half, vignetteInner,
    half, half, vignetteOuter,
  );
  vignette.addColorStop(0, VIGNETTE_INNER_RGBA);
  vignette.addColorStop(1, VIGNETTE_OUTER_RGBA);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);
  return { sprite: c, half };
}

export function updateArenaBg(bg: ArenaBg, dt: number): void {
  // Dot drift — wrap around world bounds so the field is seamless.
  for (let i = 0; i < DOT_LAYERS.length; i++) {
    const layer = DOT_LAYERS[i];
    const dots = bg.dotsPerLayer[i];
    const dx = layer.speedX * dt;
    const dy = layer.speedY * dt;
    for (const d of dots) {
      d.x += dx;
      d.y += dy;
      if (d.x > bg.width) d.x -= bg.width;
      else if (d.x < 0) d.x += bg.width;
      if (d.y > bg.height) d.y -= bg.height;
      else if (d.y < 0) d.y += bg.height;
    }
  }

  // Grid pulses — spawn timer + travel each live pulse.
  bg.pulseTimer -= dt;
  if (bg.pulseTimer <= 0) {
    spawnGridPulse(bg);
    bg.pulseTimer = pickInterval(GRID_PULSE_INTERVAL_MIN, GRID_PULSE_INTERVAL_MAX);
  }
  for (let i = bg.pulses.length - 1; i >= 0; i--) {
    const p = bg.pulses[i];
    p.progress += GRID_PULSE_SPEED * dt;
    const total = Math.abs(p.endCoord - p.startCoord);
    if (p.progress > total + GRID_PULSE_TAIL_LEN) bg.pulses.splice(i, 1);
  }

  // Radar sweeps.
  bg.sweepTimer -= dt;
  if (bg.sweepTimer <= 0) {
    spawnRadarSweep(bg);
    bg.sweepTimer = pickInterval(RADAR_SWEEP_INTERVAL_MIN, RADAR_SWEEP_INTERVAL_MAX);
  }
  for (let i = bg.sweeps.length - 1; i >= 0; i--) {
    const s = bg.sweeps[i];
    s.age += dt;
    if (s.age >= RADAR_SWEEP_DURATION) bg.sweeps.splice(i, 1);
  }
}

function spawnGridPulse(bg: ArenaBg) {
  const axis: "row" | "col" = Math.random() < 0.5 ? "row" : "col";
  if (axis === "col") {
    const cols = Math.max(1, Math.floor(bg.width / GRID_STEP));
    const colIdx = Math.floor(Math.random() * cols);
    const fixedCoord = colIdx * GRID_STEP + 0.5;
    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    bg.pulses.push({
      axis,
      fixedCoord,
      startCoord: direction === 1 ? -GRID_PULSE_TAIL_LEN : bg.height + GRID_PULSE_TAIL_LEN,
      endCoord: direction === 1 ? bg.height : 0,
      progress: 0,
      direction,
    });
  } else {
    const rows = Math.max(1, Math.floor(bg.height / GRID_STEP));
    const rowIdx = Math.floor(Math.random() * rows);
    const fixedCoord = rowIdx * GRID_STEP + 0.5;
    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    bg.pulses.push({
      axis,
      fixedCoord,
      startCoord: direction === 1 ? -GRID_PULSE_TAIL_LEN : bg.width + GRID_PULSE_TAIL_LEN,
      endCoord: direction === 1 ? bg.width : 0,
      progress: 0,
      direction,
    });
  }
}

function spawnRadarSweep(bg: ArenaBg) {
  // Diagonal sweep — pick an angle that's mostly diagonal so the band
  // crosses the arena visibly. Range ±20° around 45° (or 135°).
  const baseAngle = Math.random() < 0.5 ? Math.PI / 4 : (3 * Math.PI) / 4;
  const angle = baseAngle + (Math.random() - 0.5) * (Math.PI / 9);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  // Project the arena corners onto the perpendicular axis (-sin, cos)
  // to find the band's travel range.
  const corners = [
    [0, 0],
    [bg.width, 0],
    [0, bg.height],
    [bg.width, bg.height],
  ];
  let minD = Infinity;
  let maxD = -Infinity;
  for (const [cx, cy] of corners) {
    const d = -sinA * cx + cosA * cy;
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  bg.sweeps.push({
    angle,
    cosA,
    sinA,
    startD: minD - RADAR_SWEEP_WIDTH,
    endD: maxD + RADAR_SWEEP_WIDTH,
    age: 0,
  });
}

export function drawArenaBg(
  ctx: CanvasRenderingContext2D,
  bg: ArenaBg,
  lightAnchor?: { x: number; y: number },
): void {
  const { width: w, height: h } = bg;

  ctx.save();
  ctx.shadowBlur = 0;

  // 0. Floor wash — per-zone radial bloom, baked once (lazy on first
  // draw) at reduced resolution and stretched over the full arena
  // rect. Drawn before the light sprite so its vignette darkens the
  // wash edges (dark corners per the zone reference).
  if (!bg.washSprite) {
    bg.washSprite = buildWashSprite(
      bg.width,
      bg.height,
      bg.washInner,
      bg.washOuter,
      bg.washAlpha,
    );
  }
  if (bg.washSprite) {
    ctx.drawImage(bg.washSprite, 0, 0, w, h);
  }

  // 1. Combined spark glow + vignette — pre-baked into one sprite
  // (lazy on first draw) and blitted at the light anchor. Replaces
  // two full-arena radial-gradient fillRects per frame.
  const lx = lightAnchor ? lightAnchor.x : w / 2;
  const ly = lightAnchor ? lightAnchor.y : h / 2;
  if (!bg.lightSprite) {
    const baked = buildLightSprite(bg.width, bg.height);
    bg.lightSprite = baked.sprite;
    bg.lightSpriteHalf = baked.half;
  }
  if (bg.lightSprite) {
    ctx.drawImage(
      bg.lightSprite,
      lx - bg.lightSpriteHalf,
      ly - bg.lightSpriteHalf,
    );
  }

  // 2. Parallax dots — back to front so brighter near-layer paints on top.
  for (let i = 0; i < DOT_LAYERS.length; i++) {
    const layer = DOT_LAYERS[i];
    const dots = bg.dotsPerLayer[i];
    ctx.globalAlpha = layer.alpha;
    ctx.fillStyle = bg.dustColors[i];
    const r = layer.radius;
    const d2 = r * 2;
    for (const d of dots) {
      ctx.fillRect(d.x - r, d.y - r, d2, d2);
    }
  }
  ctx.globalAlpha = 1;

  // 3. Grid pulses — bright stroke along the pulse path with a fading tail.
  if (bg.pulses.length > 0) {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.shadowColor = bg.pulseColor;
    ctx.shadowBlur = 14;
    for (const p of bg.pulses) {
      // Compute head position along the axis.
      const headStart = p.startCoord + p.direction * p.progress;
      const headEnd = headStart - p.direction * GRID_PULSE_HEAD_LEN;
      const tailEnd = headStart - p.direction * (GRID_PULSE_HEAD_LEN + GRID_PULSE_TAIL_LEN);

      // Head — solid bright.
      ctx.strokeStyle = bg.pulseColor;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      if (p.axis === "col") {
        ctx.moveTo(p.fixedCoord, clamp(headStart, 0, bg.height));
        ctx.lineTo(p.fixedCoord, clamp(headEnd, 0, bg.height));
      } else {
        ctx.moveTo(clamp(headStart, 0, bg.width), p.fixedCoord);
        ctx.lineTo(clamp(headEnd, 0, bg.width), p.fixedCoord);
      }
      ctx.stroke();

      // Tail — faint, no shadow to keep cost down.
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      if (p.axis === "col") {
        ctx.moveTo(p.fixedCoord, clamp(headEnd, 0, bg.height));
        ctx.lineTo(p.fixedCoord, clamp(tailEnd, 0, bg.height));
      } else {
        ctx.moveTo(clamp(headEnd, 0, bg.width), p.fixedCoord);
        ctx.lineTo(clamp(tailEnd, 0, bg.width), p.fixedCoord);
      }
      ctx.stroke();
      ctx.shadowBlur = 14;
    }
    ctx.restore();
  }

  // 4. Radar sweeps — soft band moving perpendicular to its length.
  if (bg.sweeps.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of bg.sweeps) {
      const u = s.age / RADAR_SWEEP_DURATION;
      // Ease in-out so the band slows at edges.
      const eu = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const d = s.startD + (s.endD - s.startD) * eu;
      // Build a perpendicular gradient anchored on the band's center
      // line. Gradient runs along the band's perpendicular axis from
      // (cx - sinA*W, cy + cosA*W) inward.
      // Use a wide rect, fill with linear gradient, rotate.
      const w2 = Math.max(bg.width, bg.height) * 1.5;
      const cx = w / 2 + s.cosA * 0 + -s.sinA * d;
      const cy = h / 2 + s.sinA * 0 + s.cosA * d;
      // Use a linear gradient from one side of the band to the other.
      const gx0 = cx + s.sinA * RADAR_SWEEP_WIDTH;
      const gy0 = cy - s.cosA * RADAR_SWEEP_WIDTH;
      const gx1 = cx - s.sinA * RADAR_SWEEP_WIDTH;
      const gy1 = cy + s.cosA * RADAR_SWEEP_WIDTH;
      const sg = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      sg.addColorStop(0, bg.sweepColorClear);
      sg.addColorStop(0.5, bg.sweepColor);
      sg.addColorStop(1, bg.sweepColorClear);
      // Fade in / out by overall age so the band doesn't appear / disappear hard.
      const envelope = u < 0.15 ? u / 0.15 : u > 0.85 ? (1 - u) / 0.15 : 1;
      ctx.globalAlpha = envelope;
      ctx.fillStyle = sg;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.angle);
      ctx.fillRect(-w2, -RADAR_SWEEP_WIDTH, w2 * 2, RADAR_SWEEP_WIDTH * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  ctx.restore();
}

// Screen-space scanlines — drawn outside camera/world transform so the
// CRT effect doesn't scale with arena size. Modes call this in their
// HUD pass.
const SCANLINE_SPACING = 4;
const SCANLINE_COLOR = "rgba(255, 255, 255, 0.025)";
let scanlineOffset = 0;
const SCANLINE_SPEED = 30;

export function tickScanlines(dt: number): void {
  scanlineOffset = (scanlineOffset + SCANLINE_SPEED * dt) % SCANLINE_SPACING;
}

export function drawScanlines(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
): void {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.fillStyle = SCANLINE_COLOR;
  for (let y = -SCANLINE_SPACING + scanlineOffset; y < viewH; y += SCANLINE_SPACING) {
    ctx.fillRect(0, y, viewW, 1);
  }
  ctx.restore();
}

function pickInterval(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
