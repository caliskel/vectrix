import { PALETTE } from "./palette";
import type { Player } from "./player";

export type Wall = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** When true, the player phases through this wall while in dash
   *  i-frames. Other entities (enemies, bullets, lasers) still treat
   *  it as solid. Tagged on Tutorial Room 0's dash gate and the Room
   *  4 corridor's section dividers. */
  dashable?: boolean;
};

/** Anything we resolve walls against. Player and the moving enemies
 *  (Watcher, Hunter) all satisfy this shape, so the resolver is shared. */
export type WallEntity = { x: number; y: number; vx: number; vy: number };

/**
 * AABB resolve: pushes the entity out of any wall it overlaps along
 * the axis with the smallest penetration, zeroing the matching
 * velocity component so the entity slides along the wall instead of
 * locking in. Used by both player movement and enemy chases.
 */
export function resolveEntityWallCollisions(
  entity: WallEntity,
  walls: Wall[],
  halfSize: number,
): { stoppedX: boolean; stoppedY: boolean } {
  let stoppedX = false;
  let stoppedY = false;
  for (const w of walls) {
    const px1 = entity.x - halfSize;
    const px2 = entity.x + halfSize;
    const py1 = entity.y - halfSize;
    const py2 = entity.y + halfSize;
    const wx1 = w.x;
    const wx2 = w.x + w.w;
    const wy1 = w.y;
    const wy2 = w.y + w.h;
    if (px2 <= wx1 || px1 >= wx2 || py2 <= wy1 || py1 >= wy2) continue;
    const oLeft = px2 - wx1;
    const oRight = wx2 - px1;
    const oTop = py2 - wy1;
    const oBottom = wy2 - py1;
    const m = Math.min(oLeft, oRight, oTop, oBottom);
    if (m === oLeft) {
      entity.x -= oLeft;
      if (entity.vx > 0) entity.vx = 0;
      stoppedX = true;
    } else if (m === oRight) {
      entity.x += oRight;
      if (entity.vx < 0) entity.vx = 0;
      stoppedX = true;
    } else if (m === oTop) {
      entity.y -= oTop;
      if (entity.vy > 0) entity.vy = 0;
      stoppedY = true;
    } else {
      entity.y += oBottom;
      if (entity.vy < 0) entity.vy = 0;
      stoppedY = true;
    }
  }
  return { stoppedX, stoppedY };
}

/** Backwards-compatible alias for the previous player-only signature. */
export function resolvePlayerWallCollisions(
  player: Player,
  walls: Wall[],
  halfSize: number,
): { stoppedX: boolean; stoppedY: boolean } {
  return resolveEntityWallCollisions(player, walls, halfSize);
}

// True if the bullet's center sits inside any wall's AABB. Returns the
// hit wall so callers can spawn an impact ripple at the contact point.
export function bulletInsideWall(
  bx: number,
  by: number,
  walls: Wall[],
): boolean {
  for (const w of walls) {
    if (bx >= w.x && bx <= w.x + w.w && by >= w.y && by <= w.y + w.h) {
      return true;
    }
  }
  return false;
}

// Variant that returns the first wall hit, for spawning impact FX on
// the wall surface. Returns null when the point is outside every wall.
export function findContainingWall(
  bx: number,
  by: number,
  walls: Wall[],
): Wall | null {
  for (const w of walls) {
    if (bx >= w.x && bx <= w.x + w.w && by >= w.y && by <= w.y + w.h) {
      return w;
    }
  }
  return null;
}

const WALL_FILL = "rgba(28, 35, 60, 0.85)";
const WALL_STROKE = "#7dd3fc";
const WALL_STROKE_ALPHA = 0.6;
const WALL_GLOW_BLUR = 12;
const DASHABLE_GLOW_BLUR = 14;
const BRACKET_LEN_PX = 14;
const BRACKET_INSET_PX = 2;
const BRACKET_LINE_WIDTH = 2.5;
const HATCH_SPACING_PX = 8;
const HATCH_ALPHA = 0.05;
const MARCHING_DASH_INSET_PX = 4;
const MARCHING_DASH_PATTERN = [10, 14] as const;
const MARCHING_DASH_SPEED = 28; // px/s lineDashOffset drift
const MARCHING_DASH_ALPHA = 0.35;
const PERIMETER_PULSE_INTERVAL_MIN = 4.0;
const PERIMETER_PULSE_INTERVAL_MAX = 9.0;
const PERIMETER_PULSE_SPEED = 380; // px/s along perimeter
const PERIMETER_PULSE_HEAD_RADIUS = 3.2;
const PERIMETER_PULSE_GLOW = 14;
const PERIMETER_PULSE_COLOR = "#a5f3fc";
const RIPPLE_LIFETIME_SEC = 0.45;
const RIPPLE_RADIUS_START = 4;
const RIPPLE_RADIUS_END = 28;
const RIPPLE_LINE_WIDTH_START = 2.5;
const RIPPLE_LINE_WIDTH_END = 0.5;
const RIPPLE_GLOW = 10;
const RIPPLE_COLOR = "#a5f3fc";
const RIPPLE_FRAGMENT_COUNT = 0; // reserved for later; keep ring-only for now

// Wall damage — each non-dashable wall gets 1-3 broken spots along
// its perimeter. Each spot has static cracks etched inward and emits
// occasional electric arcs + sparks outward. Reads as "the network
// is leaking what little power it has left through every crack."
const DAMAGE_AREA_THRESHOLD_2 = 30000;  // wall area > this gets 2 damage spots
const DAMAGE_AREA_THRESHOLD_3 = 90000;  // and > this gets 3
const DAMAGE_CRACK_COUNT_MIN = 2;
const DAMAGE_CRACK_COUNT_MAX = 4;
const DAMAGE_CRACK_SEG_MIN = 2;
const DAMAGE_CRACK_SEG_MAX = 4;
const DAMAGE_CRACK_SEG_LEN_MIN = 3;
const DAMAGE_CRACK_SEG_LEN_MAX = 8;
const DAMAGE_CRACK_JITTER = 4;
const DAMAGE_CORE_RADIUS = 3.2;
const DAMAGE_GLOW_RADIUS = 1.4;
const DAMAGE_CORE_COLOR = "rgba(5, 10, 20, 0.95)";
const DAMAGE_GLOW_COLOR = "rgba(165, 243, 252, 0.55)";
const DAMAGE_CRACK_COLOR = "rgba(8, 14, 26, 0.95)";
const DAMAGE_CRACK_LINE_WIDTH = 1.4;

const ARC_INTERVAL_MIN = 2.5;
const ARC_INTERVAL_MAX = 6.0;
const ARC_SEGMENTS_MIN = 3;
const ARC_SEGMENTS_MAX = 5;
const ARC_LENGTH_MIN = 18;
const ARC_LENGTH_MAX = 42;
const ARC_JITTER_PX = 13;
const ARC_LIFETIME_MIN_SEC = 0.10;
const ARC_LIFETIME_MAX_SEC = 0.18;
const ARC_COLOR = "#a5f3fc";
const ARC_GLOW_BLUR = 14;
const ARC_LINE_WIDTH = 1.7;
const ARC_SPARK_COUNT_MIN = 1;
const ARC_SPARK_COUNT_MAX = 2;
const SPARK_SPEED_MIN = 80;
const SPARK_SPEED_MAX = 200;
const SPARK_LIFETIME_SEC = 0.45;
const SPARK_GRAVITY = 240;
const SPARK_COLOR = "#a5f3fc";

// Wall layer cache: walls don't move within a room, so we bake them
// into an offscreen canvas the first frame the array is seen and blit
// per frame afterwards. Animated overlays (marching dashes, perimeter
// pulses, impact ripples) draw live on top via drawWallOverlay.
type CachedLayer = {
  canvas: HTMLCanvasElement;
  extentX: number;
  extentY: number;
  // Wall count at cache time. Tutorial Room 0 mutates the walls array
  // mid-room (phase 2 pushes the dashable dash gate); the array
  // reference is unchanged but contents differ, so we also key on
  // length here. Without this, the cached image stays from phase 1
  // and the dash wall renders invisibly.
  wallCount: number;
};
const layerCache = new WeakMap<Wall[], CachedLayer>();

type PerimeterPulse = {
  wallIndex: number;
  progress: number; // px travelled along the perimeter
  perimeter: number;
};

type WallRipple = {
  x: number;
  y: number;
  age: number; // 0..RIPPLE_LIFETIME_SEC
};

type Vec2 = { x: number; y: number };

type DamagePoint = {
  // World-space anchor on the wall edge.
  x: number;
  y: number;
  // Outward unit normal (away from the wall body).
  nx: number;
  ny: number;
  // Pre-computed crack polylines extending INWARD from (x,y). Each
  // polyline is in world space; drawn live each frame as a thin dark
  // stroke. Static — generated once at damage-point creation.
  cracks: Vec2[][];
  // Time remaining until the next electric arc fires from this spot.
  nextArcAt: number;
};

type ElectricArc = {
  origin: DamagePoint;
  // World-space polyline of the arc's jagged path going outward from
  // origin in the +normal direction.
  segments: Vec2[];
  age: number;
  lifetime: number;
};

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
};

// FX state is animation-only (timers + spawned entities). The walls
// array is passed per call so tutorial Room 0's phase mutations
// (.push of the dash wall, .filter reassign in combat) are picked up
// without needing a separate sync step on every phase change.
//
// `damage` is keyed by Wall reference so each wall keeps its own
// crack pattern across frames. Damage points are generated lazily
// the first time a wall is seen — tutorial's mid-room wall push
// gets its damage on the next frame after the push.
export type WallFx = {
  marchOffset: number;
  pulses: PerimeterPulse[];
  ripples: WallRipple[];
  pulseTimer: number;
  damage: Map<Wall, DamagePoint[]>;
  arcs: ElectricArc[];
  sparks: Spark[];
};

export function createWallFx(_walls?: Wall[]): WallFx {
  return {
    marchOffset: 0,
    pulses: [],
    ripples: [],
    pulseTimer: pickInterval(PERIMETER_PULSE_INTERVAL_MIN, PERIMETER_PULSE_INTERVAL_MAX) * 0.5,
    damage: new Map(),
    arcs: [],
    sparks: [],
  };
}

function ensureWallDamage(fx: WallFx, wall: Wall): DamagePoint[] {
  // Dashable walls (the tutorial phase-2 gate, Room 4 section
  // dividers) are semantic markers in a different visual language —
  // skip damage on them.
  if (wall.dashable) {
    return fx.damage.get(wall) ?? [];
  }
  let pts = fx.damage.get(wall);
  if (pts) return pts;
  pts = [];
  const area = wall.w * wall.h;
  let count = 1;
  if (area >= DAMAGE_AREA_THRESHOLD_3) count = 3;
  else if (area >= DAMAGE_AREA_THRESHOLD_2) count = 2;
  for (let i = 0; i < count; i++) {
    pts.push(buildDamagePoint(wall));
  }
  fx.damage.set(wall, pts);
  return pts;
}

function buildDamagePoint(wall: Wall): DamagePoint {
  // Pick a random side. Bias toward the longer sides — they have
  // more visual real estate for the damage to read on.
  const horizPerimeter = wall.w * 2;
  const vertPerimeter = wall.h * 2;
  const totalPerimeter = horizPerimeter + vertPerimeter;
  let r = Math.random() * totalPerimeter;
  let x: number;
  let y: number;
  let nx: number;
  let ny: number;
  // Inset slightly from corners so the damage spot doesn't land
  // exactly on the wall edge corner.
  const inset = 8;
  if (r < wall.w) {
    // top edge
    x = wall.x + Math.max(inset, Math.min(wall.w - inset, r));
    y = wall.y;
    nx = 0;
    ny = -1;
  } else if ((r -= wall.w) < wall.h) {
    // right edge
    x = wall.x + wall.w;
    y = wall.y + Math.max(inset, Math.min(wall.h - inset, r));
    nx = 1;
    ny = 0;
  } else if ((r -= wall.h) < wall.w) {
    // bottom edge
    x = wall.x + Math.max(inset, Math.min(wall.w - inset, r));
    y = wall.y + wall.h;
    nx = 0;
    ny = 1;
  } else {
    // left edge
    r -= wall.w;
    x = wall.x;
    y = wall.y + Math.max(inset, Math.min(wall.h - inset, r));
    nx = -1;
    ny = 0;
  }
  return {
    x,
    y,
    nx,
    ny,
    cracks: buildCracks(nx, ny),
    nextArcAt: pickInterval(0.5, ARC_INTERVAL_MAX),
  };
}

function buildCracks(nx: number, ny: number): Vec2[][] {
  // Inward direction = -normal. Tangent perpendicular to normal.
  const inX = -nx;
  const inY = -ny;
  const tx = -ny;
  const ty = nx;
  const count =
    DAMAGE_CRACK_COUNT_MIN +
    Math.floor(Math.random() * (DAMAGE_CRACK_COUNT_MAX - DAMAGE_CRACK_COUNT_MIN + 1));
  const polylines: Vec2[][] = [];
  for (let k = 0; k < count; k++) {
    const pts: Vec2[] = [{ x: 0, y: 0 }];
    // Each crack picks a slight angular spread off the inward axis.
    const spread = (Math.random() - 0.5) * 0.9;
    const dirX = inX * Math.cos(spread) + tx * Math.sin(spread);
    const dirY = inY * Math.cos(spread) + ty * Math.sin(spread);
    const segs =
      DAMAGE_CRACK_SEG_MIN +
      Math.floor(Math.random() * (DAMAGE_CRACK_SEG_MAX - DAMAGE_CRACK_SEG_MIN + 1));
    let cx = 0;
    let cy = 0;
    for (let s = 0; s < segs; s++) {
      const len =
        DAMAGE_CRACK_SEG_LEN_MIN +
        Math.random() * (DAMAGE_CRACK_SEG_LEN_MAX - DAMAGE_CRACK_SEG_LEN_MIN);
      cx += dirX * len;
      cy += dirY * len;
      const jitter = (Math.random() - 0.5) * DAMAGE_CRACK_JITTER;
      cx += tx * jitter;
      cy += ty * jitter;
      pts.push({ x: cx, y: cy });
    }
    polylines.push(pts);
  }
  return polylines;
}

function buildArc(dp: DamagePoint): Vec2[] {
  // Outward = +normal direction. Tangent perpendicular.
  const tx = -dp.ny;
  const ty = dp.nx;
  const segs =
    ARC_SEGMENTS_MIN +
    Math.floor(Math.random() * (ARC_SEGMENTS_MAX - ARC_SEGMENTS_MIN + 1));
  const totalLen = pickInterval(ARC_LENGTH_MIN, ARC_LENGTH_MAX);
  const segLen = totalLen / segs;
  const pts: Vec2[] = [{ x: dp.x, y: dp.y }];
  let cx = dp.x;
  let cy = dp.y;
  for (let s = 0; s < segs; s++) {
    cx += dp.nx * segLen;
    cy += dp.ny * segLen;
    const jitter = (Math.random() - 0.5) * ARC_JITTER_PX;
    cx += tx * jitter;
    cy += ty * jitter;
    pts.push({ x: cx, y: cy });
  }
  return pts;
}

export function updateWallFx(fx: WallFx, dt: number, walls: Wall[]): void {
  fx.marchOffset = (fx.marchOffset + MARCHING_DASH_SPEED * dt) % 24;

  // Pulse spawn — pick a non-dashable wall (dashable walls are
  // semantic markers, the pulse would clash with their existing
  // marching dashed outline).
  fx.pulseTimer -= dt;
  if (fx.pulseTimer <= 0) {
    fx.pulseTimer = pickInterval(PERIMETER_PULSE_INTERVAL_MIN, PERIMETER_PULSE_INTERVAL_MAX);
    const eligible: number[] = [];
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (!w.dashable && w.w >= 40 && w.h >= 40) eligible.push(i);
    }
    if (eligible.length > 0) {
      const idx = eligible[Math.floor(Math.random() * eligible.length)];
      const w = walls[idx];
      const perimeter = 2 * (w.w + w.h);
      fx.pulses.push({
        wallIndex: idx,
        progress: Math.random() * perimeter,
        perimeter,
      });
    }
  }
  for (let i = fx.pulses.length - 1; i >= 0; i--) {
    const p = fx.pulses[i];
    p.progress += PERIMETER_PULSE_SPEED * dt;
    if (p.progress > p.perimeter * 1.5) fx.pulses.splice(i, 1);
  }

  // Ripples — age out.
  for (let i = fx.ripples.length - 1; i >= 0; i--) {
    const r = fx.ripples[i];
    r.age += dt;
    if (r.age >= RIPPLE_LIFETIME_SEC) fx.ripples.splice(i, 1);
  }

  // Wall damage — ensure every non-dashable wall has damage points
  // generated, then tick each spot's arc timer. When a timer trips,
  // spawn an electric arc + 1-2 sparks. Lazy generation handles
  // tutorial's mid-room wall mutations transparently.
  for (const w of walls) {
    if (w.dashable) continue;
    const pts = ensureWallDamage(fx, w);
    for (const dp of pts) {
      dp.nextArcAt -= dt;
      if (dp.nextArcAt <= 0) {
        dp.nextArcAt = pickInterval(ARC_INTERVAL_MIN, ARC_INTERVAL_MAX);
        fx.arcs.push({
          origin: dp,
          segments: buildArc(dp),
          age: 0,
          lifetime: pickInterval(ARC_LIFETIME_MIN_SEC, ARC_LIFETIME_MAX_SEC),
        });
        const sparkCount =
          ARC_SPARK_COUNT_MIN +
          Math.floor(Math.random() * (ARC_SPARK_COUNT_MAX - ARC_SPARK_COUNT_MIN + 1));
        for (let k = 0; k < sparkCount; k++) {
          const speed = pickInterval(SPARK_SPEED_MIN, SPARK_SPEED_MAX);
          // Spark direction = normal + perpendicular spread.
          const spread = (Math.random() - 0.5) * 1.4;
          const tx = -dp.ny;
          const ty = dp.nx;
          const dx = dp.nx * Math.cos(spread) + tx * Math.sin(spread);
          const dy = dp.ny * Math.cos(spread) + ty * Math.sin(spread);
          fx.sparks.push({
            x: dp.x,
            y: dp.y,
            vx: dx * speed,
            vy: dy * speed,
            age: 0,
            lifetime: SPARK_LIFETIME_SEC,
          });
        }
      }
    }
  }
  // Tick arcs + sparks (independent of walls list — they may outlive
  // their wall by a few frames if the wall is removed, which is fine
  // because the arc is anchored on its origin damage point copy).
  for (let i = fx.arcs.length - 1; i >= 0; i--) {
    fx.arcs[i].age += dt;
    if (fx.arcs[i].age >= fx.arcs[i].lifetime) fx.arcs.splice(i, 1);
  }
  for (let i = fx.sparks.length - 1; i >= 0; i--) {
    const s = fx.sparks[i];
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += SPARK_GRAVITY * dt;
    if (s.age >= s.lifetime) fx.sparks.splice(i, 1);
  }
}

export function addWallImpact(fx: WallFx, x: number, y: number): void {
  fx.ripples.push({ x, y, age: 0 });
}

function paintWalls(ctx: CanvasRenderingContext2D, walls: Wall[]): void {
  // 1. Solid fill — one batched pass.
  ctx.save();
  ctx.fillStyle = WALL_FILL;
  ctx.shadowBlur = 0;
  for (const w of walls) {
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  ctx.restore();

  // 2. Inner diagonal hatching — adds texture without adding visual
  // weight. Clipped to each wall so the lines stop at the boundary.
  ctx.save();
  ctx.strokeStyle = WALL_STROKE;
  ctx.globalAlpha = HATCH_ALPHA;
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  for (const w of walls) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    const minD = w.x - w.h;
    const maxD = w.x + w.w;
    ctx.beginPath();
    for (let d = minD; d <= maxD; d += HATCH_SPACING_PX) {
      ctx.moveTo(d, w.y);
      ctx.lineTo(d + w.h, w.y + w.h);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // 3. Outer stroke — grouped by style so shadowBlur fires once per
  // group instead of per wall.
  const solidWalls: Wall[] = [];
  const dashableWalls: Wall[] = [];
  for (const w of walls) {
    if (w.dashable) dashableWalls.push(w);
    else solidWalls.push(w);
  }

  if (solidWalls.length > 0) {
    ctx.save();
    ctx.globalAlpha = WALL_STROKE_ALPHA;
    ctx.strokeStyle = WALL_STROKE;
    ctx.shadowColor = WALL_STROKE;
    ctx.shadowBlur = WALL_GLOW_BLUR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const w of solidWalls) {
      ctx.rect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (dashableWalls.length > 0) {
    ctx.save();
    ctx.strokeStyle = PALETTE.playerDash;
    ctx.shadowColor = PALETTE.playerDash;
    ctx.shadowBlur = DASHABLE_GLOW_BLUR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    for (const w of dashableWalls) {
      ctx.rect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 4. Corner brackets — sit on top of the outline. Brighter, thicker
  // strokes at each corner make the wall read as a "technical" panel
  // rather than a flat box. Skipped for dashable walls so their
  // signature dashed silhouette stays unambiguous.
  if (solidWalls.length > 0) {
    ctx.save();
    ctx.strokeStyle = WALL_STROKE;
    ctx.shadowColor = WALL_STROKE;
    ctx.shadowBlur = WALL_GLOW_BLUR;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = BRACKET_LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const w of solidWalls) {
      const len = Math.min(BRACKET_LEN_PX, Math.min(w.w, w.h) * 0.3);
      const x1 = w.x + BRACKET_INSET_PX;
      const y1 = w.y + BRACKET_INSET_PX;
      const x2 = w.x + w.w - BRACKET_INSET_PX;
      const y2 = w.y + w.h - BRACKET_INSET_PX;
      // top-left
      ctx.moveTo(x1, y1 + len); ctx.lineTo(x1, y1); ctx.lineTo(x1 + len, y1);
      // top-right
      ctx.moveTo(x2 - len, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + len);
      // bottom-right
      ctx.moveTo(x2, y2 - len); ctx.lineTo(x2, y2); ctx.lineTo(x2 - len, y2);
      // bottom-left
      ctx.moveTo(x1 + len, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - len);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function getWallLayer(walls: Wall[]): CachedLayer | null {
  if (walls.length === 0) return null;
  let maxX = 0;
  let maxY = 0;
  for (const w of walls) {
    const right = w.x + w.w + WALL_GLOW_BLUR;
    const bottom = w.y + w.h + WALL_GLOW_BLUR;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  const extentX = Math.ceil(maxX + WALL_GLOW_BLUR);
  const extentY = Math.ceil(maxY + WALL_GLOW_BLUR);

  const cached = layerCache.get(walls);
  if (
    cached &&
    cached.extentX === extentX &&
    cached.extentY === extentY &&
    cached.wallCount === walls.length
  ) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = extentX;
  canvas.height = extentY;
  const wctx = canvas.getContext("2d");
  if (!wctx) return null;
  paintWalls(wctx, walls);
  const layer: CachedLayer = {
    canvas,
    extentX,
    extentY,
    wallCount: walls.length,
  };
  layerCache.set(walls, layer);
  return layer;
}

export function drawWalls(
  ctx: CanvasRenderingContext2D,
  walls: Wall[],
): void {
  if (walls.length === 0) return;
  const layer = getWallLayer(walls);
  if (!layer) return;
  ctx.drawImage(layer.canvas, 0, 0);
}

// Animated overlay — drawn on top of the cached wall layer each frame.
// Marching dashes (perimeter flow), data pulses traversing a wall's
// perimeter, and bullet-impact ripples. Skipped per-wall via dashable
// or zero-area filters where appropriate.
export function drawWallOverlay(
  ctx: CanvasRenderingContext2D,
  fx: WallFx,
  walls: Wall[],
): void {
  if (walls.length === 0) return;
  const solidWalls: Wall[] = [];
  for (const w of walls) if (!w.dashable) solidWalls.push(w);

  // 1. Marching dashes inside the outline — subtle "energy flow".
  if (solidWalls.length > 0) {
    ctx.save();
    ctx.strokeStyle = WALL_STROKE;
    ctx.globalAlpha = MARCHING_DASH_ALPHA;
    ctx.lineWidth = 1;
    ctx.setLineDash([...MARCHING_DASH_PATTERN]);
    ctx.lineDashOffset = -fx.marchOffset;
    ctx.shadowColor = WALL_STROKE;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (const w of solidWalls) {
      const ix = w.x + MARCHING_DASH_INSET_PX + 0.5;
      const iy = w.y + MARCHING_DASH_INSET_PX + 0.5;
      const iw = w.w - MARCHING_DASH_INSET_PX * 2 - 1;
      const ih = w.h - MARCHING_DASH_INSET_PX * 2 - 1;
      if (iw <= 0 || ih <= 0) continue;
      ctx.rect(ix, iy, iw, ih);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 2. Perimeter data pulses — bright head dot tracking around the
  // wall's perimeter clockwise from the top-left.
  if (fx.pulses.length > 0) {
    ctx.save();
    ctx.fillStyle = PERIMETER_PULSE_COLOR;
    ctx.shadowColor = PERIMETER_PULSE_COLOR;
    ctx.shadowBlur = PERIMETER_PULSE_GLOW;
    for (const p of fx.pulses) {
      const w = walls[p.wallIndex];
      if (!w) continue;
      const pos = perimeterPoint(w, p.progress % p.perimeter);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PERIMETER_PULSE_HEAD_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 3. Impact ripples — small expanding ring at the bullet hit point.
  if (fx.ripples.length > 0) {
    ctx.save();
    ctx.strokeStyle = RIPPLE_COLOR;
    ctx.shadowColor = RIPPLE_COLOR;
    ctx.shadowBlur = RIPPLE_GLOW;
    for (const r of fx.ripples) {
      const u = r.age / RIPPLE_LIFETIME_SEC;
      const radius = RIPPLE_RADIUS_START + (RIPPLE_RADIUS_END - RIPPLE_RADIUS_START) * u;
      const lw = RIPPLE_LINE_WIDTH_START + (RIPPLE_LINE_WIDTH_END - RIPPLE_LINE_WIDTH_START) * u;
      ctx.globalAlpha = 1 - u;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // RIPPLE_FRAGMENT_COUNT reserved for future spark particles on
  // impact; the ring alone reads clearly so we ship without.
  void RIPPLE_FRAGMENT_COUNT;

  // 4. Wall damage — static cracks per damage point, drawn dark
  // against the wall fill so they read as fractures. Damage core is
  // a small dark blob with a faint cyan inner glow. Drawing live
  // each frame (not baked into the cache) so damage points generated
  // mid-room — e.g. after the tutorial dash wall push — show up
  // without invalidating the cache.
  for (const w of solidWalls) {
    const dps = fx.damage.get(w);
    if (!dps) continue;
    for (const dp of dps) {
      // Cracks — thin dark polyline strokes.
      ctx.save();
      ctx.strokeStyle = DAMAGE_CRACK_COLOR;
      ctx.lineWidth = DAMAGE_CRACK_LINE_WIDTH;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      for (const poly of dp.cracks) {
        ctx.moveTo(dp.x + poly[0].x, dp.y + poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(dp.x + poly[i].x, dp.y + poly[i].y);
        }
      }
      ctx.stroke();
      ctx.restore();
      // Core blob — dark hole.
      ctx.save();
      ctx.fillStyle = DAMAGE_CORE_COLOR;
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, DAMAGE_CORE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Inner glow — faint cyan at the center, hints at trapped
      // current.
      ctx.save();
      ctx.fillStyle = DAMAGE_GLOW_COLOR;
      ctx.shadowColor = ARC_COLOR;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, DAMAGE_GLOW_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 5. Live electric arcs — jagged cyan polylines fading over
  // ~100-180 ms, with shadow glow.
  if (fx.arcs.length > 0) {
    ctx.save();
    ctx.strokeStyle = ARC_COLOR;
    ctx.shadowColor = ARC_COLOR;
    ctx.shadowBlur = ARC_GLOW_BLUR;
    ctx.lineWidth = ARC_LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const arc of fx.arcs) {
      const u = arc.age / arc.lifetime;
      // Bright first half, fast fade in second half.
      const alpha = u < 0.35 ? 1 : Math.max(0, 1 - (u - 0.35) / 0.65);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(arc.segments[0].x, arc.segments[0].y);
      for (let i = 1; i < arc.segments.length; i++) {
        ctx.lineTo(arc.segments[i].x, arc.segments[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 6. Sparks — small bright dots flying off the damage points.
  if (fx.sparks.length > 0) {
    ctx.save();
    ctx.fillStyle = SPARK_COLOR;
    ctx.shadowColor = SPARK_COLOR;
    ctx.shadowBlur = 8;
    for (const s of fx.sparks) {
      const u = s.age / s.lifetime;
      ctx.globalAlpha = 1 - u;
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
    ctx.restore();
  }
}

function perimeterPoint(w: Wall, s: number): { x: number; y: number } {
  // Walk the rectangle perimeter starting at top-left going clockwise:
  // top edge (w.w) → right edge (w.h) → bottom edge (w.w) → left edge (w.h).
  const top = w.w;
  const right = top + w.h;
  const bottom = right + w.w;
  if (s < top) return { x: w.x + s, y: w.y };
  if (s < right) return { x: w.x + w.w, y: w.y + (s - top) };
  if (s < bottom) return { x: w.x + w.w - (s - right), y: w.y + w.h };
  return { x: w.x, y: w.y + w.h - (s - bottom) };
}

function pickInterval(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
