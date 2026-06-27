// Arena — a standalone, single-screen recreation of the reference
// scene: an octagonal red-neon vault floating in a dark void, dotted
// with cover blocks, spiky mines, drifting purple crystal hunters, and
// scattered projectiles. The ONLY thing lifted from the rest of the
// codebase is the hero and its animations (lib/player + the config /
// keybinds / neon / sprite modules it pulls in). Everything else — the
// walls, floor, decor, enemies, bullets — is built fresh here to match
// the reference image.
//
// No camera: the whole arena letterboxes onto the viewport so the
// player sees the room exactly like the reference snapshot. Fully
// playable — WASD to move, Space to dash — so all the hero's
// animations (lean, bob, dash teardrop + ghosts, pupil tracking,
// dilation, flinch, blink, breathing, smash) light up against a live
// threat field.

import {
  DASH_COOLDOWN_MS,
  DASH_DISTANCE,
  DASH_DURATION_MS,
  DASH_IFRAMES_MS,
  PARTICLE_BASE_SPEED_MAX,
  PARTICLE_BASE_SPEED_MIN,
  PARTICLE_DASH_SPAWN_INTERVAL_MS,
  PARTICLE_DASH_SPEED_MULTIPLIER,
  PARTICLE_DRAG,
  PARTICLE_LATERAL_JITTER,
  PARTICLE_LIFETIME_MS,
  PARTICLE_SIZE_MAX_FACTOR,
  PARTICLE_SIZE_MIN_FACTOR,
  PARTICLE_SPAWN_INTERVAL_MS,
  PARTICLE_TRAIL_MIN_SPEED,
  PLAYER_ACCEL_FACTOR,
  PLAYER_FRICTION,
  PLAYER_MAX_SPEED,
  PLAYER_SIZE,
  PLAYER_WALK_FACTOR,
} from "../lib/config";
import {
  consumeAction,
  isActionPressed,
  isAnyBoundCode,
  loadKeybinds,
  type KeybindProfile,
} from "../lib/keybinds";
import {
  createPlayer,
  drawPlayerEye,
  findNearestThreat,
  loadPlayerProfile,
  triggerPlayerSmash,
  updateEye,
  type Player,
  type PlayerProfile,
} from "../lib/player";

// ---------------------------------------------------------------------------
// Palette — warm-red vault interior, cold purple void outside, matching
// the reference. Kept local so this scene is self-contained.
// ---------------------------------------------------------------------------
const C = {
  void: "#080510",
  wallGlow: "#ff3b20",
  wallCore: "#ff7838",
  wallHot: "#ffd9a8",
  wallBand: "#2c060e",
} as const;

const FLOOR_CENTER = "#a3274d";
const FLOOR_MID = "#5e152f";
const FLOOR_EDGE = "#220a18";
const HEX_LINE = "rgba(255, 120, 90, 0.05)";

const BLOCK_FACE = "#240810";
const BLOCK_TOP = "#3c0e18";
const BLOCK_EDGE = "#ff5a2a";
const BLOCK_EDGE_GLOW = "#ff3b20";

const MINE_SPIKE = "#ff3a3a";
const MINE_CORE = "#160308";
const MINE_DOT = "#ff6a4a";

const CRYSTAL = "#c04dff";
const CRYSTAL_HOT = "#ecc4ff";
const CRYSTAL_GLOW = "#b14cff";

const BULLET_PURPLE = "#c060ff";
const SPARK_RED = "#ff5a38";

const VOID_PURPLE = "#b14cff";
const VOID_INDIGO = "#7a4dff";
const VOID_RED = "#ff3b4a";

// ---------------------------------------------------------------------------
// Logical arena — a square that letterboxes onto the viewport. The
// reference image is square, so this stays 1:1.
// ---------------------------------------------------------------------------
const W = 1242;
const CX = W / 2;
const CY = W / 2;
const WALL_BAND = 18; // half-thickness of the neon band, for clamp inset

type V = { x: number; y: number };

// Octagon vertices — the square [m..W-m] with corners cut by `cut`.
function buildOctagon(m: number, cut: number): V[] {
  const L = m;
  const R = W - m;
  const T = m;
  const B = W - m;
  return [
    { x: L + cut, y: T },
    { x: R - cut, y: T },
    { x: R, y: T + cut },
    { x: R, y: B - cut },
    { x: R - cut, y: B },
    { x: L + cut, y: B },
    { x: L, y: B - cut },
    { x: L, y: T + cut },
  ];
}

const OCT = buildOctagon(40, 236);

// Scale a polygon about the arena centre — used to draw the inner /
// outer neon piping of the wall band.
function scaleAbout(poly: V[], s: number): V[] {
  return poly.map((p) => ({ x: CX + (p.x - CX) * s, y: CY + (p.y - CY) * s }));
}

function polyPath(ctx: CanvasRenderingContext2D, poly: V[]): void {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

// Inward-normal half-planes for the octagon, pre-computed for the
// player clamp. `n` points toward the centroid; a point is inside edge
// i when dot(n_i, p - a_i) >= 0.
type Edge = { ax: number; ay: number; nx: number; ny: number };
function buildEdges(poly: V[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    // two candidate normals; pick the one pointing toward the centre
    let nx = -ey;
    let ny = ex;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const toC = (CX - a.x) * nx + (CY - a.y) * ny;
    if (toC < 0) {
      nx = -nx;
      ny = -ny;
    }
    edges.push({ ax: a.x, ay: a.y, nx, ny });
  }
  return edges;
}
const OCT_EDGES = buildEdges(OCT);

// ---------------------------------------------------------------------------
// Static scene content — positions roughly mirror the reference image
// (normalized 0..1 of the arena, multiplied by W).
// ---------------------------------------------------------------------------
type Rect = { x: number; y: number; w: number; h: number };

// Cover blocks. L-shapes are composed of two overlapping rects; each
// rect is an independent AABB for collision and a beveled neon slab for
// drawing. Numbers eyeballed off the reference layout.
function n(v: number): number {
  return v * W;
}
const BLOCKS: Rect[] = [
  // top-left L
  { x: n(0.245), y: n(0.25), w: n(0.085), h: n(0.03) },
  { x: n(0.245), y: n(0.25), w: n(0.03), h: n(0.085) },
  // top-centre L
  { x: n(0.47), y: n(0.255), w: n(0.075), h: n(0.028) },
  { x: n(0.515), y: n(0.255), w: n(0.03), h: n(0.08) },
  // top-right slab
  { x: n(0.64), y: n(0.255), w: n(0.105), h: n(0.05) },
  // left rect
  { x: n(0.155), y: n(0.5), w: n(0.075), h: n(0.04) },
  // left double (rect + stub)
  { x: n(0.255), y: n(0.53), w: n(0.03), h: n(0.075) },
  { x: n(0.255), y: n(0.53), w: n(0.06), h: n(0.028) },
  // right L
  { x: n(0.78), y: n(0.46), w: n(0.085), h: n(0.03) },
  { x: n(0.835), y: n(0.46), w: n(0.03), h: n(0.085) },
  // bottom-centre L
  { x: n(0.45), y: n(0.72), w: n(0.085), h: n(0.03) },
  { x: n(0.45), y: n(0.72), w: n(0.03), h: n(0.075) },
  // bottom-right L
  { x: n(0.66), y: n(0.77), w: n(0.085), h: n(0.03) },
  { x: n(0.715), y: n(0.745), w: n(0.03), h: n(0.085) },
];

type Mine = { x: number; y: number; r: number; spin: number; phase: number };
const MINES: Mine[] = [
  { x: n(0.6), y: n(0.16), r: n(0.035), spin: 0.25, phase: 0 },
  { x: n(0.2), y: n(0.73), r: n(0.04), spin: -0.18, phase: 1.6 },
  { x: n(0.77), y: n(0.71), r: n(0.035), spin: 0.2, phase: 3.1 },
];

type Crystal = {
  x: number;
  y: number;
  r: number;
  facing: number; // radians, slowly rotates
  spin: number;
  bob: number; // phase
  fireTimer: number;
  fireEvery: number;
  isDead: () => boolean;
};
function makeCrystal(nx: number, ny: number, r: number, facing: number): Crystal {
  return {
    x: n(nx),
    y: n(ny),
    r: n(r),
    facing,
    spin: (Math.random() * 2 - 1) * 0.3,
    bob: Math.random() * Math.PI * 2,
    fireTimer: Math.random() * 2,
    fireEvery: 2.0 + Math.random() * 1.8,
    isDead: () => false,
  };
}
const CRYSTALS: Crystal[] = [
  makeCrystal(0.61, 0.34, 0.03, -2.4),
  makeCrystal(0.27, 0.575, 0.028, 0.3),
  makeCrystal(0.375, 0.66, 0.026, -1.2),
  makeCrystal(0.63, 0.6, 0.03, 2.6),
  makeCrystal(0.82, 0.83, 0.03, -2.0),
  makeCrystal(0.44, 0.86, 0.028, -1.6),
];

// Central octagon reactor structure.
const REACTOR = { x: n(0.555), y: n(0.5), r: n(0.072) };

// ---------------------------------------------------------------------------
// Void decor (outside the walls) — generated once, drawn with a slow
// flicker. Cold purples + a red wireframe web, matching the reference's
// alien dead-tech margins.
// ---------------------------------------------------------------------------
type HexCluster = { cx: number; cy: number; nodes: V[]; r: number; color: string };
type BarBlock = { x: number; y: number; bars: number[]; color: string };
type Web = { pts: V[]; color: string };

function buildHexCluster(cx: number, cy: number, count: number, color: string): HexCluster {
  const r = 26;
  const nodes: V[] = [{ x: cx, y: cy }];
  for (let i = 1; i < count; i++) {
    const base = nodes[Math.floor(Math.random() * nodes.length)];
    const a = Math.floor(Math.random() * 6) * (Math.PI / 3);
    nodes.push({
      x: base.x + Math.cos(a) * r * 1.7,
      y: base.y + Math.sin(a) * r * 1.7,
    });
  }
  return { cx, cy, nodes, r, color };
}
function buildBars(x: number, y: number, count: number, color: string): BarBlock {
  const bars: number[] = [];
  for (let i = 0; i < count; i++) bars.push(0.3 + Math.random() * 0.7);
  return { x, y, bars, color };
}
function buildWeb(cx: number, cy: number, count: number, color: string): Web {
  const pts: V[] = [];
  for (let i = 0; i < count; i++) {
    pts.push({ x: cx + (Math.random() * 2 - 1) * 150, y: cy + (Math.random() * 2 - 1) * 150 });
  }
  return { pts, color };
}

const HEX_CLUSTERS: HexCluster[] = [
  buildHexCluster(n(0.1), n(0.12), 6, VOID_PURPLE),
  buildHexCluster(n(0.07), n(0.27), 4, VOID_INDIGO),
  buildHexCluster(n(0.12), n(0.9), 5, VOID_PURPLE),
  buildHexCluster(n(0.88), n(0.9), 5, VOID_PURPLE),
  buildHexCluster(n(0.93), n(0.6), 4, VOID_INDIGO),
];
const BARS: BarBlock[] = [
  buildBars(n(0.05), n(0.82), 7, VOID_PURPLE),
  buildBars(n(0.86), n(0.9), 8, VOID_PURPLE),
  buildBars(n(0.9), n(0.07), 6, VOID_INDIGO),
];
const WEBS: Web[] = [
  buildWeb(n(0.9), n(0.15), 7, VOID_RED),
  buildWeb(n(0.12), n(0.06), 6, VOID_PURPLE),
];

// ---------------------------------------------------------------------------
// Dynamic state
// ---------------------------------------------------------------------------
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  age: number;
  life: number;
  drag: number;
  glow: number;
};
type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  trail: boolean; // purple darts get a long trail, sparks a short one
  flinchTriggered?: boolean;
};

const player: Player = createPlayer();
let profile: PlayerProfile = loadPlayerProfile();
let keybinds: KeybindProfile = loadKeybinds();
const keys = new Set<string>();
const particles: Particle[] = [];
const bullets: Bullet[] = [];

let particleTimer = 0;
let sparkTimer = 0;
let t = 0; // global animation clock (seconds)

// Baked floor (gradient + hex texture + vignette + void fill). Built
// once at the logical resolution and blitted every frame.
let floorCanvas: HTMLCanvasElement | null = null;

function buildFloor(): void {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = W;
  const g = c.getContext("2d");
  if (!g) return;

  // void background
  g.fillStyle = C.void;
  g.fillRect(0, 0, W, W);

  // floor — clip to octagon
  g.save();
  polyPath(g, OCT);
  g.clip();

  const grad = g.createRadialGradient(CX, CY, 40, CX, CY, W * 0.62);
  grad.addColorStop(0, FLOOR_CENTER);
  grad.addColorStop(0.45, FLOOR_MID);
  grad.addColorStop(1, FLOOR_EDGE);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, W);

  // hex texture
  g.strokeStyle = HEX_LINE;
  g.lineWidth = 1.5;
  const hr = 34;
  const dx = hr * 1.5;
  const dy = hr * Math.sin(Math.PI / 3) * 2;
  for (let row = -1, yy = 0; yy < W + dy; row++, yy = row * dy) {
    for (let col = -1, xx = 0; xx < W + dx; col++, xx = col * dx) {
      const oy = col % 2 === 0 ? 0 : dy / 2;
      hexPath(g, xx, yy + oy, hr);
      g.stroke();
    }
  }

  // inner edge shadow vignette so the floor sinks under the walls
  const vig = g.createRadialGradient(CX, CY, W * 0.3, CX, CY, W * 0.6);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = vig;
  g.fillRect(0, 0, W, W);
  g.restore();

  floorCanvas = c;
}

function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

// ---------------------------------------------------------------------------
// Input + sizing
// ---------------------------------------------------------------------------
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let viewW = 0;
let viewH = 0;
let dpr = 1;
// letterbox transform
let scale = 1;
let offX = 0;
let offY = 0;

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  canvas.style.width = `${viewW}px`;
  canvas.style.height = `${viewH}px`;
  scale = Math.min(viewW / W, viewH / W);
  offX = (viewW - W * scale) / 2;
  offY = (viewH - W * scale) / 2;
}

function inputDir(): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (isActionPressed("moveLeft", keys, keybinds)) x -= 1;
  if (isActionPressed("moveRight", keys, keybinds)) x += 1;
  if (isActionPressed("moveUp", keys, keybinds)) y -= 1;
  if (isActionPressed("moveDown", keys, keybinds)) y += 1;
  const len = Math.hypot(x, y);
  if (len > 0) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

function dashSpeedNow(): number {
  const dur = DASH_DURATION_MS / 1000;
  return dur > 0 ? DASH_DISTANCE / dur : 0;
}

function tryStartDash(): void {
  if (player.dashTime > 0 || player.cooldown > 0) return;
  const input = inputDir();
  let dx: number;
  let dy: number;
  if (input.x !== 0 || input.y !== 0) {
    dx = input.x;
    dy = input.y;
  } else {
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 1) {
      dx = player.vx / speed;
      dy = player.vy / speed;
    } else {
      dx = player.facingX;
      dy = player.facingY;
    }
  }
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  player.dashDirX = dx;
  player.dashDirY = dy;
  player.dashTime = DASH_DURATION_MS / 1000;
  player.dashIframeTime = DASH_IFRAMES_MS / 1000;
  const v = dashSpeedNow();
  player.vx = dx * v;
  player.vy = dy * v;
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------
// Clamp the player inside the octagon (inset by wall + body). Captures
// the deepest-penetrating edge normal for the smash effect.
function clampToArena(preVx: number, preVy: number): void {
  const inset = WALL_BAND + PLAYER_SIZE / 2;
  let pushNx = 0;
  let pushNy = 0;
  let maxPen = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const e of OCT_EDGES) {
      const d = (player.x - e.ax) * e.nx + (player.y - e.ay) * e.ny - inset;
      if (d < 0) {
        player.x -= e.nx * d;
        player.y -= e.ny * d;
        if (-d > maxPen) {
          maxPen = -d;
          pushNx = e.nx;
          pushNy = e.ny;
        }
      }
    }
  }
  if (maxPen > 0) {
    // inward velocity component before we zero it = impact speed
    const inward = -(preVx * pushNx + preVy * pushNy);
    // kill the velocity component heading into the wall
    const vn = player.vx * pushNx + player.vy * pushNy;
    if (vn < 0) {
      player.vx -= pushNx * vn;
      player.vy -= pushNy * vn;
    }
    if (inward > 0) triggerPlayerSmash(player, pushNx, pushNy, inward);
  }
}

// Resolve the player out of each cover-block AABB along the smallest
// penetration axis (mirrors lib/walls.ts resolveEntityWallCollisions).
function resolveBlocks(preVx: number, preVy: number): void {
  const half = PLAYER_SIZE / 2;
  for (const r of BLOCKS) {
    const minX = r.x - half;
    const minY = r.y - half;
    const maxX = r.x + r.w + half;
    const maxY = r.y + r.h + half;
    if (player.x <= minX || player.x >= maxX || player.y <= minY || player.y >= maxY) {
      continue;
    }
    const penL = player.x - minX;
    const penR = maxX - player.x;
    const penU = player.y - minY;
    const penD = maxY - player.y;
    const m = Math.min(penL, penR, penU, penD);
    let nx = 0;
    let ny = 0;
    if (m === penL) {
      player.x = minX;
      nx = -1;
    } else if (m === penR) {
      player.x = maxX;
      nx = 1;
    } else if (m === penU) {
      player.y = minY;
      ny = -1;
    } else {
      player.y = maxY;
      ny = 1;
    }
    const inward = -(preVx * nx + preVy * ny);
    const vn = player.vx * nx + player.vy * ny;
    if (vn < 0) {
      player.vx -= nx * vn;
      player.vy -= ny * vn;
    }
    if (inward > 0) triggerPlayerSmash(player, nx, ny, inward);
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update(dt: number): void {
  t += dt;

  // dash trigger
  if (isActionPressed("dash", keys, keybinds)) {
    tryStartDash();
    consumeAction("dash", keys, keybinds);
  }

  // movement (identical model to the rest of the game)
  if (player.dashTime > 0) {
    player.dashTime -= dt;
    const v = dashSpeedNow();
    player.vx = player.dashDirX * v;
    player.vy = player.dashDirY * v;
    if (player.dashTime <= 0) {
      player.dashTime = 0;
      player.cooldown = DASH_COOLDOWN_MS / 1000;
      player.vx *= 0.35;
      player.vy *= 0.35;
    }
  } else {
    const cap = isActionPressed("walk", keys, keybinds)
      ? PLAYER_MAX_SPEED * PLAYER_WALK_FACTOR
      : PLAYER_MAX_SPEED;
    const input = inputDir();
    if (input.x !== 0 || input.y !== 0) {
      player.facingX = input.x;
      player.facingY = input.y;
    }
    const accel = PLAYER_MAX_SPEED * PLAYER_ACCEL_FACTOR;
    player.vx += input.x * accel * dt;
    player.vy += input.y * accel * dt;
    const damp = Math.exp(-PLAYER_FRICTION * dt);
    player.vx *= damp;
    player.vy *= damp;
    const sp = Math.hypot(player.vx, player.vy);
    if (sp > cap) {
      const k = cap / sp;
      player.vx *= k;
      player.vy *= k;
    }
  }

  if (player.dashIframeTime > 0)
    player.dashIframeTime = Math.max(0, player.dashIframeTime - dt);
  if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt);

  const preVx = player.vx;
  const preVy = player.vy;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  resolveBlocks(preVx, preVy);
  clampToArena(preVx, preVy);

  // trail particles
  {
    const speed = Math.hypot(player.vx, player.vy);
    const isDash = player.dashTime > 0;
    if (!isDash && speed < PARTICLE_TRAIL_MIN_SPEED) {
      particleTimer = 0;
    } else {
      const interval =
        (isDash ? PARTICLE_DASH_SPAWN_INTERVAL_MS : PARTICLE_SPAWN_INTERVAL_MS) /
        1000;
      particleTimer += dt;
      while (particleTimer >= interval) {
        particleTimer -= interval;
        spawnTrail(speed, isDash);
      }
    }
  }

  // age particles
  for (const p of particles) {
    p.age += dt;
    const d = Math.pow(p.drag, dt * 60);
    p.vx *= d;
    p.vy *= d;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].age >= particles[i].life) particles.splice(i, 1);
  }

  // crystals drift + fire
  for (const cr of CRYSTALS) {
    cr.facing += cr.spin * dt;
    cr.bob += dt;
    cr.fireTimer -= dt;
    if (cr.fireTimer <= 0) {
      cr.fireTimer = cr.fireEvery;
      const a = cr.facing + (Math.random() * 2 - 1) * 0.25;
      bullets.push({
        x: cr.x,
        y: cr.y,
        vx: Math.cos(a) * 230,
        vy: Math.sin(a) * 230,
        color: BULLET_PURPLE,
        size: 7,
        trail: true,
      });
    }
  }

  // ambient red sparks streaking across the floor
  sparkTimer -= dt;
  if (sparkTimer <= 0) {
    sparkTimer = 0.35 + Math.random() * 0.4;
    const a = Math.random() * Math.PI * 2;
    const rad = W * 0.46;
    bullets.push({
      x: CX + Math.cos(a) * rad,
      y: CY + Math.sin(a) * rad,
      vx: -Math.cos(a) * (180 + Math.random() * 120) + (Math.random() * 2 - 1) * 60,
      vy: -Math.sin(a) * (180 + Math.random() * 120) + (Math.random() * 2 - 1) * 60,
      color: SPARK_RED,
      size: 5,
      trail: false,
    });
  }

  // move bullets, cull outside octagon
  for (const b of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (!pointInOctagon(b.x, b.y, 60)) bullets.splice(i, 1);
  }

  // eye / animations — bullets drive dilation + flinch, crystals are the
  // enemy threats the pupil dilates against.
  const threat = findNearestThreat(player.x, player.y, bullets, CRYSTALS);
  updateEye(player, dt, {
    threat,
    size: PLAYER_SIZE,
    dashDurationSec: DASH_DURATION_MS / 1000,
    bullets,
    enemies: CRYSTALS,
    mode: "rooms",
  });
}

function pointInOctagon(x: number, y: number, slack: number): boolean {
  for (const e of OCT_EDGES) {
    const d = (x - e.ax) * e.nx + (y - e.ay) * e.ny;
    if (d < -slack) return false;
  }
  return true;
}

function spawnTrail(speed: number, isDash: boolean): void {
  const dirX = speed > 0 ? -player.vx / speed : 0;
  const dirY = speed > 0 ? -player.vy / speed : 0;
  const perpX = -dirY;
  const perpY = dirX;
  const color =
    player.dashTime > 0 || player.dashIframeTime > 0
      ? profile.dashParticles
      : profile.outerRing;
  const speedMul = isDash ? PARTICLE_DASH_SPEED_MULTIPLIER : 1;
  const baseMin = PARTICLE_BASE_SPEED_MIN * speedMul;
  const baseRange = (PARTICLE_BASE_SPEED_MAX - PARTICLE_BASE_SPEED_MIN) * speedMul;
  const lateralMag = PARTICLE_LATERAL_JITTER * speedMul;
  const count = isDash ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 2);
  const life = PARTICLE_LIFETIME_MS / 1000;
  for (let i = 0; i < count; i++) {
    const back = baseMin + Math.random() * baseRange;
    const lateral = (Math.random() * 2 - 1) * lateralMag;
    const upDrift = -(20 + Math.random() * 30);
    const sizeFactor =
      PARTICLE_SIZE_MIN_FACTOR +
      Math.random() * (PARTICLE_SIZE_MAX_FACTOR - PARTICLE_SIZE_MIN_FACTOR);
    particles.push({
      x: player.x,
      y: player.y,
      vx: dirX * back + perpX * lateral,
      vy: dirY * back + perpY * lateral + upDrift,
      size: PLAYER_SIZE * sizeFactor,
      color,
      age: 0,
      life,
      drag: PARTICLE_DRAG,
      glow: isDash ? 12 : 6,
    });
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render(): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.fillStyle = C.void;
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(scale, scale);

  if (floorCanvas) ctx.drawImage(floorCanvas, 0, 0);

  drawVoidDecor();
  drawWalls();
  drawReactor();
  for (const r of BLOCKS) drawBlock(r);
  for (const m of MINES) drawMine(m);
  drawBullets();
  for (const cr of CRYSTALS) drawCrystal(cr);
  drawParticles();
  drawPlayerEye(ctx, player, PLAYER_SIZE, {
    ringColor: profile.outerRing,
    pupilColor: profile.pupil,
    ghostColor: profile.outerRing,
    dashDurationSec: DASH_DURATION_MS / 1000,
    dashCooldownSec: DASH_COOLDOWN_MS / 1000,
    profile,
  });

  ctx.restore();
}

function drawWalls(): void {
  ctx.save();
  ctx.lineJoin = "round";
  // dark structural band
  polyPath(ctx, OCT);
  ctx.strokeStyle = C.wallBand;
  ctx.lineWidth = 34;
  ctx.stroke();

  const pulse = 0.85 + 0.15 * Math.sin(t * 2);
  // outer + inner bright piping with bloom
  ctx.shadowColor = C.wallGlow;
  for (const s of [1.024, 0.976]) {
    ctx.shadowBlur = 34 * pulse;
    ctx.strokeStyle = C.wallCore;
    ctx.lineWidth = 6;
    polyPath(ctx, scaleAbout(OCT, s));
    ctx.stroke();
    ctx.shadowBlur = 16 * pulse;
    ctx.stroke();
  }
  // hot centre filament
  ctx.shadowBlur = 0;
  ctx.strokeStyle = C.wallHot;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.7;
  polyPath(ctx, scaleAbout(OCT, 1.0));
  ctx.stroke();
  ctx.restore();
}

function drawReactor(): void {
  const { x, y, r } = REACTOR;
  ctx.save();
  ctx.translate(x, y);
  // dark octagon platform
  ctx.rotate(Math.PI / 8);
  for (let ring = 0; ring < 3; ring++) {
    const rr = r * (1 - ring * 0.26);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = ring === 0 ? "#1a0610" : "#240a16";
    ctx.fill();
    ctx.strokeStyle = BLOCK_EDGE;
    ctx.lineWidth = 2;
    ctx.shadowColor = BLOCK_EDGE_GLOW;
    ctx.shadowBlur = 10;
    ctx.stroke();
  }
  ctx.rotate(-Math.PI / 8);
  // glowing core
  const corePulse = 0.7 + 0.3 * Math.sin(t * 3);
  ctx.shadowColor = C.wallCore;
  ctx.shadowBlur = 24 * corePulse;
  ctx.fillStyle = C.wallCore;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff2e0";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBlock(r: Rect): void {
  ctx.save();
  // drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(r.x + 5, r.y + 7, r.w, r.h);
  // face
  ctx.fillStyle = BLOCK_FACE;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // top bevel
  ctx.fillStyle = BLOCK_TOP;
  ctx.fillRect(r.x, r.y, r.w, Math.min(8, r.h * 0.3));
  // neon edge
  ctx.strokeStyle = BLOCK_EDGE;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = BLOCK_EDGE_GLOW;
  ctx.shadowBlur = 12;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.restore();
}

function drawMine(m: Mine): void {
  const pulse = 0.7 + 0.3 * Math.sin(t * 2.4 + m.phase);
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(t * m.spin);
  // spikes
  ctx.strokeStyle = MINE_SPIKE;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.shadowColor = MINE_SPIKE;
  ctx.shadowBlur = 12 * pulse;
  const spikes = 16;
  for (let i = 0; i < spikes; i++) {
    const a = (Math.PI * 2 * i) / spikes;
    const inner = m.r * 0.5;
    const outer = m.r * (1.0 + (i % 2 === 0 ? 0.12 : 0));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
  }
  // dark core
  ctx.shadowBlur = 0;
  ctx.fillStyle = MINE_CORE;
  ctx.beginPath();
  ctx.arc(0, 0, m.r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // hot dot
  ctx.fillStyle = MINE_DOT;
  ctx.shadowColor = MINE_DOT;
  ctx.shadowBlur = 14 * pulse;
  ctx.beginPath();
  ctx.arc(0, 0, m.r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrystal(cr: Crystal): void {
  const bob = Math.sin(cr.bob * 1.6) * 4;
  ctx.save();
  ctx.translate(cr.x, cr.y + bob);
  ctx.rotate(cr.facing);
  const r = cr.r;
  // tetrahedron-ish silhouette pointing +x (facing)
  const pts: V[] = [
    { x: r * 1.4, y: 0 },
    { x: -r * 0.8, y: -r * 0.85 },
    { x: -r * 0.35, y: 0 },
    { x: -r * 0.8, y: r * 0.85 },
  ];
  ctx.shadowColor = CRYSTAL_GLOW;
  ctx.shadowBlur = 16;
  // facets
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.lineTo(pts[3].x, pts[3].y);
  ctx.closePath();
  const grad = ctx.createLinearGradient(-r, 0, r * 1.4, 0);
  grad.addColorStop(0, "#3a0f5a");
  grad.addColorStop(1, CRYSTAL);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = CRYSTAL;
  ctx.lineWidth = 2;
  ctx.stroke();
  // inner ridge
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.strokeStyle = CRYSTAL_HOT;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // hot core
  ctx.shadowColor = CRYSTAL_HOT;
  ctx.shadowBlur = 18;
  ctx.fillStyle = CRYSTAL_HOT;
  ctx.beginPath();
  ctx.arc(-r * 0.1, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBullets(): void {
  ctx.save();
  for (const b of bullets) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / sp;
    const uy = b.vy / sp;
    const tailLen = b.trail ? b.size * 5 : b.size * 3;
    // trail
    const grad = ctx.createLinearGradient(
      b.x - ux * tailLen,
      b.y - uy * tailLen,
      b.x,
      b.y,
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, b.color);
    ctx.strokeStyle = grad;
    ctx.lineWidth = b.size * 0.7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.x - ux * tailLen, b.y - uy * tailLen);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // head
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = b.color;
    if (b.trail) {
      // purple dart — diamond
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.beginPath();
      ctx.moveTo(b.size, 0);
      ctx.lineTo(0, b.size * 0.6);
      ctx.lineTo(-b.size * 0.6, 0);
      ctx.lineTo(0, -b.size * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawParticles(): void {
  ctx.save();
  for (const p of particles) {
    const a = 1 - p.age / p.life;
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawVoidDecor(): void {
  const flick = 0.6 + 0.4 * Math.sin(t * 1.3);
  ctx.save();
  // hex molecule clusters
  for (const hc of HEX_CLUSTERS) {
    ctx.strokeStyle = hc.color;
    ctx.globalAlpha = 0.32 * flick;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = hc.color;
    ctx.shadowBlur = 6;
    // bonds
    for (let i = 1; i < hc.nodes.length; i++) {
      ctx.beginPath();
      ctx.moveTo(hc.nodes[i - 1].x, hc.nodes[i - 1].y);
      ctx.lineTo(hc.nodes[i].x, hc.nodes[i].y);
      ctx.stroke();
    }
    // hex nodes
    for (const nd of hc.nodes) {
      hexPath(ctx, nd.x, nd.y, hc.r);
      ctx.stroke();
    }
  }
  // bar blocks (equalizer)
  for (const bb of BARS) {
    ctx.globalAlpha = 0.4 * flick;
    ctx.fillStyle = bb.color;
    ctx.shadowColor = bb.color;
    ctx.shadowBlur = 5;
    const bw = 6;
    const gap = 4;
    for (let i = 0; i < bb.bars.length; i++) {
      const wob = bb.bars[i] * (0.7 + 0.3 * Math.sin(t * 2 + i));
      const h = 60 * wob;
      ctx.fillRect(bb.x + i * (bw + gap), bb.y - h, bw, h);
    }
  }
  // red wireframe webs
  for (const wb of WEBS) {
    ctx.globalAlpha = 0.18 * flick;
    ctx.strokeStyle = wb.color;
    ctx.shadowColor = wb.color;
    ctx.shadowBlur = 5;
    ctx.lineWidth = 1;
    for (let i = 0; i < wb.pts.length; i++) {
      for (let j = i + 1; j < wb.pts.length; j++) {
        const d = Math.hypot(wb.pts[i].x - wb.pts[j].x, wb.pts[i].y - wb.pts[j].y);
        if (d < 170) {
          ctx.beginPath();
          ctx.moveTo(wb.pts[i].x, wb.pts[i].y);
          ctx.lineTo(wb.pts[j].x, wb.pts[j].y);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let lastTime = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

export function start(target: HTMLCanvasElement): void {
  canvas = target;
  const c2d = canvas.getContext("2d");
  if (!c2d) throw new Error("2D context unavailable");
  ctx = c2d;

  buildFloor();
  resize();
  window.addEventListener("resize", resize);

  // start the player at the reference's centre-left position
  player.x = n(0.39);
  player.y = n(0.45);

  window.addEventListener("keydown", (e) => {
    if (isAnyBoundCode(e.code, keybinds)) e.preventDefault();
    keys.add(e.code);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
  // live-refresh profile / keybinds if changed elsewhere (landing page)
  window.addEventListener("storage", () => {
    profile = loadPlayerProfile();
    keybinds = loadKeybinds();
  });

  lastTime = performance.now();
  requestAnimationFrame(frame);
}
