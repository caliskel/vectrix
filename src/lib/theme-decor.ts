// Zone-themed decor — self-luminous wireframe silhouettes that fill
// the letterbox / camera margins with depth-layered parallax, plus a
// sparse set of emissive props inside the arena. One ThemeDecor per
// room, recreated by syncRoomFx() on every transition / restart /
// teleport (hard swap, no crossfade).
//
// Performance contract (CLAUDE.md "Performance architecture"):
// - Every silhouette is baked into an offscreen sprite AT SEED TIME
//   with its shadowBlur glow baked in. Per-frame cost = drawImage.
// - Fixture counts are hard-capped by the LAYER_MAX_FIXTURES /
//   PROP_* constants; nothing spawns after seeding.
// - update() only advances scalars (rotation / pulse phase) — no
//   allocation, no filtering. Draw loops allocate nothing.
// - All animation is dt-driven so the decor freezes when the game
//   loop pauses (pause menu / dev menu short-circuit).
//
// The margin layer stores positions as normalized [0..1] fractions of
// the wrap span (viewport + wrap margin), mirroring how menu-bg and
// background-energy survive window resizes without re-seeding. The
// in-arena props are seeded at FIXED world positions derived
// deterministically from the room dimensions so rooms sharing a theme
// read as cohesive architecture, not random scatter.
//
// The sandbox "underfloor" placement (drawThemeDecorUnderfloor)
// iterates the same marginFixtures / sprites with a different draw
// entry: full-viewport, no arena clip, no camera parallax — each depth
// layer drifts slowly and autonomously off d.age instead, and every
// alpha is further scaled by UNDERFLOOR_ALPHA_FACTOR (the fixtures
// carry no camera state, so the two draws share all seeding).

import type { DecorSilhouette, ZoneThemeState } from "./zone-theme";
import {
  clipArenaMargins,
  type ArenaScreenBounds,
} from "./background-energy";

// ---- margin-layer tuning -------------------------------------------------

/** Camera-offset multiplier per depth layer (0 = far … 2 = near). */
const LAYER_PARALLAX = [0.06, 0.2, 0.4] as const;
/** Per-layer alpha ceilings — multiplied by zone intensity at seed. */
const LAYER_ALPHA_CAP = [0.14, 0.22, 0.32] as const;
/** Hard caps on fixture counts per layer (seed count = cap). */
const LAYER_MAX_FIXTURES = [10, 7, 5] as const;
/** Base silhouette size range (px) per layer — far small, near large. */
const LAYER_SIZE_MIN = [34, 52, 72] as const;
const LAYER_SIZE_MAX = [54, 80, 112] as const;
/** Wrap band beyond the viewport so panning never empties a region. */
const WRAP_MARGIN_PX = 180;
/** Slow idle rotation for rotating kinds (rad/s, ± random). */
const ROTATION_VEL_MIN = 0.03;
const ROTATION_VEL_MAX = 0.1;
/** Alpha-pulse cycle for pulsing kinds (rad/s). */
const PULSE_SPEED_MIN = 0.5;
const PULSE_SPEED_MAX = 1.1;
const PULSE_DEPTH = 0.18; // alpha swings ±18 % around base
/** Glow baked into every sprite (bake-time shadowBlur only). */
const DECOR_GLOW_BLUR = 8;
const SPRITE_PAD = DECOR_GLOW_BLUR * 2;

// ---- under-floor tuning (sandbox full-viewport placement) ------------------

/** Hard alpha budget multiplied onto every under-floor fixture on top
 *  of the layer caps × zone intensity. The sandbox has no letterbox
 *  separating decor from gameplay, so the layer must sit far below
 *  threat brightness (bullets render at full alpha). */
const UNDERFLOOR_ALPHA_FACTOR = 0.45;
/** Autonomous per-layer drift velocity (px/s), indexed by depth layer
 *  (0 far … 2 near). Replaces camera parallax — headings diverge so
 *  the depth layers visibly slide past each other; magnitudes ramp
 *  ~2 → 6 px/s far → near. Applied as d.age × velocity at draw time,
 *  so the drift is dt-driven and freezes with the game loop. */
const UNDERFLOOR_DRIFT_VX = [-1.7, 2.9, -3.4] as const;
const UNDERFLOOR_DRIFT_VY = [1.0, -1.9, 4.9] as const;

// ---- in-arena props tuning -----------------------------------------------

const PROP_ROSETTE_ALPHA = 0.16;
const PROP_BRACKET_ALPHA = 0.14;
const PROP_DOT_ALPHA = 0.12;
const PROP_ROSETTE_SIZE = 150;
const PROP_BRACKET_SIZE = 56;
const PROP_DOT_SIZE = 10;
/** Corner-bracket inset from the room corners (px, clamped). */
const PROP_BRACKET_INSET_MIN = 70;
const PROP_BRACKET_INSET_MAX = 140;
/** Rosette offset away from spawn, as a fraction of min room dim. */
const PROP_ROSETTE_OFFSET_FRAC = 0.16;
/** Scattered accent dots — fixed fractional positions of the room. */
const PROP_DOT_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0.22, 0.3],
  [0.78, 0.7],
  [0.32, 0.74],
  [0.68, 0.26],
  [0.5, 0.16],
  [0.5, 0.84],
];

// ---- types ---------------------------------------------------------------

type DecorFixture = {
  layer: number; // 0 far, 1 mid, 2 near
  /** Normalized [0..1) position over the wrap span. */
  nx: number;
  ny: number;
  baseAlpha: number; // already × zone intensity
  rotation: number;
  rotationVel: number; // rad/s; 0 = static
  pulsePhase: number;
  pulseSpeed: number; // rad/s; 0 = no pulse
  sprite: HTMLCanvasElement | null;
  spriteHalf: number; // CSS-px half size for centering
};

type DecorProp = {
  x: number; // world coords
  y: number;
  rotation: number; // fixed orientation (corner brackets)
  alpha: number; // already × zone intensity
  sprite: HTMLCanvasElement | null;
  spriteHalf: number;
  halfExtent: number; // world-space half size for the cull check
};

export type ThemeDecor = {
  zone: ZoneThemeState;
  marginFixtures: DecorFixture[];
  props: DecorProp[];
  age: number;
};

// ---- sprite baking (seed-time only — shadowBlur lives here) --------------

type BakedSprite = { canvas: HTMLCanvasElement; half: number };

function makeSpriteCanvas(size: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  half: number;
} | null {
  if (typeof document === "undefined") return null;
  const px = Math.ceil(size) + SPRITE_PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const half = px / 2;
  ctx.translate(half, half);
  ctx.strokeStyle = "#fff"; // overwritten by each baker
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { canvas, ctx, half };
}

function traceHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 2–5 nested / adjacent pointy-top wireframe hexagons. */
function bakeHexCluster(color: string, size: number): BakedSprite | null {
  const s = makeSpriteCanvas(size);
  if (!s) return null;
  const { canvas, ctx, half } = s;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = DECOR_GLOW_BLUR;
  ctx.lineWidth = 1.5;
  const mainR = size * 0.32;
  traceHex(ctx, 0, 0, mainR);
  ctx.stroke();
  const extra = 1 + Math.floor(Math.random() * 4); // 1..4 → total 2..5
  for (let i = 0; i < extra; i++) {
    if (Math.random() < 0.45) {
      // Nested — smaller hex sharing the center.
      traceHex(ctx, 0, 0, mainR * (0.4 + Math.random() * 0.35));
    } else {
      // Adjacent — shares an edge: offset by r·√3 along an edge normal.
      const dir = -Math.PI / 3 + Math.floor(Math.random() * 6) * (Math.PI / 3);
      const r2 = mainR * (0.5 + Math.random() * 0.5);
      const d = (mainR + r2) * 0.5 * Math.sqrt(3);
      traceHex(ctx, Math.cos(dir) * d, Math.sin(dir) * d, r2);
    }
    ctx.stroke();
  }
  return { canvas, half };
}

/** Right-angle polyline traces with node dots at bends. */
function bakeCircuit(color: string, size: number): BakedSprite | null {
  const s = makeSpriteCanvas(size);
  if (!s) return null;
  const { canvas, ctx, half } = s;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = DECOR_GLOW_BLUR;
  ctx.lineWidth = 1.4;
  const ext = size * 0.42;
  const traces = 2 + Math.floor(Math.random() * 2); // 2..3 traces
  for (let t = 0; t < traces; t++) {
    let x = -ext + Math.random() * ext;
    let y = -ext + Math.random() * ext * 2;
    let horizontal = Math.random() < 0.5;
    const segs = 3 + Math.floor(Math.random() * 3); // 3..5 segments
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < segs; i++) {
      const len = size * (0.12 + Math.random() * 0.22);
      const sign = Math.random() < 0.5 ? -1 : 1;
      if (horizontal) x = clampAbs(x + len * sign, ext);
      else y = clampAbs(y + len * sign, ext);
      ctx.lineTo(x, y);
      horizontal = !horizontal;
    }
    ctx.stroke();
    // Node dot at the trace end (and a mid-bend dot for longer ones).
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return { canvas, half };
}

/** Rows of short bars — terminal / data-readout block. */
function bakeDataBlock(color: string, size: number): BakedSprite | null {
  const s = makeSpriteCanvas(size);
  if (!s) return null;
  const { canvas, ctx, half } = s;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = DECOR_GLOW_BLUR;
  const rows = 4 + Math.floor(Math.random() * 3); // 4..6 rows
  const rowH = Math.max(2, size * 0.06);
  const gap = rowH * 1.3;
  const top = -((rows - 1) * (rowH + gap)) / 2;
  const maxW = size * 0.8;
  for (let r = 0; r < rows; r++) {
    const y = top + r * (rowH + gap);
    let x = -maxW / 2;
    const bars = 1 + Math.floor(Math.random() * 3); // 1..3 bars per row
    for (let b = 0; b < bars && x < maxW / 2; b++) {
      const w = maxW * (0.12 + Math.random() * 0.35);
      const wClamped = Math.min(w, maxW / 2 - x);
      ctx.fillRect(x, y - rowH / 2, wClamped, rowH);
      x += wClamped + maxW * 0.08;
    }
  }
  return { canvas, half };
}

/** Thin circle + inner iris ring + bright pupil dot — VECTRIX motif. */
function bakeEye(color: string, size: number): BakedSprite | null {
  const s = makeSpriteCanvas(size);
  if (!s) return null;
  const { canvas, ctx, half } = s;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = DECOR_GLOW_BLUR;
  const r = size * 0.4;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  // Bright pupil — second fill pass doubles the baked glow.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fill();
  return { canvas, half };
}

function bakeSilhouette(
  kind: DecorSilhouette,
  color: string,
  size: number,
): BakedSprite | null {
  switch (kind) {
    case "hexCluster":
      return bakeHexCluster(color, size);
    case "circuit":
      return bakeCircuit(color, size);
    case "dataBlock":
      return bakeDataBlock(color, size);
    case "eye":
      return bakeEye(color, size);
  }
}

/** Concentric wireframe rings + hex — the anchor rosette prop. */
function bakeRosette(color: string, size: number): BakedSprite | null {
  const s = makeSpriteCanvas(size);
  if (!s) return null;
  const { canvas, ctx, half } = s;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = DECOR_GLOW_BLUR;
  const r = size * 0.45;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  traceHex(ctx, 0, 0, r * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  ctx.stroke();
  return { canvas, half };
}

/** L-shaped corner bracket — baked pointing at the top-left corner;
 *  rotated per corner at draw via the prop's fixed rotation. */
function bakeBracket(color: string, size: number): BakedSprite | null {
  const s = makeSpriteCanvas(size);
  if (!s) return null;
  const { canvas, ctx, half } = s;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = DECOR_GLOW_BLUR;
  ctx.lineWidth = 2;
  const a = size * 0.4;
  ctx.beginPath();
  ctx.moveTo(-a, a * 0.2);
  ctx.lineTo(-a, -a);
  ctx.lineTo(a * 0.2, -a);
  ctx.stroke();
  // Inner echo stroke for a panel-trim read.
  ctx.lineWidth = 1;
  const b = a * 0.6;
  ctx.beginPath();
  ctx.moveTo(-b, b * 0.1);
  ctx.lineTo(-b, -b);
  ctx.lineTo(b * 0.1, -b);
  ctx.stroke();
  return { canvas, half };
}

function bakeDot(color: string, size: number): BakedSprite | null {
  const s = makeSpriteCanvas(size);
  if (!s) return null;
  const { canvas, ctx, half } = s;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = DECOR_GLOW_BLUR;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.25, 0, Math.PI * 2);
  ctx.fill();
  return { canvas, half };
}

// ---- seeding ---------------------------------------------------------------

export function createThemeDecor(
  zone: ZoneThemeState,
  roomW: number,
  roomH: number,
  spawnX?: number,
  spawnY?: number,
): ThemeDecor {
  // Margin fixtures store normalized [0..1) wrap-span fractions and
  // consume the live viewport size at draw time, so window resizes
  // re-flow the layer without re-seeding (background-energy pattern).
  const marginFixtures: DecorFixture[] = [];
  const kinds = zone.theme.decorDominant;
  if (kinds.length > 0) {
    for (let layer = 0; layer < LAYER_PARALLAX.length; layer++) {
      const count = LAYER_MAX_FIXTURES[layer];
      // Far + mid pieces use the dim accent; near pieces the bright one.
      const color = layer === 2 ? zone.theme.accent : zone.theme.accentDim;
      for (let i = 0; i < count; i++) {
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        const size =
          LAYER_SIZE_MIN[layer] +
          Math.random() * (LAYER_SIZE_MAX[layer] - LAYER_SIZE_MIN[layer]);
        const baked = bakeSilhouette(kind, color, size);
        const rotates = kind === "hexCluster";
        const pulses = kind === "dataBlock" || kind === "eye";
        marginFixtures.push({
          layer,
          nx: Math.random(),
          ny: Math.random(),
          baseAlpha:
            LAYER_ALPHA_CAP[layer] *
            zone.intensity *
            (0.75 + Math.random() * 0.25),
          rotation: rotates ? Math.random() * Math.PI * 2 : 0,
          rotationVel: rotates
            ? (ROTATION_VEL_MIN +
                Math.random() * (ROTATION_VEL_MAX - ROTATION_VEL_MIN)) *
              (Math.random() < 0.5 ? -1 : 1)
            : 0,
          pulsePhase: Math.random() * Math.PI * 2,
          pulseSpeed: pulses
            ? PULSE_SPEED_MIN +
              Math.random() * (PULSE_SPEED_MAX - PULSE_SPEED_MIN)
            : 0,
          sprite: baked ? baked.canvas : null,
          spriteHalf: baked ? baked.half : 0,
        });
      }
    }
  }
  return {
    zone,
    marginFixtures,
    // Props are world-space room dressing — only seeded when the caller
    // has a room (spawn point provided). The sandbox under-floor branch
    // passes none and never draws props, so the bakes are skipped.
    props:
      spawnX !== undefined && spawnY !== undefined
        ? seedProps(zone, roomW, roomH, spawnX, spawnY)
        : [],
    age: 0,
  };
}

/** Fixed world-space compositions derived deterministically from the
 *  room dimensions — NOT random scatter, so rooms sharing a theme read
 *  as the same architecture. */
function seedProps(
  zone: ZoneThemeState,
  roomW: number,
  roomH: number,
  spawnX: number,
  spawnY: number,
): DecorProp[] {
  const props: DecorProp[] = [];
  const color = zone.theme.accentDim;
  const minDim = Math.min(roomW, roomH);
  const cx = roomW / 2;
  const cy = roomH / 2;

  // Anchor rosette — near room center, nudged away from the spawn so
  // it doesn't sit directly under the player's entry point.
  let rx = cx;
  let ry = cy;
  {
    const dx = cx - spawnX;
    const dy = cy - spawnY;
    const d = Math.hypot(dx, dy);
    const off = minDim * PROP_ROSETTE_OFFSET_FRAC;
    if (d > 1) {
      rx = cx + (dx / d) * off;
      ry = cy + (dy / d) * off;
    } else {
      ry = cy + off; // spawn at exact center — push downward
    }
  }
  const rosette = bakeRosette(color, PROP_ROSETTE_SIZE);
  props.push({
    x: rx,
    y: ry,
    rotation: 0,
    alpha: PROP_ROSETTE_ALPHA * zone.intensity,
    sprite: rosette ? rosette.canvas : null,
    spriteHalf: rosette ? rosette.half : 0,
    halfExtent: PROP_ROSETTE_SIZE / 2 + SPRITE_PAD,
  });

  // Four corner bracket accents, inset from the room corners. One bake
  // (top-left orientation) rotated per corner.
  const inset = Math.min(
    PROP_BRACKET_INSET_MAX,
    Math.max(PROP_BRACKET_INSET_MIN, minDim * 0.12),
  );
  const bracket = bakeBracket(color, PROP_BRACKET_SIZE);
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [inset, inset, 0],
    [roomW - inset, inset, Math.PI / 2],
    [roomW - inset, roomH - inset, Math.PI],
    [inset, roomH - inset, -Math.PI / 2],
  ];
  for (const [x, y, rot] of corners) {
    props.push({
      x,
      y,
      rotation: rot,
      alpha: PROP_BRACKET_ALPHA * zone.intensity,
      sprite: bracket ? bracket.canvas : null,
      spriteHalf: bracket ? bracket.half : 0,
      halfExtent: PROP_BRACKET_SIZE / 2 + SPRITE_PAD,
    });
  }

  // Scattered accent dots at fixed fractional positions.
  const dot = bakeDot(color, PROP_DOT_SIZE);
  for (const [fx, fy] of PROP_DOT_POSITIONS) {
    props.push({
      x: roomW * fx,
      y: roomH * fy,
      rotation: 0,
      alpha: PROP_DOT_ALPHA * zone.intensity,
      sprite: dot ? dot.canvas : null,
      spriteHalf: dot ? dot.half : 0,
      halfExtent: PROP_DOT_SIZE / 2 + SPRITE_PAD,
    });
  }

  return props;
}

// ---- update ----------------------------------------------------------------

export function updateThemeDecor(d: ThemeDecor, dt: number): void {
  d.age += dt;
  const fixtures = d.marginFixtures;
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    if (f.rotationVel !== 0) f.rotation += f.rotationVel * dt;
    if (f.pulseSpeed !== 0) f.pulsePhase += f.pulseSpeed * dt;
  }
}

// ---- draw: margin + under-floor fixture passes ----------------------------

// Per-layer draw offsets, computed by each entry point into module
// scratch (no per-frame allocation), consumed by the shared loop.
const LAYER_OFFSET_X = [0, 0, 0];
const LAYER_OFFSET_Y = [0, 0, 0];

/**
 * Shared fixture blit loop: wrap → viewport cull → optional inside-
 * arena reject → pulse-dim → rotate-or-blit. The pulse only DIMS
 * (never exceeds baseAlpha) so the per-layer alpha caps hold at every
 * phase of the cycle. Allocation-free.
 *
 * `arena` (when given) rejects fixtures whose sprite AABB lies fully
 * inside the arena rect — the margin clip would discard them anyway,
 * so the drawImage is pure waste (most fixtures land there in play).
 */
function drawFixtures(
  ctx: CanvasRenderingContext2D,
  d: ThemeDecor,
  viewW: number,
  viewH: number,
  alphaFactor: number,
  arena: ArenaScreenBounds | null,
): void {
  const fixtures = d.marginFixtures;
  const spanX = viewW + WRAP_MARGIN_PX * 2;
  const spanY = viewH + WRAP_MARGIN_PX * 2;
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    if (!f.sprite) continue;
    const x =
      wrapCoord(f.nx * spanX + LAYER_OFFSET_X[f.layer], spanX) -
      WRAP_MARGIN_PX;
    const y =
      wrapCoord(f.ny * spanY + LAYER_OFFSET_Y[f.layer], spanY) -
      WRAP_MARGIN_PX;
    const half = f.spriteHalf;
    if (x + half < 0 || x - half > viewW || y + half < 0 || y - half > viewH) {
      continue;
    }
    if (
      arena &&
      x - half >= arena.x &&
      x + half <= arena.x + arena.w &&
      y - half >= arena.y &&
      y + half <= arena.y + arena.h
    ) {
      continue;
    }
    let alpha = f.baseAlpha * alphaFactor;
    if (f.pulseSpeed !== 0) {
      alpha *= 1 - PULSE_DEPTH * (Math.sin(f.pulsePhase) * 0.5 + 0.5);
    }
    ctx.globalAlpha = alpha;
    if (f.rotation !== 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(f.rotation);
      ctx.drawImage(f.sprite, -half, -half);
      ctx.restore();
    } else {
      ctx.drawImage(f.sprite, x - half, y - half);
    }
  }
}

/**
 * Screen-space margin pass. Caller must have the identity×dpr
 * transform active. Clips to viewport-minus-arena (clipArenaMargins)
 * and bails out entirely when the arena covers the whole viewport.
 *
 * `scaleToScreen` is the letterbox scale (world px → screen px) so the
 * parallax offsets track the camera at screen speed.
 */
export function drawThemeDecorMargins(
  ctx: CanvasRenderingContext2D,
  d: ThemeDecor,
  viewW: number,
  viewH: number,
  arena: ArenaScreenBounds,
  cameraX: number,
  cameraY: number,
  scaleToScreen: number,
): void {
  if (d.marginFixtures.length === 0) return;
  if (
    arena.x <= 0 &&
    arena.y <= 0 &&
    arena.x + arena.w >= viewW &&
    arena.y + arena.h >= viewH
  ) {
    return; // arena covers the viewport — nothing visible this frame
  }
  for (let layer = 0; layer < LAYER_PARALLAX.length; layer++) {
    LAYER_OFFSET_X[layer] = -cameraX * LAYER_PARALLAX[layer] * scaleToScreen;
    LAYER_OFFSET_Y[layer] = -cameraY * LAYER_PARALLAX[layer] * scaleToScreen;
  }
  ctx.save();
  clipArenaMargins(ctx, viewW, viewH, arena);
  drawFixtures(ctx, d, viewW, viewH, 1, arena);
  ctx.restore();
}

/**
 * Full-viewport under-floor pass (sandbox) — same fixtures and sprites
 * as the margin layer, drawn beneath a transparent grid bake instead of
 * beside the arena. No arena clip, no camera parallax: each depth layer
 * drifts autonomously at its UNDERFLOOR_DRIFT_* velocity via d.age
 * (dt-driven in updateThemeDecor, so it freezes with the game loop),
 * and every alpha is additionally scaled by UNDERFLOOR_ALPHA_FACTOR so
 * the decor stays far below threat brightness. Caller must have the
 * identity×dpr transform active.
 */
export function drawThemeDecorUnderfloor(
  ctx: CanvasRenderingContext2D,
  d: ThemeDecor,
  viewW: number,
  viewH: number,
): void {
  if (d.marginFixtures.length === 0) return;
  for (let layer = 0; layer < LAYER_PARALLAX.length; layer++) {
    LAYER_OFFSET_X[layer] = UNDERFLOOR_DRIFT_VX[layer] * d.age;
    LAYER_OFFSET_Y[layer] = UNDERFLOOR_DRIFT_VY[layer] * d.age;
  }
  ctx.save();
  drawFixtures(ctx, d, viewW, viewH, UNDERFLOOR_ALPHA_FACTOR, null);
  ctx.restore();
}

// ---- draw: in-arena props ------------------------------------------------------

/**
 * World-space props pass — call inside the camera transform, after the
 * floor (grid / archive-fx) and before walls so the props read as part
 * of the architecture, under every entity. Cull rect in world coords.
 */
export function drawThemeDecorProps(
  ctx: CanvasRenderingContext2D,
  d: ThemeDecor,
  cullLeft: number,
  cullTop: number,
  cullRight: number,
  cullBottom: number,
): void {
  const props = d.props;
  if (props.length === 0) return;
  ctx.save();
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (!p.sprite) continue;
    if (
      p.x + p.halfExtent < cullLeft ||
      p.x - p.halfExtent > cullRight ||
      p.y + p.halfExtent < cullTop ||
      p.y - p.halfExtent > cullBottom
    ) {
      continue;
    }
    ctx.globalAlpha = p.alpha;
    if (p.rotation !== 0) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.drawImage(p.sprite, -p.spriteHalf, -p.spriteHalf);
      ctx.restore();
    } else {
      ctx.drawImage(p.sprite, p.x - p.spriteHalf, p.y - p.spriteHalf);
    }
  }
  ctx.restore();
}

// ---- helpers ---------------------------------------------------------------

function wrapCoord(v: number, span: number): number {
  let r = v % span;
  if (r < 0) r += span;
  return r;
}

function clampAbs(v: number, limit: number): number {
  return v < -limit ? -limit : v > limit ? limit : v;
}
