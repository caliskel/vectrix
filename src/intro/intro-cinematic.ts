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
  // Three suspension cables to the ceiling brackets.
  { ax: CAPSULE_CX - 22, ay: BRACKET_Y + 4, bx: 280,  by: CEILING_Y - 4, cpYOffset: -90, kind: "suspend" },
  { ax: CAPSULE_CX,      ay: BRACKET_Y - 2, bx: 600,  by: CEILING_Y - 4, cpYOffset: -110, kind: "suspend" },
  { ax: CAPSULE_CX + 22, ay: BRACKET_Y + 4, bx: 920,  by: CEILING_Y - 4, cpYOffset: -90, kind: "suspend" },
  // Two network feeds dropping to/from the wall.
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
  | "awaken"
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
  "awaken",
  "fadeout",
];

const PHASE_DURATIONS: Record<PhaseId, number> = {
  fadein: 2.5,
  establish: 3.5,
  lightsdie: 2.0,
  silence: 1.5,
  sparkenters: 2.0,
  cutting: 4.5,
  shatter: 1.5,
  merge: 1.5,
  awaken: 1.8,
  fadeout: 0.6,
};

// ---- Types ----
type WireSpec = {
  ax: number; ay: number;
  bx: number; by: number;
  cpYOffset: number;
  kind: "suspend" | "feed";
};

type WireState = {
  cut: boolean;
  loosePieceAge: number;
  loosePieceVy: number;
  loosePieceYOffset: number;
  loosePieceRot: number;
  preCutGlowAge: number; // ramps up just before the cut
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
  x: number; y: number;
  vx: number; vy: number;
  rot: number; rotVel: number;
  age: number; lifetime: number;
  size: number;
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

  // Spark of light
  sparkX: number;
  sparkY: number;
  sparkActive: boolean;
  sparkTrail: { x: number; y: number }[];
  sparkBrightness: number;

  // Cutting sub-state
  cuttingWireIndex: number;
  cuttingSubPhase: "travel" | "flash" | "rest";
  cuttingSubAge: number;

  // Capsule shatter
  shards: Shard[];
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
      loosePieceAge: -1,
      loosePieceVy: 0,
      loosePieceYOffset: 0,
      loosePieceRot: 0,
      preCutGlowAge: -1,
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
    cuttingWireIndex: 0,
    cuttingSubPhase: "travel",
    cuttingSubAge: 0,
    shards: [],
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
      state.sparkX = CANVAS_W + 60;
      state.sparkY = -40;
      state.sparkBrightness = 0;
      state.sparkTrail = [];
      state.cameraTargetScale = 1.06;
      break;
    case "cutting":
      state.cuttingWireIndex = 0;
      state.cuttingSubPhase = "travel";
      state.cuttingSubAge = 0;
      state.cameraTargetScale = 1.1;
      break;
    case "shatter":
      state.shards = buildShatterShards();
      state.shatterFlash = 1;
      state.capsuleBroken = true;
      state.crackProgress = 1; // freeze cracks at max for the flash moment
      triggerShake(state, 16, 0.5);
      state.cameraTargetScale = 1.15;
      break;
    case "merge":
      state.cameraTargetScale = 1.18;
      break;
    case "awaken":
      state.mergeFlash = 1;
      state.cameraTargetScale = 1.0;
      triggerShake(state, 8, 0.4);
      break;
    case "fadeout":
      state.finalFlash = 0;
      state.cameraTargetScale = 0.98;
      break;
  }
}

function triggerShake(state: IntroState, amount: number, duration: number): void {
  state.cameraShakeAmount = amount;
  state.cameraShakeRemaining = duration;
}

function buildShatterShards(): Shard[] {
  const shards: Shard[] = [];
  const count = 22;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const speed = 200 + Math.random() * 220;
    shards.push({
      x: CAPSULE_CX + Math.cos(angle) * CAPSULE_RX * 0.85,
      y: CAPSULE_CY + Math.sin(angle) * CAPSULE_RY * 0.85,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      rot: Math.random() * Math.PI * 2,
      rotVel: (Math.random() - 0.5) * 12,
      age: 0,
      lifetime: 1.6 + Math.random() * 0.6,
      size: 4 + Math.random() * 7,
    });
  }
  return shards;
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
      const targetX = CAPSULE_CX + 240;
      const targetY = CAPSULE_CY - 260;
      const eased = easeOutCubic(t);
      const prevX = state.sparkX;
      const prevY = state.sparkY;
      state.sparkX = (CANVAS_W + 60) + (targetX - (CANVAS_W + 60)) * eased;
      state.sparkY = -40 + (targetY - -40) * eased;
      state.sparkBrightness = Math.min(1, t * 1.6);
      pushTrail(state, prevX, prevY);
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
      const t = state.phaseTime / PHASE_DURATIONS.shatter;
      const eased = easeInOutCubic(t);
      const prevX = state.sparkX;
      const prevY = state.sparkY;
      state.sparkX = lerp(state.sparkX, CAPSULE_CX + 50, eased * 0.7);
      state.sparkY = lerp(state.sparkY, CAPSULE_CY - 30, eased * 0.7);
      pushTrail(state, prevX, prevY);
      break;
    }
    case "merge": {
      tickShards(state, dt);
      const t = state.phaseTime / PHASE_DURATIONS.merge;
      const eased = easeInOutCubic(t);
      const prevX = state.sparkX;
      const prevY = state.sparkY;
      state.sparkX = lerp(state.sparkX, CAPSULE_CX, eased);
      state.sparkY = lerp(state.sparkY, CAPSULE_CY, eased);
      state.sparkBrightness = 1 + t * 2.0;
      pushTrail(state, prevX, prevY);
      if (t > 0.85) {
        state.mergeFlash = (t - 0.85) / 0.15;
      }
      break;
    }
    case "awaken": {
      tickShards(state, dt);
      state.mergeFlash = Math.max(0, state.mergeFlash - dt * 1.6);
      const t = state.phaseTime / PHASE_DURATIONS.awaken;
      // Eye opens with ease-out — slit → oval → full.
      state.eyeOpen = easeOutCubic(Math.min(1, t * 1.3));
      state.sparkX = CAPSULE_CX;
      state.sparkY = CAPSULE_CY;
      state.sparkBrightness = Math.max(0, 1.8 - t * 1.8);
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

function tickCutting(state: IntroState, dt: number): void {
  if (state.cuttingWireIndex >= WIRES.length) return;
  const wire = WIRES[state.cuttingWireIndex];
  const cutT = 0.42;
  const cp = wireBezier(wire, cutT);
  state.cuttingSubAge += dt;
  switch (state.cuttingSubPhase) {
    case "travel": {
      const TRAVEL_SEC = 0.45;
      const t = Math.min(1, state.cuttingSubAge / TRAVEL_SEC);
      const eased = easeInOutCubic(t);
      const prevX = state.sparkX;
      const prevY = state.sparkY;
      state.sparkX = lerp(state.sparkX, cp.x, eased);
      state.sparkY = lerp(state.sparkY, cp.y, eased);
      pushTrail(state, prevX, prevY);
      // Wire's "pre-cut glow" lights up as the spark approaches.
      state.wires[state.cuttingWireIndex].preCutGlowAge = state.cuttingSubAge;
      if (state.cuttingSubAge >= TRAVEL_SEC) {
        state.cuttingSubPhase = "flash";
        state.cuttingSubAge = 0;
        const w = state.wires[state.cuttingWireIndex];
        w.cut = true;
        w.loosePieceAge = 0;
        w.loosePieceVy = -20;
        w.loosePieceYOffset = 0;
        w.loosePieceRot = 0;
        state.cutFlashes.push({ x: cp.x, y: cp.y, age: 0 });
        triggerShake(state, 4, 0.18);
        // Spawn 6-8 sparks from the cut point.
        for (let k = 0; k < 7; k++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 80 + Math.random() * 160;
          state.embers.push({
            x: cp.x,
            y: cp.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            age: 0,
            lifetime: 0.5 + Math.random() * 0.3,
          });
        }
      }
      break;
    }
    case "flash": {
      const FLASH_SEC = 0.25;
      if (state.cuttingSubAge >= FLASH_SEC) {
        state.cuttingSubPhase = "rest";
        state.cuttingSubAge = 0;
      }
      break;
    }
    case "rest": {
      const REST_SEC = 0.25;
      if (state.cuttingSubAge >= REST_SEC) {
        state.cuttingWireIndex++;
        state.cuttingSubPhase = "travel";
        state.cuttingSubAge = 0;
      }
      break;
    }
  }

  // Age cut flashes.
  for (const f of state.cutFlashes) f.age += dt;
  state.cutFlashes = state.cutFlashes.filter((f) => f.age < 0.35);
}

function tickShards(state: IntroState, dt: number): void {
  const GRAV = 380;
  for (const s of state.shards) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += GRAV * dt;
    s.rot += s.rotVel * dt;
  }
  state.shards = state.shards.filter((s) => s.age < s.lifetime);
}

function tickLoosePieces(state: IntroState, dt: number): void {
  for (const w of state.wires) {
    if (w.loosePieceAge < 0) continue;
    w.loosePieceAge += dt;
    w.loosePieceVy += 380 * dt;
    w.loosePieceYOffset += w.loosePieceVy * dt;
    w.loosePieceRot += dt * 1.2;
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

function tickHero(state: IntroState, dt: number): void {
  state.heroBreath += dt;
  state.heroFlicker += dt;
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

  // Merge / shatter / final flashes — overlay full canvas.
  if (state.mergeFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * state.mergeFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  if (state.shatterFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.55 * state.shatterFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  if (state.finalFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.finalFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Fade-in overlay during the very first phase (the room reveals
  // out of black, not in).
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
  for (let i = 0; i < WIRES.length; i++) {
    const w = WIRES[i];
    const s = state.wires[i];
    const endT = s.cut ? 0.42 : 1;
    // Outer dark stroke (cable casing).
    ctx.strokeStyle = "rgba(18, 25, 40, 0.95)";
    ctx.lineWidth = 4;
    ctx.shadowBlur = 0;
    drawWireBezier(ctx, w, 0, endT);
    // Inner highlight — slim lighter line, sells the cable depth.
    ctx.strokeStyle = "rgba(70, 90, 130, 0.55)";
    ctx.lineWidth = 1.2;
    drawWireBezier(ctx, w, 0, endT);
    // Pre-cut glow at the cut point as the spark approaches.
    if (
      !s.cut &&
      state.phase === "cutting" &&
      i === state.cuttingWireIndex &&
      state.cuttingSubPhase === "travel"
    ) {
      const t = Math.min(1, state.cuttingSubAge / 0.45);
      const cp = wireBezier(w, 0.42);
      ctx.strokeStyle = `rgba(165, 243, 252, ${0.4 * t})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "#a5f3fc";
      ctx.shadowBlur = 10 * t;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 8 + t * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawWireBezier(
  ctx: CanvasRenderingContext2D,
  wire: WireSpec,
  startT: number,
  endT: number,
): void {
  const samples = 18;
  ctx.beginPath();
  for (let i = 0; i <= samples; i++) {
    const t = startT + (endT - startT) * (i / samples);
    const p = wireBezier(wire, t);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
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

function drawLoosePieces(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
): void {
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < WIRES.length; i++) {
    const w = WIRES[i];
    const s = state.wires[i];
    if (s.loosePieceAge < 0) continue;
    const u = Math.min(1, s.loosePieceAge / 1.5);
    ctx.globalAlpha = 1 - u;
    ctx.save();
    ctx.translate(w.ax, w.ay + s.loosePieceYOffset);
    ctx.rotate(s.loosePieceRot);
    ctx.strokeStyle = "rgba(18, 25, 40, 0.95)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    const samples = 12;
    for (let k = 0; k <= samples; k++) {
      const t = 0.42 + (1 - 0.42) * (k / samples);
      const p = wireBezier(w, t);
      const lx = p.x - w.ax;
      const ly = p.y - w.ay;
      if (k === 0) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(70, 90, 130, 0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k <= samples; k++) {
      const t = 0.42 + (1 - 0.42) * (k / samples);
      const p = wireBezier(w, t);
      const lx = p.x - w.ax;
      const ly = p.y - w.ay;
      if (k === 0) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
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
  if (state.capsuleBroken && state.phase !== "shatter") {
    // After shatter, render only the hero floating + a faint
    // residual ring where the capsule used to be.
    drawHeroOrb(ctx, state);
    return;
  }

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

  // Glass specular highlight — a curved white sliver on the upper-left.
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + state.capsuleGlow * 0.2})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(
    CAPSULE_CX - 18,
    CAPSULE_CY - 30,
    CAPSULE_RX * 0.6,
    CAPSULE_RY * 0.7,
    -0.3,
    Math.PI * 0.85,
    Math.PI * 1.25,
  );
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
  // Mirrors the in-game eye structure so the wake-up reads as the same
  // hero. Outer white ring, iris, pupil. Eye open amount controls the
  // vertical scale of the iris/pupil (closed = horizontal slit).
  ctx.save();
  ctx.translate(CAPSULE_CX, CAPSULE_CY);

  // Subtle breathing — applies to the whole orb when dormant.
  const breath = state.eyeOpen < 0.05
    ? 1 + Math.sin(state.heroBreath * 1.6) * 0.025
    : 1;
  ctx.scale(breath, breath);

  // Dormant glow halo (fades out as the eye opens fully).
  const dormantAlpha = 1 - state.eyeOpen;
  if (dormantAlpha > 0) {
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, HERO_OUTER_R * 2.4);
    halo.addColorStop(0, `rgba(125, 211, 252, ${0.25 * dormantAlpha})`);
    halo.addColorStop(1, "rgba(125, 211, 252, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, HERO_OUTER_R * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer ring (white) — always visible.
  const ringAlpha = 0.6 + state.eyeOpen * 0.4;
  ctx.strokeStyle = `rgba(255, 255, 255, ${ringAlpha})`;
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = state.eyeOpen > 0.5 ? 10 : 4;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, HERO_OUTER_R, 0, Math.PI * 2);
  ctx.stroke();

  // Iris — scale Y by open amount so closed = horizontal slit.
  const irisYScale = 0.08 + state.eyeOpen * 0.92;
  ctx.save();
  ctx.scale(1, irisYScale);
  // Iris fill.
  const flicker = state.eyeOpen < 0.05
    ? 0.3 + Math.sin(state.heroFlicker * 4) * 0.05
    : 0.85;
  ctx.fillStyle = state.eyeOpen > 0.4
    ? `rgba(125, 211, 252, ${0.85})`
    : `rgba(125, 211, 252, ${flicker})`;
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(0, 0, HERO_IRIS_R, 0, Math.PI * 2);
  ctx.fill();
  // Iris outline.
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + state.eyeOpen * 0.4})`;
  ctx.lineWidth = 1.4 / Math.max(0.1, irisYScale);
  ctx.beginPath();
  ctx.arc(0, 0, HERO_IRIS_R, 0, Math.PI * 2);
  ctx.stroke();
  // Pupil — only after eye is more than 40% open.
  if (state.eyeOpen > 0.4) {
    const pupilT = (state.eyeOpen - 0.4) / 0.6;
    ctx.fillStyle = `rgba(10, 14, 26, ${pupilT})`;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, HERO_PUPIL_R * (0.6 + pupilT * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Awaken halo — bright cyan glow on full open.
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
  if (state.shards.length === 0) return;
  ctx.save();
  ctx.shadowBlur = 0;
  for (const s of state.shards) {
    const u = s.age / s.lifetime;
    const alpha = 1 - u;
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    // Glass shard — triangular sliver with a bright outline and a
    // faint cyan inner fill so it reads as a fragment of the capsule.
    ctx.fillStyle = "rgba(125, 211, 252, 0.45)";
    ctx.beginPath();
    ctx.moveTo(0, -s.size);
    ctx.lineTo(s.size * 0.55, s.size * 0.4);
    ctx.lineTo(-s.size * 0.7, s.size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
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
  // Trail.
  if (state.sparkTrail.length > 1) {
    ctx.save();
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 10;
    ctx.lineCap = "round";
    for (let i = 1; i < state.sparkTrail.length; i++) {
      const t = i / state.sparkTrail.length;
      ctx.strokeStyle = `rgba(165, 243, 252, ${t * 0.65 * state.sparkBrightness})`;
      ctx.lineWidth = 1.2 + t * 1.8;
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

  // Outer halo (large additive glow).
  const haloR = 36 * b;
  const halo = ctx.createRadialGradient(
    state.sparkX,
    state.sparkY,
    0,
    state.sparkX,
    state.sparkY,
    haloR,
  );
  halo.addColorStop(0, `rgba(165, 243, 252, ${0.5 * b})`);
  halo.addColorStop(0.5, `rgba(125, 211, 252, ${0.18 * b})`);
  halo.addColorStop(1, "rgba(125, 211, 252, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(state.sparkX, state.sparkY, haloR, 0, Math.PI * 2);
  ctx.fill();

  // Crackling tendrils — short branching lightning bolts radiating
  // out at random each frame.
  ctx.strokeStyle = `rgba(165, 243, 252, ${0.7 * b})`;
  ctx.shadowColor = "#a5f3fc";
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.2;
  const tendrilCount = 5;
  for (let i = 0; i < tendrilCount; i++) {
    const angle = (i / tendrilCount) * Math.PI * 2 + state.time * 1.2 + Math.random() * 0.4;
    const len = 7 + Math.random() * 10;
    let cx = state.sparkX;
    let cy = state.sparkY;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const segs = 3;
    for (let s = 0; s < segs; s++) {
      cx += Math.cos(angle) * (len / segs);
      cy += Math.sin(angle) * (len / segs);
      cx += (Math.random() - 0.5) * 3;
      cy += (Math.random() - 0.5) * 3;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Hot core.
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(state.sparkX, state.sparkY, 3.2, 0, Math.PI * 2);
  ctx.fill();
  // Inner glow ring.
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * b})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(state.sparkX, state.sparkY, 6, 0, Math.PI * 2);
  ctx.stroke();

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

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
