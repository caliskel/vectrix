// Intro cinematic — first-time experience. ~20 seconds of dialogue-free
// staging that grounds the player in the lore before the tutorial:
//
//   The hero sleeps in a stasis capsule, suspended from the ceiling of
//   an abandoned chamber. Wall panels gape open, cracks in the floor
//   leak the last of the network's current. A spark arrives, severs
//   the wires, breaks the capsule, and merges with the dormant eye —
//   the player consciousness inhabiting the body waiting here.
//
// Pure canvas 2D. State machine of ten phases, layered renderer with:
// room architecture, multi-shell capsule, full eye-orb hero, glass
// crack propagation, volumetric beams, camera push-in.

import { DASH_DURATION_MS, DASH_COOLDOWN_MS, PLAYER_SIZE } from "../lib/config";
import {
  createPlayer,
  drawPlayerEye,
  loadPlayerProfile,
  updateEye,
  type Player,
  type PlayerProfile,
} from "../lib/player";

const CANVAS_W = 1200;
const CANVAS_H = 800;

// ---- Room geometry ----
const CEILING_Y = 70;
const FLOOR_Y = 700;
const WALL_LEFT_X = 100;
const WALL_RIGHT_X = CANVAS_W - 100;

// ---- Capsule ----
const CAPSULE_CX = 600;
const CAPSULE_CY = 410;
const CAPSULE_RX = 80;
const CAPSULE_RY = 130;
const BRACKET_W = 70;
const BRACKET_H = 22;
const BRACKET_Y = CAPSULE_CY - CAPSULE_RY - 18;

// Hero inside the capsule — mimics the in-game eye geometry so the
// reveal feels continuous with gameplay. Sized down a touch so the
// capsule "wraps" the body with some margin.
const HERO_OUTER_R = 30;
const HERO_IRIS_R = 22;
const HERO_PUPIL_R = 8;

// ---- Wires ----
const WIRES: WireSpec[] = [
  // Three suspension cables, anchored in the bottom edge of the
  // ceiling hooks. Tension cables read as nearly straight — slight
  // positive cpYOffset gives a barely-perceptible catenary sag from
  // their own weight.
  { ax: CAPSULE_CX - 22, ay: BRACKET_Y + 4, bx: 280,  by: CEILING_Y + 4, cpYOffset: 14, kind: "suspend" },
  { ax: CAPSULE_CX,      ay: BRACKET_Y - 2, bx: 600,  by: CEILING_Y + 4, cpYOffset: 12, kind: "suspend" },
  { ax: CAPSULE_CX + 22, ay: BRACKET_Y + 4, bx: 920,  by: CEILING_Y + 4, cpYOffset: 14, kind: "suspend" },
  // Two network feeds dropping into the wall — these CAN sag because
  // they're not load-bearing; positive cpYOffset gives the droop.
  { ax: CAPSULE_CX - CAPSULE_RX + 4, ay: CAPSULE_CY + 50, bx: WALL_LEFT_X - 4,  by: 500, cpYOffset: 70, kind: "feed" },
  { ax: CAPSULE_CX + CAPSULE_RX - 4, ay: CAPSULE_CY + 50, bx: WALL_RIGHT_X + 4, by: 500, cpYOffset: 70, kind: "feed" },
];

// ---- Phase timing ----
type PhaseId =
  | "fadein"
  | "establish"
  | "lightsdie"
  | "silence"
  | "sparkenters"
  | "cutting"
  | "shatter"
  | "merge"
  | "blackout"
  | "awaken"
  | "askname"
  | "fadeout";

const PHASE_ORDER: PhaseId[] = [
  "fadein",
  "establish",
  "lightsdie",
  "silence",
  "sparkenters",
  "cutting",
  "shatter",
  "merge",
  "blackout",
  "awaken",
  "askname",
  "fadeout",
];

const PHASE_DURATIONS: Record<PhaseId, number> = {
  fadein: 2.5,
  establish: 3.5,
  lightsdie: 2.0,
  silence: 1.5,
  sparkenters: 2.0,
  // 5 wires × (0.5 travel + 0.32 sever + 0.2 rest) ≈ 5.1 s; bumped
  // to 5.5 s so the final wire fully finishes severing before the
  // shatter phase grabs the timeline.
  cutting: 5.5,
  shatter: 1.8,
  merge: 1.5,
  // Brief silence/blackout — the spark has merged, the room cuts to
  // pure darkness for a beat before the hero stirs.
  blackout: 0.9,
  // Eye opens.
  awaken: 1.6,
  // "WHO AM I?" thought surfaces.
  askname: 3.0,
  fadeout: 0.7,
};

// ---- Types ----
type WireSpec = {
  ax: number; ay: number;
  bx: number; by: number;
  cpYOffset: number;
  kind: "suspend" | "feed";
};

type RopeNode = {
  x: number; y: number;
  prevX: number; prevY: number;
};

type WireState = {
  cut: boolean;
  // Sever animation: counts up during the on-the-wire melt, before the
  // rope itself is released. -1 = inactive. While > 0 the wire renders
  // intact but with a growing hot gap at the cut point.
  cutMeltAge: number;
  preCutGlowAge: number;
  // Verlet chain spawned at the cut moment. Index 0 stays pinned to
  // the capsule attach point; the last node is the free cut end.
  looseNodes: RopeNode[] | null;
  loosePieceSegLen: number;
  loosePieceAge: number;
};

type FloorCrack = { pts: { x: number; y: number }[] };
type WallVent = { x: number; y: number; w: number; h: number; sparkPhase: number };
type Pipe = { ax: number; ay: number; bx: number; by: number; bent: boolean };

type CrackSpark = {
  origin: { x: number; y: number };
  segments: { x: number; y: number }[];
  age: number;
  lifetime: number;
};

type Ember = {
  x: number; y: number;
  vx: number; vy: number;
  age: number; lifetime: number;
};

type DustMote = {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  alpha: number;
};

type Shard = {
  // Polygon vertices in local space (around 0,0).
  verts: { x: number; y: number }[];
  // World position + motion.
  x: number; y: number;
  vx: number; vy: number;
  rot: number; rotVel: number;
  age: number; lifetime: number;
};

type GlassMote = {
  x: number; y: number;
  vx: number; vy: number;
  age: number; lifetime: number;
  size: number;
};

type SparkPath = {
  startX: number; startY: number;
  endX: number; endY: number;
  // Bezier control point — placed perpendicular to the start→end
  // segment so the motion curves rather than going in a straight line.
  cpX: number; cpY: number;
  duration: number;
};

type GlassCrack = {
  // Spider-web crack pattern: each polyline emanates from the capsule
  // center to a point on the rim. cracks reveal as crackProgress
  // grows from 0 → 1 during the shatter phase telegraph.
  pts: { x: number; y: number }[];
  appearAt: number; // 0..1 — when this crack starts revealing
};

export type IntroState = {
  time: number;
  phase: PhaseId;
  phaseTime: number;
  done: boolean;

  // Capsule
  capsuleGlow: number;
  capsuleBroken: boolean;

  // Hero inside
  eyeOpen: number;
  heroBreath: number;
  heroFlicker: number; // tiny glow flicker on the iris when dormant

  // Wires
  wires: WireState[];

  // Crack progress on capsule glass (0..1 across shatter telegraph)
  capsuleCracks: GlassCrack[];
  crackProgress: number;

  // Floor + walls
  floorCracks: FloorCrack[];
  wallVents: WallVent[];
  pipes: Pipe[];
  hangingWires: { x: number; y1: number; y2: number; sway: number }[];

  // Ambient FX
  crackSparks: CrackSpark[];
  embers: Ember[];
  sparkSpawnTimer: number;
  dust: DustMote[];

  // Spark of light. Moves along curved Bezier paths between
  // waypoints so the motion feels organic rather than ruler-straight.
  sparkX: number;
  sparkY: number;
  sparkActive: boolean;
  sparkTrail: { x: number; y: number }[];
  sparkBrightness: number;
  sparkPath: SparkPath | null;
  sparkPathT: number; // 0..1 along the current path

  // In-game hero (drawPlayerEye) — used from awaken phase onward so
  // the reveal lands on the same body the player will inhabit.
  hero: Player;
  heroProfile: PlayerProfile;
  // White "interior" glow when the spark merges with the body. Visible
  // through the closed eye during blackout/early awaken, fades as the
  // eye finishes opening.
  interiorWhite: number;

  // Cutting sub-state. The sever phase replaces the previous instant
  // flag-flip + cut-flash combo — the wire visibly melts/severs over
  // its duration before the rope is released.
  cuttingWireIndex: number;
  cuttingSubPhase: "travel" | "sever" | "rest";
  cuttingSubAge: number;

  // Capsule shatter — large wedge chunks of the shell + smaller
  // glass motes for chaos.
  shards: Shard[];
  glassMotes: GlassMote[];
  shatterFlash: number;

  // Flashes
  mergeFlash: number;
  finalFlash: number;
  cutFlashes: { x: number; y: number; age: number }[];

  // Camera
  cameraScale: number;
  cameraTargetScale: number;
  cameraOffsetY: number;
  cameraShakeRemaining: number;
  cameraShakeAmount: number;
};

// ---- State builders ----

export function createIntroState(): IntroState {
  const heroProfile = loadPlayerProfile();
  const hero = createPlayer();
  hero.x = CAPSULE_CX;
  hero.y = CAPSULE_CY;
  // Eye starts closed — the body has been dormant. The closeAmount
  // is animated back to 0 during the awaken phase via eyeStartClosing
  // inversion (we just toggle isClosing).
  hero.isClosing = true;
  hero.closeAmount = 1;
  return {
    time: 0,
    phase: "fadein",
    phaseTime: 0,
    done: false,
    capsuleGlow: 0,
    capsuleBroken: false,
    eyeOpen: 0,
    heroBreath: 0,
    heroFlicker: 0,
    wires: WIRES.map(() => ({
      cut: false,
      cutMeltAge: -1,
      preCutGlowAge: -1,
      looseNodes: null,
      loosePieceSegLen: 0,
      loosePieceAge: -1,
    })),
    capsuleCracks: buildGlassCracks(),
    crackProgress: 0,
    floorCracks: buildFloorCracks(),
    wallVents: buildWallVents(),
    pipes: buildPipes(),
    hangingWires: buildHangingWires(),
    crackSparks: [],
    embers: [],
    sparkSpawnTimer: 0,
    dust: buildDust(),
    sparkX: 0,
    sparkY: 0,
    sparkActive: false,
    sparkTrail: [],
    sparkBrightness: 0,
    sparkPath: null,
    sparkPathT: 0,
    hero,
    heroProfile,
    interiorWhite: 0,
    cuttingWireIndex: 0,
    cuttingSubPhase: "travel",
    cuttingSubAge: 0,
    shards: [],
    glassMotes: [],
    shatterFlash: 0,
    mergeFlash: 0,
    finalFlash: 0,
    cutFlashes: [],
    cameraScale: 0.94,
    cameraTargetScale: 1.0,
    cameraOffsetY: 0,
    cameraShakeRemaining: 0,
    cameraShakeAmount: 0,
  };
}

function buildFloorCracks(): FloorCrack[] {
  const cracks: FloorCrack[] = [];
  for (let i = 0; i < 9; i++) {
    const pts: { x: number; y: number }[] = [];
    let x = Math.random() * CANVAS_W;
    let y = FLOOR_Y + 6 + Math.random() * (CANVAS_H - FLOOR_Y - 20);
    pts.push({ x, y });
    const segs = 4 + Math.floor(Math.random() * 5);
    const dirX = Math.random() < 0.5 ? 1 : -1;
    for (let s = 0; s < segs; s++) {
      x += dirX * (40 + Math.random() * 80);
      y += (Math.random() - 0.5) * 40;
      y = Math.max(FLOOR_Y + 4, Math.min(CANVAS_H - 6, y));
      pts.push({ x, y });
    }
    cracks.push({ pts });
  }
  return cracks;
}

function buildWallVents(): WallVent[] {
  // A handful of open vent panels on each wall — implied destruction.
  const vents: WallVent[] = [];
  const leftCount = 3;
  for (let i = 0; i < leftCount; i++) {
    vents.push({
      x: WALL_LEFT_X - 50,
      y: 200 + i * 160 + (Math.random() * 30 - 15),
      w: 36,
      h: 90,
      sparkPhase: Math.random() * Math.PI * 2,
    });
  }
  const rightCount = 3;
  for (let i = 0; i < rightCount; i++) {
    vents.push({
      x: WALL_RIGHT_X + 14,
      y: 220 + i * 160 + (Math.random() * 30 - 15),
      w: 36,
      h: 90,
      sparkPhase: Math.random() * Math.PI * 2,
    });
  }
  return vents;
}

function buildPipes(): Pipe[] {
  // Broken pipes / conduits attached along the walls, lending depth.
  return [
    { ax: WALL_LEFT_X, ay: 150, bx: WALL_LEFT_X, by: 380, bent: false },
    { ax: WALL_LEFT_X, ay: 380, bx: WALL_LEFT_X - 14, by: 410, bent: true },
    { ax: WALL_RIGHT_X, ay: 130, bx: WALL_RIGHT_X, by: 320, bent: false },
    { ax: WALL_RIGHT_X, ay: 320, bx: WALL_RIGHT_X + 18, by: 360, bent: true },
    { ax: WALL_LEFT_X, ay: 540, bx: WALL_LEFT_X, by: 680, bent: false },
    { ax: WALL_RIGHT_X, ay: 560, bx: WALL_RIGHT_X, by: 680, bent: false },
  ];
}

function buildHangingWires(): { x: number; y1: number; y2: number; sway: number }[] {
  // Stray cables dangling from the ceiling beyond the main 5, for
  // depth. Different lengths and slight phase offsets so they don't
  // sway in sync.
  return [
    { x: 220, y1: CEILING_Y, y2: 170, sway: 0 },
    { x: 380, y1: CEILING_Y, y2: 220, sway: 1.2 },
    { x: 820, y1: CEILING_Y, y2: 180, sway: 2.1 },
    { x: 990, y1: CEILING_Y, y2: 240, sway: 3.0 },
    { x: 1050, y1: CEILING_Y, y2: 160, sway: 0.6 },
  ];
}

function buildDust(): DustMote[] {
  const dust: DustMote[] = [];
  for (let i = 0; i < 40; i++) {
    dust.push({
      x: Math.random() * CANVAS_W,
      y: 100 + Math.random() * 580,
      vx: (Math.random() - 0.5) * 8,
      vy: -3 + Math.random() * -6,
      size: 0.8 + Math.random() * 1.2,
      alpha: 0.05 + Math.random() * 0.12,
    });
  }
  return dust;
}

function buildGlassCracks(): GlassCrack[] {
  // Spider-web cracks emanating from a chosen impact point on the
  // capsule glass. Each crack is a jagged polyline from the impact
  // outward, branching at random.
  const cracks: GlassCrack[] = [];
  const impactX = CAPSULE_CX - 8 + (Math.random() - 0.5) * 14;
  const impactY = CAPSULE_CY - 14 + (Math.random() - 0.5) * 14;
  const radialCount = 9;
  for (let i = 0; i < radialCount; i++) {
    const baseAngle = (i / radialCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const pts: { x: number; y: number }[] = [{ x: impactX, y: impactY }];
    const segs = 4 + Math.floor(Math.random() * 4);
    let cx = impactX;
    let cy = impactY;
    let angle = baseAngle;
    for (let s = 0; s < segs; s++) {
      const len = 8 + Math.random() * 18;
      angle += (Math.random() - 0.5) * 0.6;
      cx += Math.cos(angle) * len;
      cy += Math.sin(angle) * len;
      // Clamp inside the capsule oval.
      const dx = (cx - CAPSULE_CX) / CAPSULE_RX;
      const dy = (cy - CAPSULE_CY) / CAPSULE_RY;
      if (dx * dx + dy * dy > 1) {
        // Walk back to the edge.
        const norm = Math.sqrt(dx * dx + dy * dy);
        cx = CAPSULE_CX + (cx - CAPSULE_CX) / norm * 0.96;
        cy = CAPSULE_CY + (cy - CAPSULE_CY) / norm * 0.96;
        pts.push({ x: cx, y: cy });
        break;
      }
      pts.push({ x: cx, y: cy });
    }
    cracks.push({ pts, appearAt: i / radialCount * 0.6 });
  }
  return cracks;
}

// ---- Tick ----

export function updateIntro(state: IntroState, dt: number): void {
  state.time += dt;
  state.phaseTime += dt;
  const dur = PHASE_DURATIONS[state.phase];
  if (state.phaseTime >= dur) {
    const idx = PHASE_ORDER.indexOf(state.phase);
    if (idx + 1 < PHASE_ORDER.length) {
      state.phase = PHASE_ORDER[idx + 1];
      state.phaseTime -= dur;
      onPhaseEnter(state);
    } else {
      state.done = true;
      state.phaseTime = dur;
    }
  }

  tickCamera(state, dt);
  tickAmbience(state, dt);
  tickByPhase(state, dt);
  tickLoosePieces(state, dt);
  tickHero(state, dt);
}

function onPhaseEnter(state: IntroState): void {
  switch (state.phase) {
    case "establish":
      state.cameraTargetScale = 1.0;
      break;
    case "lightsdie":
      state.cameraTargetScale = 1.02;
      break;
    case "silence":
      state.cameraTargetScale = 1.04;
      break;
    case "sparkenters":
      state.sparkActive = true;
      state.sparkX = CANVAS_W + 80;
      state.sparkY = -60;
      state.sparkBrightness = 0;
      state.sparkTrail = [];
      // Curved entry path — starts off-screen, sweeps down-and-in
      // toward a holding point above the capsule.
      startSparkPath(
        state,
        state.sparkX,
        state.sparkY,
        CAPSULE_CX + 220,
        CAPSULE_CY - 260,
        PHASE_DURATIONS.sparkenters,
        180,
      );
      state.cameraTargetScale = 1.06;
      break;
    case "cutting":
      state.cuttingWireIndex = 0;
      state.cuttingSubPhase = "travel";
      state.cuttingSubAge = 0;
      // Curved approach to the first wire.
      startSparkPath(
        state,
        state.sparkX,
        state.sparkY,
        wireBezier(WIRES[0], CUT_T).x,
        wireBezier(WIRES[0], CUT_T).y,
        0.6,
        70,
      );
      state.cameraTargetScale = 1.1;
      break;
    case "shatter":
      state.shards = buildShatterShards();
      state.glassMotes = buildGlassMotes();
      state.shatterFlash = 1;
      state.capsuleBroken = true;
      state.crackProgress = 1;
      triggerShake(state, 18, 0.55);
      // Spark drifts up-and-over the wreckage — start a curved path
      // toward a hold point just above the capsule.
      startSparkPath(
        state,
        state.sparkX,
        state.sparkY,
        CAPSULE_CX + 40,
        CAPSULE_CY - 90,
        PHASE_DURATIONS.shatter,
        90,
      );
      state.cameraTargetScale = 1.15;
      break;
    case "merge":
      // Curved descent into the body — the spark "spirals" the last
      // distance into the empty shell.
      startSparkPath(
        state,
        state.sparkX,
        state.sparkY,
        CAPSULE_CX,
        CAPSULE_CY,
        PHASE_DURATIONS.merge,
        50,
      );
      state.cameraTargetScale = 1.18;
      break;
    case "blackout":
      // Spark has merged with the body — the room cuts to pure
      // darkness. Everything goes dim/invisible for a beat before
      // the eye stirs. Spark itself is gone (it IS the body now).
      state.sparkActive = false;
      state.sparkBrightness = 0;
      state.mergeFlash = 0;
      // The body now glows white inside — this is the consciousness
      // settling. Ramps up during blackout, holds bright, fades as
      // the eye opens.
      state.interiorWhite = 1;
      state.cameraTargetScale = 1.05;
      break;
    case "awaken":
      // Tell the game-engine eye to open. closeAmount animates back
      // to 0 over CLOSE_DURATION; updateEye drives the transition.
      state.hero.isClosing = false;
      state.cameraTargetScale = 1.0;
      break;
    case "askname":
      state.cameraTargetScale = 0.98;
      break;
    case "fadeout":
      state.finalFlash = 0;
      state.cameraTargetScale = 0.95;
      break;
  }
}

function triggerShake(state: IntroState, amount: number, duration: number): void {
  state.cameraShakeAmount = amount;
  state.cameraShakeRemaining = duration;
}

function buildShatterShards(): Shard[] {
  // Wedge chunks of the capsule shell. Each chunk is a curved-shell
  // slice — outer rim arc + inner rim arc, closed at both ends so it
  // reads as a thick fragment of the glass body, not a flat
  // triangle. Chunks fly outward from the capsule center.
  const shards: Shard[] = [];
  const count = 7;
  const baseStep = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    const a1 = i * baseStep + (Math.random() - 0.5) * 0.25;
    const a2 = a1 + baseStep + (Math.random() - 0.5) * 0.25;
    const RX_OUT = CAPSULE_RX;
    const RY_OUT = CAPSULE_RY;
    const innerScale = 0.88 + Math.random() * 0.04;
    const RX_IN = CAPSULE_RX * innerScale;
    const RY_IN = CAPSULE_RY * innerScale;
    const ARC_STEPS = 5;
    const verts: { x: number; y: number }[] = [];
    // Outer arc (a1 → a2)
    for (let s = 0; s <= ARC_STEPS; s++) {
      const a = a1 + (a2 - a1) * (s / ARC_STEPS);
      verts.push({ x: Math.cos(a) * RX_OUT, y: Math.sin(a) * RY_OUT });
    }
    // Inner arc back (a2 → a1)
    for (let s = ARC_STEPS; s >= 0; s--) {
      const a = a1 + (a2 - a1) * (s / ARC_STEPS);
      verts.push({ x: Math.cos(a) * RX_IN, y: Math.sin(a) * RY_IN });
    }
    // Polygon centroid → re-centre verts so rotation pivots on it.
    let cx = 0;
    let cy = 0;
    for (const v of verts) {
      cx += v.x;
      cy += v.y;
    }
    cx /= verts.length;
    cy /= verts.length;
    for (const v of verts) {
      v.x -= cx;
      v.y -= cy;
    }
    // World position: chunk centroid expressed in capsule space.
    const worldX = CAPSULE_CX + cx;
    const worldY = CAPSULE_CY + cy;
    // Outward velocity toward chunk centroid direction.
    const dirAngle = Math.atan2(cy, cx);
    const speed = 220 + Math.random() * 220;
    shards.push({
      verts,
      x: worldX,
      y: worldY,
      vx: Math.cos(dirAngle) * speed,
      vy: Math.sin(dirAngle) * speed - 80, // upward bias
      rot: 0,
      rotVel: (Math.random() - 0.5) * 6,
      age: 0,
      // Long lifetime — chunks settle on the floor and stay visible
      // through the rest of the cinematic instead of vanishing
      // mid-fall. Fade is held off until the last 20% of the
      // lifetime (handled in drawShards).
      lifetime: 6.5 + Math.random() * 1.2,
    });
  }
  return shards;
}

function buildGlassMotes(): GlassMote[] {
  // Smaller bright glass dust filling the gaps between chunks.
  const motes: GlassMote[] = [];
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = CAPSULE_RX * 0.4 + Math.random() * CAPSULE_RX * 0.6;
    const speed = 260 + Math.random() * 320;
    motes.push({
      x: CAPSULE_CX + Math.cos(a) * r,
      y: CAPSULE_CY + Math.sin(a) * r,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 100,
      age: 0,
      lifetime: 1.6 + Math.random() * 0.9,
      size: 1.2 + Math.random() * 1.4,
    });
  }
  return motes;
}

function tickCamera(state: IntroState, dt: number): void {
  // Ease camera toward target.
  state.cameraScale += (state.cameraTargetScale - state.cameraScale) * Math.min(1, dt * 1.5);
  // Slow gentle vertical drift so the framing isn't dead-still.
  state.cameraOffsetY = Math.sin(state.time * 0.45) * 4;
  if (state.cameraShakeRemaining > 0) {
    state.cameraShakeRemaining = Math.max(0, state.cameraShakeRemaining - dt);
  }
}

function tickByPhase(state: IntroState, dt: number): void {
  switch (state.phase) {
    case "fadein": {
      const t = state.phaseTime / PHASE_DURATIONS.fadein;
      state.capsuleGlow = smoothstep(t) * 0.6;
      state.cameraTargetScale = 0.94 + smoothstep(t) * 0.06;
      break;
    }
    case "establish": {
      const breath = Math.sin(state.time * 1.1) * 0.06;
      state.capsuleGlow = 0.6 + breath;
      break;
    }
    case "lightsdie": {
      const t = state.phaseTime / PHASE_DURATIONS.lightsdie;
      state.capsuleGlow = (1 - smoothstep(t)) * 0.6;
      break;
    }
    case "silence": {
      state.capsuleGlow = 0;
      break;
    }
    case "sparkenters": {
      const t = state.phaseTime / PHASE_DURATIONS.sparkenters;
      state.sparkBrightness = Math.min(1, t * 1.6);
      advanceSparkPath(state, dt, easeOutCubic);
      break;
    }
    case "cutting": {
      tickCutting(state, dt);
      break;
    }
    case "shatter": {
      tickShards(state, dt);
      state.shatterFlash = Math.max(0, state.shatterFlash - dt * 2.5);
      state.sparkBrightness = 1;
      advanceSparkPath(state, dt, easeInOutCubic);
      break;
    }
    case "merge": {
      tickShards(state, dt);
      const t = state.phaseTime / PHASE_DURATIONS.merge;
      state.sparkBrightness = 1 + t * 2.0;
      advanceSparkPath(state, dt, easeInOutCubic);
      if (t > 0.85) {
        state.mergeFlash = (t - 0.85) / 0.15;
      }
      // As we near the body, ramp up the interior white so the
      // crossover from "spark outside" → "consciousness inside" reads.
      if (t > 0.7) {
        state.interiorWhite = (t - 0.7) / 0.3;
      }
      break;
    }
    case "blackout": {
      // Pure dark beat. Interior glow holds at full brightness.
      state.interiorWhite = 1;
      break;
    }
    case "awaken": {
      tickShards(state, dt);
      // Interior white glow fades as the eye opens — by the end of
      // awaken the in-game iris/pupil are fully visible.
      const t = state.phaseTime / PHASE_DURATIONS.awaken;
      state.interiorWhite = Math.max(0, 1 - t * 1.4);
      state.sparkX = CAPSULE_CX;
      state.sparkY = CAPSULE_CY;
      break;
    }
    case "askname": {
      state.interiorWhite = 0;
      break;
    }
    case "fadeout": {
      const t = state.phaseTime / PHASE_DURATIONS.fadeout;
      state.finalFlash = t;
      break;
    }
  }

  // Crack progress: ramps up during the second half of the cutting
  // phase + the start of shatter (telegraph before the glass blows).
  if (state.phase === "cutting") {
    // After the last wire, cracks start spreading slowly.
    if (state.cuttingWireIndex >= WIRES.length - 1) {
      state.crackProgress = Math.min(1, state.crackProgress + dt * 1.2);
    }
  }
}

const CUT_T = 0.42;
const SEVER_DURATION_SEC = 0.32;

function tickCutting(state: IntroState, dt: number): void {
  if (state.cuttingWireIndex >= WIRES.length) return;
  const wire = WIRES[state.cuttingWireIndex];
  const cp = wireBezier(wire, CUT_T);
  state.cuttingSubAge += dt;
  switch (state.cuttingSubPhase) {
    case "travel": {
      const TRAVEL_SEC = 0.6;
      // The path for this wire was set in the rest→travel transition
      // (or in onPhaseEnter for the first one) — just advance it.
      advanceSparkPath(state, dt, easeInOutCubic);
      state.wires[state.cuttingWireIndex].preCutGlowAge = state.cuttingSubAge;
      if (state.cuttingSubAge >= TRAVEL_SEC) {
        state.cuttingSubPhase = "sever";
        state.cuttingSubAge = 0;
        state.wires[state.cuttingWireIndex].cutMeltAge = 0;
        // Snap spark exactly onto the cut point for the sever beat —
        // any wobble accumulated during travel reads as misalignment.
        state.sparkX = cp.x;
        state.sparkY = cp.y;
        state.sparkPath = null;
        spawnCutEmbers(state, cp, 5);
      }
      break;
    }
    case "sever": {
      const meltT = state.cuttingSubAge / SEVER_DURATION_SEC;
      state.wires[state.cuttingWireIndex].cutMeltAge = state.cuttingSubAge;
      // Continuous embers throughout the sever — a few per tick.
      if (Math.random() < dt * 22) spawnCutEmbers(state, cp, 1);
      // Halfway through, the rope actually detaches and a bright cut
      // flash blooms.
      if (meltT >= 0.55 && !state.wires[state.cuttingWireIndex].cut) {
        const w = state.wires[state.cuttingWireIndex];
        w.cut = true;
        w.looseNodes = initRope(WIRES[state.cuttingWireIndex]);
        w.loosePieceSegLen = ropeSegmentLength(WIRES[state.cuttingWireIndex]);
        w.loosePieceAge = 0;
        state.cutFlashes.push({ x: cp.x, y: cp.y, age: 0 });
        triggerShake(state, 4, 0.16);
        spawnCutEmbers(state, cp, 6);
      }
      if (state.cuttingSubAge >= SEVER_DURATION_SEC) {
        state.wires[state.cuttingWireIndex].cutMeltAge = -1;
        state.cuttingSubPhase = "rest";
        state.cuttingSubAge = 0;
      }
      break;
    }
    case "rest": {
      const REST_SEC = 0.22;
      if (state.cuttingSubAge >= REST_SEC) {
        state.cuttingWireIndex++;
        state.cuttingSubPhase = "travel";
        state.cuttingSubAge = 0;
        // Set up a curved path to the next wire (if there is one).
        if (state.cuttingWireIndex < WIRES.length) {
          const next = wireBezier(WIRES[state.cuttingWireIndex], CUT_T);
          startSparkPath(state, state.sparkX, state.sparkY, next.x, next.y, 0.6, 80);
        }
      }
      break;
    }
  }

  for (const f of state.cutFlashes) f.age += dt;
  state.cutFlashes = state.cutFlashes.filter((f) => f.age < 0.45);
}

function spawnCutEmbers(state: IntroState, origin: { x: number; y: number }, count: number): void {
  for (let k = 0; k < count; k++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 180;
    state.embers.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      lifetime: 0.55 + Math.random() * 0.4,
    });
  }
}

const SHARD_FLOOR_Y = FLOOR_Y - 12;
const SHARD_GRAV = 520;
const SHARD_BOUNCE = 0.32;
const SHARD_FRICTION = 0.62;
const SHARD_REST_VY = 35;

function tickShards(state: IntroState, dt: number): void {
  for (const s of state.shards) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += SHARD_GRAV * dt;
    s.rot += s.rotVel * dt;
    // Floor collision — bounce a couple times, then settle. Chunks
    // pile up rather than vanish into the void.
    if (s.y > SHARD_FLOOR_Y) {
      s.y = SHARD_FLOOR_Y;
      if (s.vy > SHARD_REST_VY) {
        s.vy = -s.vy * SHARD_BOUNCE;
        s.vx *= SHARD_FRICTION;
        s.rotVel *= 0.6;
      } else {
        // Settled — let gravity press, kill micro-motion.
        s.vy = 0;
        s.vx *= 0.85;
        s.rotVel *= 0.8;
      }
    }
  }
  state.shards = state.shards.filter((s) => s.age < s.lifetime);

  for (const m of state.glassMotes) {
    m.age += dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.vy += SHARD_GRAV * dt;
    if (m.y > SHARD_FLOOR_Y) {
      m.y = SHARD_FLOOR_Y;
      m.vy = -m.vy * 0.25;
      m.vx *= 0.55;
    }
  }
  state.glassMotes = state.glassMotes.filter((m) => m.age < m.lifetime);
}

const ROPE_NODES = 12;
const ROPE_GRAVITY = 1200;
const ROPE_DAMPING = 0.985;
const ROPE_CONSTRAINT_ITERS = 5;

function initRope(wire: WireSpec): RopeNode[] {
  // Sample the wire from the capsule attach end (t=1) inward to the
  // cut point (t=CUT_T). Index 0 is the anchor (capsule), last node
  // is the cut end (free).
  const nodes: RopeNode[] = [];
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = 1 - (1 - CUT_T) * (i / (ROPE_NODES - 1));
    const p = wireBezier(wire, t);
    // Tiny initial kick perpendicular to the wire so the chain doesn't
    // sit in perfect mathematical alignment.
    const tan = wireBezierTangent(wire, t);
    const nudgeX = -tan.y * 0.4 * (Math.random() - 0.5);
    const nudgeY = tan.x * 0.4 * (Math.random() - 0.5);
    nodes.push({
      x: p.x,
      y: p.y,
      prevX: p.x - nudgeX,
      prevY: p.y - nudgeY,
    });
  }
  return nodes;
}

function ropeSegmentLength(wire: WireSpec): number {
  // Compute total arc length between sampled nodes, divide by segments.
  let total = 0;
  let prev = wireBezier(wire, 1);
  for (let i = 1; i < ROPE_NODES; i++) {
    const t = 1 - (1 - CUT_T) * (i / (ROPE_NODES - 1));
    const p = wireBezier(wire, t);
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total / (ROPE_NODES - 1);
}

function tickLoosePieces(state: IntroState, dt: number): void {
  for (let i = 0; i < state.wires.length; i++) {
    const w = state.wires[i];
    if (!w.looseNodes || w.loosePieceAge < 0) continue;
    w.loosePieceAge += dt;
    const wireSpec = WIRES[i];
    const nodes = w.looseNodes;
    const segLen = w.loosePieceSegLen;
    // Verlet integrate non-anchor nodes.
    for (let k = 1; k < nodes.length; k++) {
      const n = nodes[k];
      const vx = (n.x - n.prevX) * ROPE_DAMPING;
      const vy = (n.y - n.prevY) * ROPE_DAMPING;
      n.prevX = n.x;
      n.prevY = n.y;
      n.x += vx;
      n.y += vy + 0.5 * ROPE_GRAVITY * dt * dt;
    }
    // Pin anchor at the capsule attach point.
    nodes[0].x = wireSpec.ax;
    nodes[0].y = wireSpec.ay;
    nodes[0].prevX = wireSpec.ax;
    nodes[0].prevY = wireSpec.ay;
    // Constraint passes.
    for (let iter = 0; iter < ROPE_CONSTRAINT_ITERS; iter++) {
      for (let k = 0; k < nodes.length - 1; k++) {
        const a = nodes[k];
        const b = nodes[k + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.001) continue;
        const diff = (dist - segLen) / dist;
        if (k === 0) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.5;
          a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5;
          b.y -= dy * diff * 0.5;
        }
      }
      nodes[0].x = wireSpec.ax;
      nodes[0].y = wireSpec.ay;
    }
  }
}

function tickAmbience(state: IntroState, dt: number): void {
  let rate = 1.0;
  if (state.phase === "silence") rate = 0.3;
  else if (state.phase === "lightsdie") rate = 0.7;
  else if (state.phase === "awaken" || state.phase === "fadeout") rate = 0.35;

  state.sparkSpawnTimer -= dt * rate;
  if (state.sparkSpawnTimer <= 0) {
    state.sparkSpawnTimer = 0.28 + Math.random() * 0.5;
    spawnCrackSpark(state);
  }
  // Periodic vent sparks too, from a random wall vent.
  if (Math.random() < dt * 1.2 * rate) {
    spawnVentSpark(state);
  }

  for (const s of state.crackSparks) s.age += dt;
  state.crackSparks = state.crackSparks.filter((s) => s.age < s.lifetime);

  for (const e of state.embers) {
    e.age += dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vy += 200 * dt;
  }
  state.embers = state.embers.filter((e) => e.age < e.lifetime);

  // Drift dust slowly.
  for (const d of state.dust) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.y < CEILING_Y) {
      d.y = FLOOR_Y - 20;
      d.x = Math.random() * CANVAS_W;
    }
    if (d.x < 0) d.x += CANVAS_W;
    if (d.x > CANVAS_W) d.x -= CANVAS_W;
  }
}

function spawnCrackSpark(state: IntroState): void {
  if (state.floorCracks.length === 0) return;
  const crack = state.floorCracks[Math.floor(Math.random() * state.floorCracks.length)];
  if (crack.pts.length < 2) return;
  const segIdx = Math.floor(Math.random() * (crack.pts.length - 1));
  const t = Math.random();
  const a = crack.pts[segIdx];
  const b = crack.pts[segIdx + 1];
  const origin = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  pushArc(state, origin, -1);
  spawnEmbers(state, origin, 1 + Math.floor(Math.random() * 2));
}

function spawnVentSpark(state: IntroState): void {
  if (state.wallVents.length === 0) return;
  const v = state.wallVents[Math.floor(Math.random() * state.wallVents.length)];
  const origin = {
    x: v.x + v.w / 2,
    y: v.y + Math.random() * v.h,
  };
  // Arc shoots away from the wall (into the room).
  const dirX = v.x < CANVAS_W / 2 ? 1 : -1;
  pushArc(state, origin, dirX);
  spawnEmbers(state, origin, 1);
}

function pushArc(state: IntroState, origin: { x: number; y: number }, dirHint: number): void {
  // dirHint: -1 means upward bias, otherwise horizontal bias based on sign.
  const dirX = dirHint === -1 ? (Math.random() - 0.5) * 0.6 : dirHint * (0.5 + Math.random() * 0.5);
  const dirY = dirHint === -1 ? -1 + (Math.random() - 0.5) * 0.4 : (Math.random() - 0.5) * 0.6;
  const len = 18 + Math.random() * 22;
  const segs = 3 + Math.floor(Math.random() * 3);
  const segLen = len / segs;
  const segments: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let cx = 0;
  let cy = 0;
  for (let s = 0; s < segs; s++) {
    cx += dirX * segLen;
    cy += dirY * segLen;
    cx += (Math.random() - 0.5) * 10;
    cy += (Math.random() - 0.5) * 10;
    segments.push({ x: cx, y: cy });
  }
  state.crackSparks.push({
    origin,
    segments,
    age: 0,
    lifetime: 0.12 + Math.random() * 0.1,
  });
}

function spawnEmbers(state: IntroState, origin: { x: number; y: number }, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * 1.5 + (Math.random() - 0.5) * 1.4;
    const speed = 60 + Math.random() * 140;
    state.embers.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      lifetime: 0.4 + Math.random() * 0.3,
    });
  }
}

function pushTrail(state: IntroState, prevX: number, prevY: number): void {
  state.sparkTrail.push({ x: prevX, y: prevY });
  if (state.sparkTrail.length > 30) state.sparkTrail.shift();
}

function startSparkPath(
  state: IntroState,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  duration: number,
  curl: number,
): void {
  // Drop a Bezier control point perpendicular to the straight line.
  // Sign alternates per call so consecutive paths bend opposite
  // directions, killing the "ruler tracks" feel of straight motion.
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const sign = Math.random() < 0.5 ? -1 : 1;
  const midX = (startX + endX) / 2 + perpX * curl * sign;
  const midY = (startY + endY) / 2 + perpY * curl * sign;
  state.sparkPath = {
    startX,
    startY,
    endX,
    endY,
    cpX: midX,
    cpY: midY,
    duration,
  };
  state.sparkPathT = 0;
}

function advanceSparkPath(
  state: IntroState,
  dt: number,
  easeFn: (t: number) => number,
): boolean {
  const path = state.sparkPath;
  if (!path) return true;
  state.sparkPathT += dt / path.duration;
  const tRaw = Math.min(1, state.sparkPathT);
  const t = easeFn(tRaw);
  const u = 1 - t;
  const prevX = state.sparkX;
  const prevY = state.sparkY;
  state.sparkX =
    u * u * path.startX + 2 * u * t * path.cpX + t * t * path.endX;
  state.sparkY =
    u * u * path.startY + 2 * u * t * path.cpY + t * t * path.endY;
  // Perpendicular wobble — small sinusoidal drift along the path
  // normal so the spark "wavers" while travelling.
  const tanX =
    2 * u * (path.cpX - path.startX) + 2 * t * (path.endX - path.cpX);
  const tanY =
    2 * u * (path.cpY - path.startY) + 2 * t * (path.endY - path.cpY);
  const tlen = Math.hypot(tanX, tanY) || 1;
  const wpx = -tanY / tlen;
  const wpy = tanX / tlen;
  const wobble =
    Math.sin(state.time * 5.5) * 2.5 +
    Math.sin(state.time * 2.3 + 1.1) * 1.5;
  state.sparkX += wpx * wobble;
  state.sparkY += wpy * wobble;
  pushTrail(state, prevX, prevY);
  return tRaw >= 1;
}

function tickHero(state: IntroState, dt: number): void {
  state.heroBreath += dt;
  state.heroFlicker += dt;
  // Drive the game-engine eye every frame so blink/idle-look/breath
  // animations match in-game exactly during the awaken+ phases. The
  // hero position is pinned at the capsule center.
  state.hero.x = CAPSULE_CX;
  state.hero.y = CAPSULE_CY;
  updateEye(state.hero, dt, {
    threat: null,
    size: PLAYER_SIZE,
    dashDurationSec: DASH_DURATION_MS / 1000,
  });
}

// ---- Render ----

export function drawIntro(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
  viewW: number,
  viewH: number,
  dpr: number,
): void {
  // Letterbox 1200×800 inside the viewport.
  const baseScale = Math.min(viewW / CANVAS_W, viewH / CANVAS_H);
  const cam = state.cameraScale;
  const scale = baseScale * cam;
  const renderW = CANVAS_W * scale;
  const renderH = CANVAS_H * scale;
  // Camera shake offset (screen-space pixels, post scale).
  let shakeX = 0;
  let shakeY = 0;
  if (state.cameraShakeRemaining > 0) {
    const t = state.cameraShakeRemaining / Math.max(0.001, state.cameraShakeRemaining);
    shakeX = (Math.random() * 2 - 1) * state.cameraShakeAmount * t;
    shakeY = (Math.random() * 2 - 1) * state.cameraShakeAmount * t;
  }
  const offsetX = (viewW - renderW) / 2 + shakeX;
  const offsetY = (viewH - renderH) / 2 + state.cameraOffsetY * cam + shakeY;

  // Pure black backdrop (covers letterbox bars too).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, viewW, viewH);

  // Canonical canvas space.
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

  // Room base (background → midground → foreground).
  drawRoomBackdrop(ctx);
  drawCeiling(ctx);
  drawWalls(ctx, state);
  drawFloor(ctx, state);
  drawHangingWires(ctx, state);
  drawWallVents(ctx, state);
  drawPipes(ctx, state);
  drawFloorCracks(ctx, state);
  drawAmbientDust(ctx, state);

  // Volumetric light beam from the capsule (when lit) — drawn before
  // the wires so wires appear inside the beam.
  if (state.capsuleGlow > 0.05) drawCapsuleLightBeam(ctx, state);

  // Crack ambience.
  drawCrackArcs(ctx, state);
  drawEmbers(ctx, state);

  // Wires + falling debris.
  drawWires(ctx, state);
  drawLoosePieces(ctx, state);

  // Capsule structure.
  drawSuspensionBracket(ctx, state);
  drawCapsule(ctx, state);

  // Cut flashes — small bright pops at each wire cut.
  drawCutFlashes(ctx, state);

  // Glass shatter shards.
  drawShards(ctx, state);

  // The spark (above the capsule when traveling, inside during merge).
  if (state.sparkActive) drawSpark(ctx, state);

  // Final vignette → emphasises focal point.
  drawVignette(ctx);

  // Bright flashes (mid-cinematic) — drawn before the stage-dark
  // overlay so they don't get muted.
  if (state.shatterFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.55 * state.shatterFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  if (state.mergeFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * state.mergeFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Stage-dark overlay — after the spark merges, the room cuts to
  // near-pure darkness. Holds during blackout, partially lifts during
  // awaken so the eye reads, holds dim through askname, fades to 0
  // by the time the white fadeout takes over.
  const stageDark = computeStageDark(state);
  if (stageDark > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${stageDark})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Hero — drawn AFTER the stage-dark overlay so the body stays
  // visible through the blackout/awaken dim. Before the shatter the
  // hero lives inside the capsule (drawn there); during/after shatter
  // we render it here at the capsule center.
  //   shatter / merge: empty shell (custom)
  //   blackout / awaken / askname / fadeout: in-game hero via
  //     drawPlayerEye, the same renderer used during gameplay.
  if (state.capsuleBroken) {
    if (state.phase === "shatter" || state.phase === "merge") {
      drawHeroOrb(ctx, state);
    } else {
      drawGameHero(ctx, state);
    }
  }

  // Interior white glow — visible from blackout onward as the spark
  // settles into the body. Acts as the "consciousness filling the
  // shell" beat that bridges the empty-shell hero with the awakened
  // in-game hero.
  if (state.interiorWhite > 0) {
    drawInteriorWhite(ctx, state.interiorWhite);
  }

  // "WHO AM I?" — first thought, surfaces in the askname phase above
  // the awakened eye.
  if (state.phase === "askname") drawAskNameText(ctx, state);

  // Final white fade just before redirect.
  if (state.finalFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.finalFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Initial fade-in from black during the very first phase.
  if (state.phase === "fadein") {
    const t = state.phaseTime / PHASE_DURATIONS.fadein;
    const a = 1 - smoothstep(t);
    if (a > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  }

  // Back to screen-space for HUD-style overlays.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawRoomBackdrop(ctx: CanvasRenderingContext2D): void {
  // Very dark base — slight cool tint.
  ctx.fillStyle = "#04070d";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Back wall gradient — a touch lighter in the center, sinking to
  // black at edges. Gives the impression of a wider chamber behind.
  const grad = ctx.createRadialGradient(
    CANVAS_W / 2,
    420,
    50,
    CANVAS_W / 2,
    420,
    700,
  );
  grad.addColorStop(0, "rgba(20, 30, 50, 0.55)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawCeiling(ctx: CanvasRenderingContext2D): void {
  // Dark slab above CEILING_Y.
  ctx.fillStyle = "#02040a";
  ctx.fillRect(0, 0, CANVAS_W, CEILING_Y);
  // Bottom edge — thin neon outline.
  ctx.strokeStyle = "rgba(125, 211, 252, 0.18)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(0, CEILING_Y + 0.5);
  ctx.lineTo(CANVAS_W, CEILING_Y + 0.5);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Ceiling girders — 3 horizontal slats inside the ceiling slab.
  ctx.strokeStyle = "rgba(60, 80, 110, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 16; y <= 56; y += 18) {
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_W, y);
  }
  ctx.stroke();
  // Vertical I-beams at regular spacing.
  ctx.beginPath();
  for (let x = 100; x < CANVAS_W; x += 160) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CEILING_Y - 2);
  }
  ctx.stroke();
  // Hooks where the suspension wires attach.
  for (const wire of WIRES) {
    if (wire.kind !== "suspend") continue;
    const x = wire.bx;
    const y = CEILING_Y;
    ctx.fillStyle = "rgba(180, 200, 230, 0.5)";
    ctx.fillRect(x - 6, y - 4, 12, 8);
    ctx.fillStyle = "rgba(40, 50, 70, 0.85)";
    ctx.fillRect(x - 3, y - 2, 6, 4);
  }
}

function drawWalls(ctx: CanvasRenderingContext2D, _state: IntroState): void {
  // Vertical wall slabs on both sides.
  ctx.fillStyle = "#03050b";
  ctx.fillRect(0, 0, WALL_LEFT_X, CANVAS_H);
  ctx.fillRect(WALL_RIGHT_X, 0, CANVAS_W - WALL_RIGHT_X, CANVAS_H);
  // Neon inside edge.
  ctx.strokeStyle = "rgba(125, 211, 252, 0.18)";
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 6;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(WALL_LEFT_X + 0.5, CEILING_Y);
  ctx.lineTo(WALL_LEFT_X + 0.5, FLOOR_Y);
  ctx.moveTo(WALL_RIGHT_X - 0.5, CEILING_Y);
  ctx.lineTo(WALL_RIGHT_X - 0.5, FLOOR_Y);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Panel seams inside each wall.
  ctx.strokeStyle = "rgba(40, 55, 80, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 110; y < FLOOR_Y; y += 80) {
    ctx.moveTo(0, y);
    ctx.lineTo(WALL_LEFT_X, y);
    ctx.moveTo(WALL_RIGHT_X, y);
    ctx.lineTo(CANVAS_W, y);
  }
  ctx.stroke();
}

function drawFloor(ctx: CanvasRenderingContext2D, _state: IntroState): void {
  // Floor base.
  ctx.fillStyle = "#03060c";
  ctx.fillRect(0, FLOOR_Y, CANVAS_W, CANVAS_H - FLOOR_Y);
  // Top edge — neon seam.
  ctx.strokeStyle = "rgba(125, 211, 252, 0.18)";
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 6;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y + 0.5);
  ctx.lineTo(CANVAS_W, FLOOR_Y + 0.5);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Tile seams — vertical lines suggesting modular tiles.
  ctx.strokeStyle = "rgba(40, 55, 80, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 100; x < CANVAS_W; x += 110) {
    ctx.moveTo(x, FLOOR_Y);
    ctx.lineTo(x, CANVAS_H);
  }
  // Horizontal seam halfway down.
  ctx.moveTo(0, FLOOR_Y + 50);
  ctx.lineTo(CANVAS_W, FLOOR_Y + 50);
  ctx.stroke();
}

function drawWallVents(ctx: CanvasRenderingContext2D, state: IntroState): void {
  for (const v of state.wallVents) {
    // Open hole — darker than wall.
    ctx.fillStyle = "rgba(2, 4, 8, 0.95)";
    ctx.fillRect(v.x, v.y, v.w, v.h);
    // Frame outline (broken panel edge).
    ctx.strokeStyle = "rgba(125, 211, 252, 0.22)";
    ctx.lineWidth = 1;
    ctx.shadowColor = "#7dd3fc";
    ctx.shadowBlur = 4;
    ctx.strokeRect(v.x + 0.5, v.y + 0.5, v.w - 1, v.h - 1);
    ctx.shadowBlur = 0;
    // Internal grid (vent slats / broken cabling lines).
    ctx.strokeStyle = "rgba(60, 80, 110, 0.4)";
    ctx.beginPath();
    for (let y = v.y + 6; y < v.y + v.h - 4; y += 10) {
      ctx.moveTo(v.x + 4, y);
      ctx.lineTo(v.x + v.w - 4, y);
    }
    ctx.stroke();
  }
}

function drawPipes(ctx: CanvasRenderingContext2D, state: IntroState): void {
  for (const p of state.pipes) {
    ctx.strokeStyle = "rgba(60, 80, 110, 0.65)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.ax, p.ay);
    ctx.lineTo(p.bx, p.by);
    ctx.stroke();
    // Highlight stripe down the pipe.
    ctx.strokeStyle = "rgba(125, 211, 252, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.ax, p.ay);
    ctx.lineTo(p.bx, p.by);
    ctx.stroke();
  }
}

function drawHangingWires(ctx: CanvasRenderingContext2D, state: IntroState): void {
  ctx.strokeStyle = "rgba(20, 28, 40, 0.95)";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (const hw of state.hangingWires) {
    // Slight sway based on time.
    const sway = Math.sin(state.time * 0.6 + hw.sway) * 4;
    ctx.beginPath();
    ctx.moveTo(hw.x, hw.y1);
    ctx.bezierCurveTo(
      hw.x + sway, hw.y1 + (hw.y2 - hw.y1) * 0.35,
      hw.x + sway * 1.4, hw.y1 + (hw.y2 - hw.y1) * 0.7,
      hw.x + sway * 1.6, hw.y2,
    );
    ctx.stroke();
  }
}

function drawFloorCracks(ctx: CanvasRenderingContext2D, state: IntroState): void {
  ctx.save();
  ctx.strokeStyle = "rgba(8, 12, 22, 0.95)";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.shadowBlur = 0;
  for (const c of state.floorCracks) {
    if (c.pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(c.pts[0].x, c.pts[0].y);
    for (let i = 1; i < c.pts.length; i++) {
      ctx.lineTo(c.pts[i].x, c.pts[i].y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawAmbientDust(ctx: CanvasRenderingContext2D, state: IntroState): void {
  ctx.save();
  ctx.shadowBlur = 0;
  for (const d of state.dust) {
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
  }
  ctx.restore();
}

function drawCrackArcs(ctx: CanvasRenderingContext2D, state: IntroState): void {
  if (state.crackSparks.length === 0) return;
  ctx.save();
  ctx.strokeStyle = "#a5f3fc";
  ctx.shadowColor = "#a5f3fc";
  ctx.shadowBlur = 14;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const a of state.crackSparks) {
    const u = a.age / a.lifetime;
    const alpha = u < 0.35 ? 1 : Math.max(0, 1 - (u - 0.35) / 0.65);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(a.origin.x, a.origin.y);
    for (const s of a.segments) {
      ctx.lineTo(a.origin.x + s.x, a.origin.y + s.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawEmbers(ctx: CanvasRenderingContext2D, state: IntroState): void {
  if (state.embers.length === 0) return;
  ctx.save();
  ctx.fillStyle = "#a5f3fc";
  ctx.shadowColor = "#a5f3fc";
  ctx.shadowBlur = 8;
  for (const e of state.embers) {
    const u = e.age / e.lifetime;
    ctx.globalAlpha = 1 - u;
    ctx.fillRect(e.x - 1, e.y - 1, 2, 2);
  }
  ctx.restore();
}

function drawWires(ctx: CanvasRenderingContext2D, state: IntroState): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < WIRES.length; i++) {
    const w = WIRES[i];
    const s = state.wires[i];
    // The wire's visible range. When the rope is fully released
    // (post-sever), only the anchor-side stub stays; we still draw
    // it up to the cut point so the connector at the ceiling /
    // sidewall reads as "leftover hardware".
    const endT = s.cut ? CUT_T : 1;
    drawWireSegment(ctx, w, 0, endT, s, i, state);
    // Connector at the capsule attach point — only while the wire
    // hasn't been cut.
    if (!s.cut) drawCapsuleConnector(ctx, w);
    // Connector stub at the anchor end (visible regardless of cut
    // state — represents the bolt where the wire enters the wall /
    // ceiling).
    drawAnchorConnector(ctx, w);
  }
  ctx.restore();
}

function drawWireSegment(
  ctx: CanvasRenderingContext2D,
  wire: WireSpec,
  startT: number,
  endT: number,
  s: WireState,
  wireIndex: number,
  state: IntroState,
): void {
  // Sample the wire once + cache tangents so the four passes (dark
  // outer / mid / highlight / ribs) all use the same geometry.
  const samples = 26;
  type S = { p: { x: number; y: number }; t: { x: number; y: number } };
  const pts: S[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = startT + (endT - startT) * (i / samples);
    pts.push({ p: wireBezier(wire, t), t: wireBezierTangent(wire, t) });
  }

  // Outer casing — thick dark stroke.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(14, 20, 32, 0.97)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(pts[0].p.x, pts[0].p.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].p.x, pts[i].p.y);
  ctx.stroke();

  // Mid stroke — slightly lighter, narrower, sells depth.
  ctx.strokeStyle = "rgba(48, 60, 84, 0.75)";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(pts[0].p.x, pts[0].p.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].p.x, pts[i].p.y);
  ctx.stroke();

  // Highlight on the upper-left side (offset perpendicular to tangent).
  // The "side" we pick is consistent across the curve so the highlight
  // tracks a single edge.
  ctx.strokeStyle = "rgba(125, 160, 200, 0.45)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const px = pts[i].p.x + -pts[i].t.y * 1.4;
    const py = pts[i].p.y + pts[i].t.x * 1.4;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Rib ticks at regular t-intervals — short perpendicular slashes
  // that sell cable segmentation.
  ctx.strokeStyle = "rgba(2, 6, 12, 0.85)";
  ctx.lineWidth = 1;
  const ribStep = Math.max(2, Math.floor(samples / 9));
  for (let i = ribStep; i < pts.length - 1; i += ribStep) {
    const { p, t } = pts[i];
    const nx = -t.y;
    const ny = t.x;
    ctx.beginPath();
    ctx.moveTo(p.x - nx * 3.2, p.y - ny * 3.2);
    ctx.lineTo(p.x + nx * 3.2, p.y + ny * 3.2);
    ctx.stroke();
  }

  // Pre-cut glow + sever visuals — only on the active wire.
  const isActive =
    state.phase === "cutting" && wireIndex === state.cuttingWireIndex;
  if (isActive && state.cuttingSubPhase === "travel" && !s.cut) {
    const t = Math.min(1, state.cuttingSubAge / 0.5);
    const cp = wireBezier(wire, CUT_T);
    ctx.shadowColor = "#a5f3fc";
    ctx.shadowBlur = 14 * t;
    ctx.strokeStyle = `rgba(165, 243, 252, ${0.5 * t})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 6 + t * 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (isActive && state.cuttingSubPhase === "sever" && !s.cut) {
    drawSeverEffect(ctx, wire, state.cuttingSubAge / SEVER_DURATION_SEC);
  }
  // After cut, while sever animation is still active on the stub, keep
  // the molten cut edge glowing for a moment more.
  if (s.cut && s.cutMeltAge >= 0) {
    const t = s.cutMeltAge / SEVER_DURATION_SEC;
    drawSeverEffect(ctx, wire, t);
  }
}

function drawSeverEffect(
  ctx: CanvasRenderingContext2D,
  wire: WireSpec,
  meltT: number,
): void {
  // The molten cut: a hot blob centered on the cut point, plus a
  // perpendicular sever line that grows then fades.
  const cp = wireBezier(wire, CUT_T);
  const tan = wireBezierTangent(wire, CUT_T);
  const nx = -tan.y;
  const ny = tan.x;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Hot blob — grows for 60% of the phase then fades.
  const blobT = Math.min(1, meltT * 1.4);
  const blobAlpha = meltT < 0.55 ? 1 : Math.max(0, 1 - (meltT - 0.55) / 0.45);
  const blobR = 6 + blobT * 10;
  const blob = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, blobR);
  blob.addColorStop(0, `rgba(255, 255, 255, ${0.95 * blobAlpha})`);
  blob.addColorStop(0.45, `rgba(165, 243, 252, ${0.55 * blobAlpha})`);
  blob.addColorStop(1, "rgba(0, 229, 255, 0)");
  ctx.fillStyle = blob;
  ctx.beginPath();
  ctx.arc(cp.x, cp.y, blobR, 0, Math.PI * 2);
  ctx.fill();
  // Sever line — perpendicular to wire, ±10 px at peak, fades out.
  const lineLen = 4 + meltT * 14;
  const lineAlpha = meltT < 0.4 ? meltT / 0.4 : Math.max(0, 1 - (meltT - 0.4) / 0.6);
  ctx.strokeStyle = `rgba(255, 255, 255, ${lineAlpha})`;
  ctx.shadowColor = "#a5f3fc";
  ctx.shadowBlur = 12;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cp.x - nx * lineLen, cp.y - ny * lineLen);
  ctx.lineTo(cp.x + nx * lineLen, cp.y + ny * lineLen);
  ctx.stroke();
  ctx.restore();
}

function drawCapsuleConnector(
  ctx: CanvasRenderingContext2D,
  wire: WireSpec,
): void {
  // A small metallic plug at the capsule attach point oriented along
  // the wire's tangent.
  const tan = wireBezierTangent(wire, 1);
  ctx.save();
  ctx.translate(wire.ax, wire.ay);
  ctx.rotate(Math.atan2(tan.y, tan.x));
  // Cylinder body
  ctx.fillStyle = "rgba(48, 62, 88, 0.95)";
  ctx.fillRect(-7, -5, 14, 10);
  // Inner darker slot
  ctx.fillStyle = "rgba(8, 12, 22, 0.95)";
  ctx.fillRect(-5, -3, 4, 6);
  // Bolt heads on either side
  ctx.fillStyle = "rgba(140, 160, 190, 0.6)";
  ctx.beginPath();
  ctx.arc(3, -3, 1.4, 0, Math.PI * 2);
  ctx.arc(3, 3, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAnchorConnector(
  ctx: CanvasRenderingContext2D,
  wire: WireSpec,
): void {
  // The anchor end already shows hooks (for suspend wires) drawn in
  // the ceiling pass. For feeds going into the wall, draw a small
  // bolt cap so the wire visibly "plugs in".
  if (wire.kind === "feed") {
    ctx.save();
    ctx.fillStyle = "rgba(48, 62, 88, 0.95)";
    const isLeft = wire.bx < CANVAS_W / 2;
    const w = 12;
    const h = 8;
    const x = wire.bx - (isLeft ? w : 0);
    const y = wire.by - h / 2;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(140, 160, 190, 0.55)";
    ctx.beginPath();
    ctx.arc(x + (isLeft ? 3 : w - 3), y + h / 2, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function wireBezier(w: WireSpec, t: number): { x: number; y: number } {
  // t = 0 at anchor end (bx, by), t = 1 at capsule end (ax, ay).
  const cpX = (w.ax + w.bx) / 2;
  const cpY = (w.ay + w.by) / 2 + w.cpYOffset;
  const u = 1 - t;
  const x = u * u * w.bx + 2 * u * t * cpX + t * t * w.ax;
  const y = u * u * w.by + 2 * u * t * cpY + t * t * w.ay;
  return { x, y };
}

function wireBezierTangent(w: WireSpec, t: number): { x: number; y: number } {
  // Quadratic Bezier derivative, then normalised. P0 = (bx,by),
  // P1 = control point, P2 = (ax,ay), with t=0 at P0 and t=1 at P2.
  const cpX = (w.ax + w.bx) / 2;
  const cpY = (w.ay + w.by) / 2 + w.cpYOffset;
  const tx = 2 * (1 - t) * (cpX - w.bx) + 2 * t * (w.ax - cpX);
  const ty = 2 * (1 - t) * (cpY - w.by) + 2 * t * (w.ay - cpY);
  const len = Math.hypot(tx, ty) || 1;
  return { x: tx / len, y: ty / len };
}

function drawLoosePieces(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < state.wires.length; i++) {
    const s = state.wires[i];
    if (!s.looseNodes || s.loosePieceAge < 0) continue;
    const nodes = s.looseNodes;
    // Fade across ~1.8 s so the wire visibly settles before vanishing.
    const u = Math.min(1, s.loosePieceAge / 1.8);
    ctx.globalAlpha = 1 - u;
    // Outer casing.
    ctx.strokeStyle = "rgba(14, 20, 32, 0.97)";
    ctx.lineWidth = 4.4;
    ctx.shadowBlur = 0;
    drawPolyline(ctx, nodes);
    // Mid stroke.
    ctx.strokeStyle = "rgba(48, 60, 84, 0.75)";
    ctx.lineWidth = 2.3;
    drawPolyline(ctx, nodes);
    // Bright cut-end glow on the last node — fades quickly as the
    // freshly severed end cools.
    const cutEnd = nodes[nodes.length - 1];
    const glowT = Math.max(0, 1 - s.loosePieceAge / 0.6);
    if (glowT > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * glowT})`;
      ctx.shadowColor = "#a5f3fc";
      ctx.shadowBlur = 10 * glowT;
      ctx.beginPath();
      ctx.arc(cutEnd.x, cutEnd.y, 2.4 + glowT * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  ctx.restore();
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  nodes: RopeNode[],
): void {
  if (nodes.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  // Use quadratic curve smoothing between adjacent nodes for a softer
  // line — the verlet chain points are visibly polygonal otherwise.
  for (let i = 1; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    ctx.quadraticCurveTo(a.x, a.y, mx, my);
  }
  // Last segment straight to the end node.
  ctx.lineTo(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y);
  ctx.stroke();
}

function drawCapsuleLightBeam(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Volumetric cone-shaped halo. Stronger when capsule is bright.
  const a = state.capsuleGlow * 0.55;
  const grad = ctx.createRadialGradient(
    CAPSULE_CX,
    CAPSULE_CY,
    20,
    CAPSULE_CX,
    CAPSULE_CY,
    340,
  );
  grad.addColorStop(0, `rgba(0, 229, 255, ${0.35 * a})`);
  grad.addColorStop(0.5, `rgba(0, 229, 255, ${0.08 * a})`);
  grad.addColorStop(1, "rgba(0, 229, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawSuspensionBracket(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
): void {
  if (state.capsuleBroken) return;
  // The bracket that holds the capsule from the wires.
  ctx.save();
  // Bracket bar.
  ctx.fillStyle = "rgba(40, 55, 80, 0.95)";
  ctx.fillRect(CAPSULE_CX - BRACKET_W / 2, BRACKET_Y - BRACKET_H / 2, BRACKET_W, BRACKET_H);
  // Top edge highlight.
  ctx.fillStyle = "rgba(125, 211, 252, 0.25)";
  ctx.fillRect(CAPSULE_CX - BRACKET_W / 2, BRACKET_Y - BRACKET_H / 2, BRACKET_W, 2);
  // Three bolt heads.
  ctx.fillStyle = "rgba(165, 180, 210, 0.55)";
  for (const dx of [-22, 0, 22]) {
    ctx.beginPath();
    ctx.arc(CAPSULE_CX + dx, BRACKET_Y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Stem from bracket down to capsule top.
  ctx.strokeStyle = "rgba(40, 55, 80, 0.95)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(CAPSULE_CX, BRACKET_Y + BRACKET_H / 2);
  ctx.lineTo(CAPSULE_CX, CAPSULE_CY - CAPSULE_RY - 2);
  ctx.stroke();
  ctx.restore();
}

function drawCapsule(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Once the capsule has shattered, the only remains are the chunks
  // and the hero — both drawn elsewhere.
  if (state.capsuleBroken) return;

  ctx.save();
  // Outer shell — translucent dark fill behind everything.
  ctx.fillStyle = "rgba(6, 10, 18, 0.92)";
  ctx.beginPath();
  ctx.ellipse(CAPSULE_CX, CAPSULE_CY, CAPSULE_RX, CAPSULE_RY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Inner glow (radial gradient from center).
  if (state.capsuleGlow > 0.02) {
    const grad = ctx.createRadialGradient(
      CAPSULE_CX,
      CAPSULE_CY,
      0,
      CAPSULE_CX,
      CAPSULE_CY,
      CAPSULE_RX * 1.4,
    );
    grad.addColorStop(0, `rgba(0, 229, 255, ${0.4 * state.capsuleGlow})`);
    grad.addColorStop(1, "rgba(0, 229, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(CAPSULE_CX, CAPSULE_CY, CAPSULE_RX * 1.2, CAPSULE_RY * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The hero inside.
  drawHeroOrb(ctx, state);

  // Glass overlay — outer bright outline + a couple of inner contour
  // rings sells "glass tube".
  ctx.strokeStyle = `rgba(125, 211, 252, ${0.55 + state.capsuleGlow * 0.35})`;
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = state.capsuleGlow > 0 ? 14 : 4;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(CAPSULE_CX, CAPSULE_CY, CAPSULE_RX, CAPSULE_RY, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Inner contour — suggests the glass has thickness.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(125, 211, 252, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(CAPSULE_CX, CAPSULE_CY, CAPSULE_RX * 0.92, CAPSULE_RY * 0.95, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Holo readout strip at the bottom of the capsule — tiny ticks.
  ctx.fillStyle = `rgba(125, 211, 252, ${0.25 + state.capsuleGlow * 0.25})`;
  for (let i = -3; i <= 3; i++) {
    const ticked = (Math.floor(state.time * 4) % 7 === i + 3);
    ctx.globalAlpha = ticked ? 0.9 : 0.4;
    ctx.fillRect(CAPSULE_CX + i * 7 - 2, CAPSULE_CY + CAPSULE_RY - 16, 4, 3);
  }
  ctx.globalAlpha = 1;

  // Capsule cracks — only during shatter phase, ramp in via crackProgress.
  if (state.phase === "shatter" && state.crackProgress > 0) {
    drawCapsuleCracks(ctx, state);
  } else if (state.crackProgress > 0) {
    drawCapsuleCracks(ctx, state);
  }

  ctx.restore();
}

function drawCapsuleCracks(ctx: CanvasRenderingContext2D, state: IntroState): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const c of state.capsuleCracks) {
    if (state.crackProgress < c.appearAt) continue;
    const localT = Math.min(1, (state.crackProgress - c.appearAt) / (1 - c.appearAt));
    // White core stroke + cyan glow.
    ctx.shadowColor = "#a5f3fc";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * localT})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const lastIdx = Math.max(1, Math.floor(c.pts.length * localT));
    ctx.moveTo(c.pts[0].x, c.pts[0].y);
    for (let i = 1; i <= lastIdx && i < c.pts.length; i++) {
      ctx.lineTo(c.pts[i].x, c.pts[i].y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawHeroOrb(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Empty-shell hero. Dormant state shows only the outer ring with
  // pure darkness inside — the body is a vessel, vacant. As the spark
  // merges (eyeOpen rises), the inner darkness gives way to an iris
  // and pupil; the body becomes the awakened eye-orb seen in-game.
  ctx.save();
  ctx.translate(CAPSULE_CX, CAPSULE_CY);

  // Subtle breathing only while fully dormant — the empty shell still
  // pulses faintly under stasis.
  const dormant = state.eyeOpen < 0.05;
  const breath = dormant ? 1 + Math.sin(state.heroBreath * 1.6) * 0.025 : 1;
  ctx.scale(breath, breath);

  // Inner void — dark fill that occupies the shell interior when
  // dormant. Fades out as the iris fills in.
  const voidAlpha = 1 - state.eyeOpen;
  if (voidAlpha > 0) {
    ctx.fillStyle = `rgba(2, 4, 8, ${0.85 * voidAlpha})`;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, HERO_OUTER_R - 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer ring — dim white outline when dormant, brightens on awaken.
  const ringAlpha = 0.45 + state.eyeOpen * 0.55;
  ctx.strokeStyle = `rgba(255, 255, 255, ${ringAlpha})`;
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = state.eyeOpen > 0.4 ? 12 : 3;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, HERO_OUTER_R, 0, Math.PI * 2);
  ctx.stroke();

  // Iris reveal — only once the spark has begun merging (eyeOpen > 0).
  // The iris is drawn at full circular shape but with alpha tied to
  // eyeOpen, so it FILLS IN rather than opening like an eyelid (which
  // suited the previous design but didn't match "spark filling an
  // empty shell").
  if (state.eyeOpen > 0.02) {
    const irisAlpha = Math.min(1, state.eyeOpen * 1.1);
    ctx.fillStyle = `rgba(125, 211, 252, ${0.85 * irisAlpha})`;
    ctx.shadowColor = "#7dd3fc";
    ctx.shadowBlur = 10 * irisAlpha;
    ctx.beginPath();
    ctx.arc(0, 0, HERO_IRIS_R, 0, Math.PI * 2);
    ctx.fill();
    // Iris outline
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * irisAlpha})`;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, HERO_IRIS_R, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Pupil — appears in the second half of the awakening, scales in.
  if (state.eyeOpen > 0.45) {
    const pupilT = (state.eyeOpen - 0.45) / 0.55;
    ctx.fillStyle = `rgba(10, 14, 26, ${pupilT})`;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, HERO_PUPIL_R * (0.55 + pupilT * 0.45), 0, Math.PI * 2);
    ctx.fill();
  }

  // Awaken halo — bright cyan glow once the eye is mostly filled.
  if (state.eyeOpen > 0.65) {
    const t = (state.eyeOpen - 0.65) / 0.35;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, HERO_OUTER_R * 3.5);
    halo.addColorStop(0, `rgba(0, 229, 255, ${0.55 * t})`);
    halo.addColorStop(1, "rgba(0, 229, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, HERO_OUTER_R * 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShards(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Big shell chunks — curved glass slivers, polygon strokes + fills.
  if (state.shards.length > 0) {
    ctx.save();
    for (const s of state.shards) {
      const u = s.age / s.lifetime;
      // Hold full opacity for 80% of the lifetime; fade only at the
      // very end. Chunks settle and remain visible through askname
      // rather than dissolving mid-fall.
      const alpha = u < 0.8 ? 1 : Math.max(0, 1 - (u - 0.8) / 0.2);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      // Fill — translucent cyan glass with a subtle inner gradient.
      ctx.fillStyle = "rgba(70, 140, 200, 0.35)";
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(s.verts[0].x, s.verts[0].y);
      for (let i = 1; i < s.verts.length; i++) {
        ctx.lineTo(s.verts[i].x, s.verts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      // Outer rim — bright (this was the glowing capsule outline).
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.85})`;
      ctx.shadowColor = "#7dd3fc";
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Smaller glass motes — fast little dust + sparkles.
  if (state.glassMotes.length > 0) {
    ctx.save();
    ctx.shadowColor = "#a5f3fc";
    ctx.shadowBlur = 8;
    for (const m of state.glassMotes) {
      const u = m.age / m.lifetime;
      const alpha = 1 - u;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fillRect(m.x - m.size / 2, m.y - m.size / 2, m.size, m.size);
    }
    ctx.restore();
  }
}

function drawCutFlashes(ctx: CanvasRenderingContext2D, state: IntroState): void {
  if (state.cutFlashes.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const f of state.cutFlashes) {
    const u = f.age / 0.35;
    const r = 6 + u * 60;
    const a = 1 - u;
    const halo = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    halo.addColorStop(0, `rgba(255, 255, 255, ${0.9 * a})`);
    halo.addColorStop(0.4, `rgba(165, 243, 252, ${0.6 * a})`);
    halo.addColorStop(1, "rgba(0, 229, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Soft trail — softer alpha falloff, longer perceptual tail.
  if (state.sparkTrail.length > 1) {
    ctx.save();
    ctx.shadowColor = "#a5f3fc";
    ctx.shadowBlur = 14;
    ctx.lineCap = "round";
    for (let i = 1; i < state.sparkTrail.length; i++) {
      const t = i / state.sparkTrail.length;
      ctx.strokeStyle = `rgba(180, 230, 255, ${t * 0.45 * state.sparkBrightness})`;
      ctx.lineWidth = 0.8 + t * 2.6;
      const p0 = state.sparkTrail[i - 1];
      const p1 = state.sparkTrail[i];
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  const b = state.sparkBrightness;
  if (b <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Two soft halo layers — no hot core, no defined inner ring. The
  // spark reads as a glowing wisp rather than a sharp pinpoint.
  const haloBig = 70 * b;
  const haloMid = 32 * b;
  const big = ctx.createRadialGradient(
    state.sparkX,
    state.sparkY,
    0,
    state.sparkX,
    state.sparkY,
    haloBig,
  );
  big.addColorStop(0, `rgba(165, 243, 252, ${0.28 * b})`);
  big.addColorStop(0.45, `rgba(125, 211, 252, ${0.12 * b})`);
  big.addColorStop(1, "rgba(125, 211, 252, 0)");
  ctx.fillStyle = big;
  ctx.beginPath();
  ctx.arc(state.sparkX, state.sparkY, haloBig, 0, Math.PI * 2);
  ctx.fill();

  const mid = ctx.createRadialGradient(
    state.sparkX,
    state.sparkY,
    0,
    state.sparkX,
    state.sparkY,
    haloMid,
  );
  mid.addColorStop(0, `rgba(220, 245, 255, ${0.55 * b})`);
  mid.addColorStop(0.6, `rgba(165, 243, 252, ${0.2 * b})`);
  mid.addColorStop(1, "rgba(165, 243, 252, 0)");
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.arc(state.sparkX, state.sparkY, haloMid, 0, Math.PI * 2);
  ctx.fill();

  // A handful of very soft, wispy filaments — short curls that drift
  // organically (offsets keyed to time, not random per frame). They
  // hint at energy without reading as sharp lightning.
  ctx.strokeStyle = `rgba(200, 240, 255, ${0.32 * b})`;
  ctx.shadowColor = "#a5f3fc";
  ctx.shadowBlur = 10;
  ctx.lineWidth = 0.9;
  ctx.lineCap = "round";
  const filaments = 3;
  for (let i = 0; i < filaments; i++) {
    const base = (i / filaments) * Math.PI * 2;
    const angle = base + state.time * 0.8 + i * 0.7;
    const len = 16 + Math.sin(state.time * 2 + i) * 4;
    let cx = state.sparkX;
    let cy = state.sparkY;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const segs = 5;
    for (let s = 1; s <= segs; s++) {
      const u = s / segs;
      const swirl = Math.sin(u * Math.PI * 1.5 + state.time * 1.4) * 4;
      cx = state.sparkX + Math.cos(angle) * len * u + Math.cos(angle + Math.PI / 2) * swirl;
      cy = state.sparkY + Math.sin(angle) * len * u + Math.sin(angle + Math.PI / 2) * swirl;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawGameHero(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Use the canonical in-game eye renderer so the awakened body
  // matches gameplay 1:1. closeAmount on the Player struct drives the
  // open/close animation; we toggle isClosing=false on awaken entry
  // and updateEye handles the smooth ramp.
  drawPlayerEye(ctx, state.hero, PLAYER_SIZE, {
    ringColor: state.heroProfile.outerRing,
    pupilColor: state.heroProfile.pupil,
    ghostColor: state.heroProfile.outerRing,
    dashDurationSec: DASH_DURATION_MS / 1000,
    dashCooldownSec: DASH_COOLDOWN_MS / 1000,
    profile: state.heroProfile,
  });
}

function drawInteriorWhite(ctx: CanvasRenderingContext2D, alpha: number): void {
  // Soft radial white glow sized to fit inside the hero outline. Acts
  // as the "consciousness filling the body from inside" beat —
  // visible through the closed eye during blackout, fades as the iris
  // opens.
  const r = HERO_OUTER_R * 1.4;
  const grad = ctx.createRadialGradient(
    CAPSULE_CX,
    CAPSULE_CY,
    0,
    CAPSULE_CX,
    CAPSULE_CY,
    r,
  );
  grad.addColorStop(0, `rgba(255, 255, 255, ${0.95 * alpha})`);
  grad.addColorStop(0.55, `rgba(255, 255, 255, ${0.45 * alpha})`);
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(CAPSULE_CX, CAPSULE_CY, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function computeStageDark(state: IntroState): number {
  // Final dim level held through askname; awaken fades from full
  // black into that dim level over its duration.
  const HOLD_DARK = 0.62;
  switch (state.phase) {
    case "blackout":
      return 1;
    case "awaken": {
      const t = state.phaseTime / PHASE_DURATIONS.awaken;
      return 1 - (1 - HOLD_DARK) * smoothstep(t);
    }
    case "askname":
      return HOLD_DARK;
    case "fadeout": {
      const t = state.phaseTime / PHASE_DURATIONS.fadeout;
      return Math.max(0, HOLD_DARK - HOLD_DARK * t);
    }
    default:
      return 0;
  }
}

function drawAskNameText(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Fade in over 0.6 s, hold, fade out at the tail of the phase.
  const t = state.phaseTime / PHASE_DURATIONS.askname;
  const fadeIn = 0.25;
  const fadeOut = 0.85;
  let alpha = 1;
  if (t < fadeIn) alpha = t / fadeIn;
  else if (t > fadeOut) alpha = Math.max(0, 1 - (t - fadeOut) / (1 - fadeOut));
  if (alpha <= 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Centred above the eye. Letter-spacing-like effect through manual
  // tracking — Orbitron with extra space reads as a cold internal
  // voice rather than overlaid UI.
  const text = "WHO AM I?";
  ctx.font = "500 38px Orbitron, ui-monospace, monospace";
  ctx.globalAlpha = alpha * 0.95;
  // Soft glow pass.
  ctx.shadowColor = "#a5f3fc";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText(text, CAPSULE_CX, CAPSULE_CY - 140);
  // Crisp pass.
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, CAPSULE_CX, CAPSULE_CY - 140);
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createRadialGradient(
    CANVAS_W / 2,
    CANVAS_H / 2,
    240,
    CANVAS_W / 2,
    CANVAS_H / 2,
    700,
  );
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.7)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// ---- Util ----

function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---- Skip ----

export const MIN_WATCH_BEFORE_SKIP_SEC = 2.0;

export function trySkipIntro(state: IntroState): boolean {
  if (state.time < MIN_WATCH_BEFORE_SKIP_SEC) return false;
  if (state.phase === "fadeout") return false;
  state.phase = "fadeout";
  state.phaseTime = 0;
  state.finalFlash = 0;
  return true;
}

export const TOTAL_DURATION_SEC = PHASE_ORDER.reduce(
  (acc, p) => acc + PHASE_DURATIONS[p],
  0,
);
