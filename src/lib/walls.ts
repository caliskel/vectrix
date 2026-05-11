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

// Wall damage — only a couple of spots per ROOM total (not per wall).
// Each spot is a small jagged "lightning crack" etched into the wall
// surface, tapered from a thicker base at the wall edge to a thin tip
// inward. Periodically spurts an electric arc + sparks outward. Reads
// as "the network is leaking what little power it has left through a
// handful of fractures."
const DAMAGE_MAX_PER_ROOM_MIN = 2;
const DAMAGE_MAX_PER_ROOM_MAX = 3;
const DAMAGE_MIN_WALL_AREA = 12000;     // only big walls are eligible
const DAMAGE_CRACK_COUNT_MIN = 1;
const DAMAGE_CRACK_COUNT_MAX = 1;
const DAMAGE_CRACK_SEG_MIN = 4;         // jagged lightning look
const DAMAGE_CRACK_SEG_MAX = 6;
const DAMAGE_CRACK_SEG_LEN_MIN = 4;
const DAMAGE_CRACK_SEG_LEN_MAX = 8;
const DAMAGE_CRACK_JITTER = 5;
const DAMAGE_CRACK_CORE_COLOR = "rgba(220, 232, 245, 0.65)";  // muted off-white
const DAMAGE_CRACK_HALO_COLOR = "rgba(165, 243, 252, 0.40)";  // soft cyan halo
const DAMAGE_CRACK_CORE_BASE_LW = 1.2;  // thicker near wall edge
const DAMAGE_CRACK_CORE_TIP_LW = 0.35;  // sharp tip inward
const DAMAGE_CRACK_HALO_BASE_LW = 3.0;
const DAMAGE_CRACK_HALO_TIP_LW = 0.7;
const DAMAGE_CRACK_GLOW_BLUR = 5;       // softer (was 9)

const ARC_INTERVAL_MIN = 2.0;
const ARC_INTERVAL_MAX = 5.0;
// "Splash" = N branches fanning out from the same origin.
const ARC_BRANCH_MIN = 3;
const ARC_BRANCH_MAX = 5;
const ARC_FAN_SPREAD_RAD = 0.85;        // ±~49° from the outward normal
const ARC_FAN_JITTER_RAD = 0.18;        // per-branch random tilt
const ARC_SEGMENTS_MIN = 3;
const ARC_SEGMENTS_MAX = 5;
const ARC_LENGTH_MIN = 28;              // each branch is short
const ARC_LENGTH_MAX = 60;
const ARC_BRANCH_LENGTH_FALLOFF = 0.4;  // edge branches this much shorter
const ARC_JITTER_PX = 14;               // perpendicular wobble per segment
const ARC_LIFETIME_MIN_SEC = 0.22;
const ARC_LIFETIME_MAX_SEC = 0.38;
const ARC_COLOR = "#a5f3fc";
const ARC_CORE_COLOR = "#ffffff";
const ARC_GLOW_BLUR = 18;
const ARC_HALO_BASE_LW = 2.6;
const ARC_HALO_TIP_LW = 0.5;
const ARC_CORE_BASE_LW = 1.1;
const ARC_CORE_TIP_LW = 0.25;
const ARC_SPARK_COUNT_MIN = 3;
const ARC_SPARK_COUNT_MAX = 5;
const SPARK_SPEED_MIN = 120;
const SPARK_SPEED_MAX = 320;
const SPARK_LIFETIME_SEC = 0.6;
const SPARK_GRAVITY = 280;
const SPARK_COLOR = "#a5f3fc";
const SPARK_SIZE_PX = 2.4;

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
  // World-space polylines fanning outward from the origin. Each
  // branch starts at origin and zigzags along its own direction in
  // the outward half-plane (+normal ±FAN_SPREAD). Reads as a
  // multi-stream splash rather than a single bolt.
  branches: Vec2[][];
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

export function createWallFx(walls?: Wall[]): WallFx {
  const fx: WallFx = {
    marchOffset: 0,
    pulses: [],
    ripples: [],
    pulseTimer: pickInterval(PERIMETER_PULSE_INTERVAL_MIN, PERIMETER_PULSE_INTERVAL_MAX) * 0.5,
    damage: new Map(),
    arcs: [],
    sparks: [],
  };
  if (walls && walls.length > 0) initWallDamage(fx, walls);
  return fx;
}

// Pick 2-3 random non-dashable, big-enough walls in the room and
// stamp one damage point on each. Runs once per WallFx (each room
// transition creates a fresh WallFx in rooms-game / tutorial-game),
// so the damage cast is stable for the duration of the room.
function initWallDamage(fx: WallFx, walls: Wall[]): void {
  const eligible: Wall[] = [];
  for (const w of walls) {
    if (w.dashable) continue;
    if (w.w * w.h < DAMAGE_MIN_WALL_AREA) continue;
    eligible.push(w);
  }
  if (eligible.length === 0) return;
  const target = Math.min(
    eligible.length,
    DAMAGE_MAX_PER_ROOM_MIN +
      Math.floor(Math.random() * (DAMAGE_MAX_PER_ROOM_MAX - DAMAGE_MAX_PER_ROOM_MIN + 1)),
  );
  // Fisher-Yates partial shuffle — first `target` slots become a
  // uniform random subset of the eligible walls.
  for (let i = 0; i < target; i++) {
    const j = i + Math.floor(Math.random() * (eligible.length - i));
    const tmp = eligible[i];
    eligible[i] = eligible[j];
    eligible[j] = tmp;
    fx.damage.set(eligible[i], [buildDamagePoint(eligible[i])]);
  }
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

function buildSplash(dp: DamagePoint): Vec2[][] {
  // Branches fan across an angular cone centered on the outward
  // normal. Center branches are longer; edge branches are shorter,
  // mimicking a water splash where the bulk of the volume goes
  // straight out and side spray is shorter.
  const branchCount =
    ARC_BRANCH_MIN +
    Math.floor(Math.random() * (ARC_BRANCH_MAX - ARC_BRANCH_MIN + 1));
  const branches: Vec2[][] = [];
  for (let b = 0; b < branchCount; b++) {
    // Position in fan: 0 = far CCW edge, 1 = far CW edge, 0.5 = center.
    const t = branchCount > 1 ? b / (branchCount - 1) : 0.5;
    const baseAngle = (t - 0.5) * 2 * ARC_FAN_SPREAD_RAD;
    const angle = baseAngle + (Math.random() - 0.5) * ARC_FAN_JITTER_RAD;
    // Branch direction = outward normal rotated by `angle`.
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const dirX = dp.nx * cosA - dp.ny * sinA;
    const dirY = dp.nx * sinA + dp.ny * cosA;
    // Tangent perpendicular to this branch's direction, used for the
    // per-segment perpendicular jitter.
    const btx = -dirY;
    const bty = dirX;
    // Length falls off toward the edges of the fan.
    const distFromCenter = Math.abs(t - 0.5) * 2; // 0..1
    const lengthMul = 1 - distFromCenter * ARC_BRANCH_LENGTH_FALLOFF;
    const totalLen = pickInterval(ARC_LENGTH_MIN, ARC_LENGTH_MAX) * lengthMul;
    const segs =
      ARC_SEGMENTS_MIN +
      Math.floor(Math.random() * (ARC_SEGMENTS_MAX - ARC_SEGMENTS_MIN + 1));
    const segLen = totalLen / segs;
    const pts: Vec2[] = [{ x: dp.x, y: dp.y }];
    let cx = dp.x;
    let cy = dp.y;
    for (let s = 0; s < segs; s++) {
      cx += dirX * segLen;
      cy += dirY * segLen;
      const jitter = (Math.random() - 0.5) * ARC_JITTER_PX;
      cx += btx * jitter;
      cy += bty * jitter;
      pts.push({ x: cx, y: cy });
    }
    branches.push(pts);
  }
  return branches;
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

  // Wall damage — tick each existing spot's arc timer. Damage points
  // are picked once at WallFx creation (initWallDamage) so the set is
  // stable for the room; we just walk what's there. When a timer
  // trips, spawn an electric arc + 1-2 sparks + a flash ring.
  for (const w of walls) {
    const pts = fx.damage.get(w);
    if (!pts) continue;
    for (const dp of pts) {
      dp.nextArcAt -= dt;
      if (dp.nextArcAt <= 0) {
        dp.nextArcAt = pickInterval(ARC_INTERVAL_MIN, ARC_INTERVAL_MAX);
        fx.arcs.push({
          origin: dp,
          branches: buildSplash(dp),
          age: 0,
          lifetime: pickInterval(ARC_LIFETIME_MIN_SEC, ARC_LIFETIME_MAX_SEC),
        });
        // Flash ring at the crack base — reuses the impact-ripple
        // system so the surge reads as a real "punch" without a new
        // entity type.
        fx.ripples.push({ x: dp.x, y: dp.y, age: 0 });
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

  // 4. Wall damage — a small jagged "lightning crack" per damage
  // point, tapered from a thick base at the wall edge to a sharp
  // thin tip inward. Two passes (halo + core), both per-segment so
  // each segment can have its own lineWidth. Clipped to the union
  // of wall rects so cracks can't bleed outside the wall surface.
  // Drawn live each frame (not baked into the cache) so damage
  // points generated mid-room would show up without invalidating
  // the cache — though with the current bulk-init approach they're
  // stable for the room's lifetime.
  let hasDamage = false;
  for (const w of solidWalls) {
    if (fx.damage.has(w)) { hasDamage = true; break; }
  }
  if (hasDamage) {
    ctx.save();
    // Clip to union of walls so any per-segment overshoot (e.g. round
    // cap at the base sitting on the wall edge) gets trimmed.
    ctx.beginPath();
    for (const w of solidWalls) ctx.rect(w.x, w.y, w.w, w.h);
    ctx.clip();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Halo pass — wide cyan, with glow blur.
    ctx.strokeStyle = DAMAGE_CRACK_HALO_COLOR;
    ctx.shadowColor = ARC_COLOR;
    ctx.shadowBlur = DAMAGE_CRACK_GLOW_BLUR;
    drawTaperedCracks(
      ctx,
      solidWalls,
      fx.damage,
      DAMAGE_CRACK_HALO_BASE_LW,
      DAMAGE_CRACK_HALO_TIP_LW,
    );
    // Core pass — thin bright white core on top.
    ctx.strokeStyle = DAMAGE_CRACK_CORE_COLOR;
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 3;
    drawTaperedCracks(
      ctx,
      solidWalls,
      fx.damage,
      DAMAGE_CRACK_CORE_BASE_LW,
      DAMAGE_CRACK_CORE_TIP_LW,
    );
    ctx.restore();
  }

  // 5. Live splash arcs — multi-branch fans spurting outward from
  // damage points, fading over ~220-380 ms. Two passes (halo + core)
  // both per-segment tapered so each branch tapers thin at the tip.
  if (fx.arcs.length > 0) {
    // Halo pass.
    ctx.save();
    ctx.strokeStyle = ARC_COLOR;
    ctx.shadowColor = ARC_COLOR;
    ctx.shadowBlur = ARC_GLOW_BLUR;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const arc of fx.arcs) {
      const u = arc.age / arc.lifetime;
      const alpha = u < 0.35 ? 1 : Math.max(0, 1 - (u - 0.35) / 0.65);
      ctx.globalAlpha = alpha;
      for (const branch of arc.branches) {
        strokeTaperedPolyline(ctx, branch, ARC_HALO_BASE_LW, ARC_HALO_TIP_LW);
      }
    }
    ctx.restore();
    // White hot core pass — slightly longer-lived for an afterimage.
    ctx.save();
    ctx.strokeStyle = ARC_CORE_COLOR;
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const arc of fx.arcs) {
      const u = arc.age / arc.lifetime;
      const alpha = u < 0.45 ? 1 : Math.max(0, 1 - (u - 0.45) / 0.55);
      ctx.globalAlpha = alpha;
      for (const branch of arc.branches) {
        strokeTaperedPolyline(ctx, branch, ARC_CORE_BASE_LW, ARC_CORE_TIP_LW);
      }
    }
    ctx.restore();
  }

  // 6. Sparks — small bright dots flying off the damage points.
  if (fx.sparks.length > 0) {
    ctx.save();
    ctx.fillStyle = SPARK_COLOR;
    ctx.shadowColor = SPARK_COLOR;
    ctx.shadowBlur = 10;
    const half = SPARK_SIZE_PX * 0.5;
    for (const s of fx.sparks) {
      const u = s.age / s.lifetime;
      ctx.globalAlpha = 1 - u;
      ctx.fillRect(s.x - half, s.y - half, SPARK_SIZE_PX, SPARK_SIZE_PX);
    }
    ctx.restore();
  }
}

// Per-segment stroke of a single polyline with a linear taper from
// baseLw at segment 0 to tipLw at the last segment. Caller sets
// strokeStyle / shadow / lineCap on ctx before invoking.
function strokeTaperedPolyline(
  ctx: CanvasRenderingContext2D,
  poly: Vec2[],
  baseLw: number,
  tipLw: number,
): void {
  const segments = poly.length - 1;
  if (segments <= 0) return;
  for (let i = 1; i <= segments; i++) {
    const u = (i - 0.5) / segments;
    ctx.lineWidth = baseLw + (tipLw - baseLw) * u;
    ctx.beginPath();
    ctx.moveTo(poly[i - 1].x, poly[i - 1].y);
    ctx.lineTo(poly[i].x, poly[i].y);
    ctx.stroke();
  }
}

// Cracks variant — same tapering, but polylines are stored in
// damage-point-local coordinates so we apply the dp offset inline.
function drawTaperedCracks(
  ctx: CanvasRenderingContext2D,
  walls: Wall[],
  damage: Map<Wall, DamagePoint[]>,
  baseLw: number,
  tipLw: number,
): void {
  for (const w of walls) {
    const dps = damage.get(w);
    if (!dps) continue;
    for (const dp of dps) {
      for (const poly of dp.cracks) {
        const segments = poly.length - 1;
        if (segments <= 0) continue;
        for (let i = 1; i <= segments; i++) {
          const u = (i - 0.5) / segments;
          ctx.lineWidth = baseLw + (tipLw - baseLw) * u;
          ctx.beginPath();
          ctx.moveTo(dp.x + poly[i - 1].x, dp.y + poly[i - 1].y);
          ctx.lineTo(dp.x + poly[i].x, dp.y + poly[i].y);
          ctx.stroke();
        }
      }
    }
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
