export const GRID_STEP = 60;

// Neon node-graph grid — split into two passes:
//
//   1. LINES: cached 60×60 tile turned into a CanvasPattern, painted as
//      one fillRect. Cheap, identical across rooms.
//   2. NODES: stateful, drawn live per frame. The "dead network" lore
//      bites here: most nodes start dead, a few are still alive (slow
//      flicker), and rare ones decay to dead over the course of a run.
//      The result is a floor that quietly tells the player they're
//      walking through a system that's no longer maintained.
//
// Cyan/blue family on purpose — the player + bullets own the hot
// accents (red/cyan flash on dash), so the floor stays in the cool
// half of the palette to keep contrast where it matters.

const GRID_LINE_COLOR = "rgba(125, 211, 252, 0.22)";

// Node state -----------------------------------------------------------

type NodeStatus = "dead" | "faint" | "alive";

type GridNode = {
  x: number;
  y: number;
  status: NodeStatus;
  baseAlpha: number;     // alpha when fully on (alive/faint); 0 for dead
  flickerPhase: number;  // sin offset so flickers don't sync
  flickerSpeed: number;  // rad/s — alive nodes pulse slowly
  dyingT: number;        // 0..1 progress through the death fade; -1 = stable
  dyingDuration: number; // seconds the death fade takes
};

export type GridNodeState = {
  nodes: GridNode[];
  decayTimer: number;
  // Hooked from updateGridNodes; resets after each death so the
  // cadence of nodes-going-dark is irregular.
  // Live indices for cheap random selection in decay events.
};

// Tuned for "dead network, last embers" — most nodes already dark.
const ALIVE_FRACTION = 0.035;
const FAINT_FRACTION = 0.09;
const ALIVE_BASE_ALPHA_MIN = 0.22;
const ALIVE_BASE_ALPHA_MAX = 0.45;
const FAINT_BASE_ALPHA_MIN = 0.05;
const FAINT_BASE_ALPHA_MAX = 0.11;
const ALIVE_FLICKER_DEPTH = 0.35;  // ± of base
const ALIVE_FLICKER_SPEED_MIN = 0.6;
const ALIVE_FLICKER_SPEED_MAX = 1.4;
const NODE_RADIUS = 1.6;

const DEATH_EVENT_INTERVAL_MIN = 9.0;
const DEATH_EVENT_INTERVAL_MAX = 22.0;
const DEATH_FADE_DURATION_SEC = 1.6;

const NODE_COLOR = "#7dd3fc";

export function createGridNodeState(roomW: number, roomH: number): GridNodeState {
  const nodes: GridNode[] = [];
  const cols = Math.floor(roomW / GRID_STEP);
  const rows = Math.floor(roomH / GRID_STEP);
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      const roll = Math.random();
      let status: NodeStatus;
      let baseAlpha: number;
      let flickerSpeed = 0;
      if (roll < ALIVE_FRACTION) {
        status = "alive";
        baseAlpha = randBetween(ALIVE_BASE_ALPHA_MIN, ALIVE_BASE_ALPHA_MAX);
        flickerSpeed = randBetween(ALIVE_FLICKER_SPEED_MIN, ALIVE_FLICKER_SPEED_MAX);
      } else if (roll < ALIVE_FRACTION + FAINT_FRACTION) {
        status = "faint";
        baseAlpha = randBetween(FAINT_BASE_ALPHA_MIN, FAINT_BASE_ALPHA_MAX);
      } else {
        status = "dead";
        baseAlpha = 0;
      }
      nodes.push({
        x: c * GRID_STEP + 0.5,
        y: r * GRID_STEP + 0.5,
        status,
        baseAlpha,
        flickerPhase: Math.random() * Math.PI * 2,
        flickerSpeed,
        dyingT: -1,
        dyingDuration: DEATH_FADE_DURATION_SEC,
      });
    }
  }
  return {
    nodes,
    decayTimer: randBetween(DEATH_EVENT_INTERVAL_MIN, DEATH_EVENT_INTERVAL_MAX) * 0.5,
  };
}

export function updateGridNodes(state: GridNodeState, dt: number): void {
  // Tick any in-progress death fades; once complete the node is dead
  // forever (status flips, baseAlpha → 0).
  for (const n of state.nodes) {
    if (n.dyingT >= 0) {
      n.dyingT += dt / n.dyingDuration;
      if (n.dyingT >= 1) {
        n.dyingT = -1;
        n.status = "dead";
        n.baseAlpha = 0;
      }
    }
  }

  // Schedule the next death event. Only "alive" or "faint" nodes are
  // eligible, with alive nodes prioritised — that way the visible
  // lights are the ones being lost.
  state.decayTimer -= dt;
  if (state.decayTimer <= 0) {
    state.decayTimer = randBetween(
      DEATH_EVENT_INTERVAL_MIN,
      DEATH_EVENT_INTERVAL_MAX,
    );
    const eligible: GridNode[] = [];
    for (const n of state.nodes) {
      if (n.status !== "dead" && n.dyingT < 0) eligible.push(n);
    }
    if (eligible.length > 0) {
      // 70 % chance to pick an alive node so player sees brightest
      // dots dying first.
      const aliveOnly = eligible.filter((n) => n.status === "alive");
      const pool = Math.random() < 0.7 && aliveOnly.length > 0
        ? aliveOnly
        : eligible;
      const victim = pool[Math.floor(Math.random() * pool.length)];
      victim.dyingT = 0;
    }
  }
}

function paintGridLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const tile = getOrBuildLineTile();
  if (!tile) return;
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.shadowBlur = 0;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

let cachedLineTile: HTMLCanvasElement | null = null;
function getOrBuildLineTile(): HTMLCanvasElement | null {
  if (cachedLineTile) return cachedLineTile;
  const tile = document.createElement("canvas");
  tile.width = GRID_STEP;
  tile.height = GRID_STEP;
  const tctx = tile.getContext("2d");
  if (!tctx) return null;
  tctx.strokeStyle = GRID_LINE_COLOR;
  tctx.lineWidth = 1;
  tctx.beginPath();
  tctx.moveTo(0, 0.5);
  tctx.lineTo(GRID_STEP, 0.5);
  tctx.moveTo(0.5, 0);
  tctx.lineTo(0.5, GRID_STEP);
  tctx.stroke();
  cachedLineTile = tile;
  return tile;
}

export function drawRoomGrid(
  ctx: CanvasRenderingContext2D,
  roomW: number,
  roomH: number,
  nodeState?: GridNodeState,
): void {
  paintGridLines(ctx, roomW, roomH);
  if (nodeState) drawGridNodes(ctx, nodeState);
}

function drawGridNodes(
  ctx: CanvasRenderingContext2D,
  state: GridNodeState,
): void {
  const nowSec = performance.now() / 1000;
  ctx.save();
  ctx.fillStyle = NODE_COLOR;
  ctx.shadowBlur = 0;
  const r = NODE_RADIUS;
  const d = r * 2;
  for (const n of state.nodes) {
    let alpha = n.baseAlpha;
    if (alpha <= 0) continue;
    if (n.status === "alive") {
      const f = Math.sin(nowSec * n.flickerSpeed * Math.PI * 2 + n.flickerPhase);
      alpha = n.baseAlpha * (1 + ALIVE_FLICKER_DEPTH * f);
    }
    if (n.dyingT >= 0) {
      alpha *= 1 - n.dyingT;
    }
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    ctx.fillRect(n.x - r, n.y - r, d, d);
  }
  ctx.restore();
}

// Build an offscreen canvas with the arena grid lines on a transparent
// background. Kept for sandbox which prefers blitting a single
// offscreen image once per frame; node state is intentionally NOT
// baked in here (sandbox doesn't have per-room state yet).
export function createGridCanvas(
  viewW: number,
  viewH: number,
  dpr: number,
): HTMLCanvasElement | null {
  const gc = document.createElement("canvas");
  gc.width = Math.max(1, Math.floor(viewW * dpr));
  gc.height = Math.max(1, Math.floor(viewH * dpr));
  const gctx = gc.getContext("2d");
  if (!gctx) return null;
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintGridLines(gctx, viewW, viewH);
  return gc;
}

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
