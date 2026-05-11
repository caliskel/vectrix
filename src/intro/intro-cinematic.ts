// Intro cinematic — first-time experience. ~20 seconds of dialogue-free
// staging that grounds the player in the lore before the tutorial:
//
//   The hero is asleep in a capsule, suspended in a dead room. Cracks
//   in the floor still leak the last of the network's current. A
//   small light arrives, cuts the wires, breaks the capsule open,
//   and merges with the dormant eye — the player consciousness
//   inhabiting the body that's been waiting here.
//
// All canvas 2D. State machine of ten phases, each with its own draw
// path. Time advances on real dt; the cinematic is fully linear.

import { PALETTE } from "../lib/palette";

const CANVAS_W = 1200;
const CANVAS_H = 800;

const CAPSULE_CX = 600;
const CAPSULE_CY = 410;
const CAPSULE_RX = 70;
const CAPSULE_RY = 110;

const EYE_RX = 26;
const EYE_RY = 26;

// Wires that hold the capsule in place. Three go up like marionette
// cables, two are "network feeds" trailing offscreen sideways. Each
// has a smooth Bezier curve, a cut point (1/3 down from the capsule)
// and a flag for whether the spark of light has severed it yet.
const WIRES: WireSpec[] = [
  { ax: CAPSULE_CX - 18, ay: CAPSULE_CY - CAPSULE_RY + 10, bx: 280,  by: -40, cpYOffset: -120 },
  { ax: CAPSULE_CX,      ay: CAPSULE_CY - CAPSULE_RY + 4,  bx: 600,  by: -60, cpYOffset: -160 },
  { ax: CAPSULE_CX + 18, ay: CAPSULE_CY - CAPSULE_RY + 10, bx: 940,  by: -40, cpYOffset: -120 },
  { ax: CAPSULE_CX - CAPSULE_RX + 6, ay: CAPSULE_CY + 30,  bx: -40,  by: 380, cpYOffset: 60  },
  { ax: CAPSULE_CX + CAPSULE_RX - 6, ay: CAPSULE_CY + 30,  bx: 1240, by: 380, cpYOffset: 60  },
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
  awaken: 1.5,
  fadeout: 0.5,
};

// ---- State ----
type WireSpec = {
  ax: number; ay: number; // capsule attach
  bx: number; by: number; // offscreen anchor
  cpYOffset: number;      // control-point y offset for Bezier curl
};

type WireState = {
  cut: boolean;
  // When cut, the loose end falls. Drives a gravity-based fall of the
  // segment from cut point to attach point.
  loosePieceAge: number; // -1 = inactive
  loosePieceVy: number;
  loosePieceYOffset: number;
  loosePieceRot: number;
};

type Crack = {
  // Polyline points relative to (0, 0). cracks are translated to the
  // floor coords on render.
  pts: { x: number; y: number }[];
};

type CrackSpark = {
  origin: { x: number; y: number };
  // arc endpoint relative to origin
  segments: { x: number; y: number }[];
  age: number;
  lifetime: number;
};

type CrackEmber = {
  x: number; y: number;
  vx: number; vy: number;
  age: number; lifetime: number;
};

type SparkTrail = { x: number; y: number };

type Shard = {
  x: number; y: number;
  vx: number; vy: number;
  rot: number; rotVel: number;
  age: number; lifetime: number;
  size: number;
};

export type IntroState = {
  time: number;
  phase: PhaseId;
  phaseTime: number;
  done: boolean;

  // Capsule + eye drift
  capsuleGlow: number;
  capsuleShakeOffsetY: number;
  capsuleCrackedAlpha: number;
  capsuleBroken: boolean;
  eyeOpen: number; // 0=closed slit, 1=fully open

  // Wires
  wires: WireState[];
  cuttingProgress: number; // 0..5 across the cutting phase

  // Cracks + their sparks
  cracks: Crack[];
  crackSparks: CrackSpark[];
  embers: CrackEmber[];
  sparkSpawnTimer: number;

  // Spark of light
  sparkX: number;
  sparkY: number;
  sparkActive: boolean;
  sparkInsideCapsule: boolean;
  sparkTrail: SparkTrail[];
  sparkBrightness: number;

  // Cutting waypoints
  cuttingWireIndex: number;     // currently moving toward wire
  cuttingSubPhase: "travel" | "flash" | "rest";
  cuttingSubAge: number;

  // Shatter shards (capsule glass)
  shards: Shard[];
  shatterFlash: number;

  // Final merge flash
  mergeFlash: number;
  finalFlash: number; // fade-to-white at end
};

export function createIntroState(): IntroState {
  return {
    time: 0,
    phase: "fadein",
    phaseTime: 0,
    done: false,
    capsuleGlow: 0,
    capsuleShakeOffsetY: 0,
    capsuleCrackedAlpha: 0,
    capsuleBroken: false,
    eyeOpen: 0,
    wires: WIRES.map(() => ({
      cut: false,
      loosePieceAge: -1,
      loosePieceVy: 0,
      loosePieceYOffset: 0,
      loosePieceRot: 0,
    })),
    cuttingProgress: 0,
    cracks: buildCracks(),
    crackSparks: [],
    embers: [],
    sparkSpawnTimer: 0,
    sparkX: 0,
    sparkY: 0,
    sparkActive: false,
    sparkInsideCapsule: false,
    sparkTrail: [],
    sparkBrightness: 0,
    cuttingWireIndex: 0,
    cuttingSubPhase: "travel",
    cuttingSubAge: 0,
    shards: [],
    shatterFlash: 0,
    mergeFlash: 0,
    finalFlash: 0,
  };
}

function buildCracks(): Crack[] {
  // 8 jagged polylines across the floor (y > 580). Each starts on
  // one edge of the floor and walks across with random zigzag.
  const cracks: Crack[] = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const pts: { x: number; y: number }[] = [];
    let x = Math.random() * CANVAS_W;
    let y = 580 + Math.random() * 200;
    pts.push({ x, y });
    const segs = 4 + Math.floor(Math.random() * 5);
    const dirX = Math.random() < 0.5 ? 1 : -1;
    for (let s = 0; s < segs; s++) {
      x += dirX * (40 + Math.random() * 80);
      y += (Math.random() - 0.5) * 60;
      y = Math.max(580, Math.min(CANVAS_H - 10, y));
      pts.push({ x, y });
    }
    cracks.push({ pts });
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

  tickAmbience(state, dt);
  tickByPhase(state, dt);
  tickLoosePieces(state, dt);
}

function onPhaseEnter(state: IntroState): void {
  switch (state.phase) {
    case "sparkenters":
      state.sparkActive = true;
      state.sparkX = CANVAS_W + 60;
      state.sparkY = -40;
      state.sparkBrightness = 0;
      state.sparkTrail = [];
      break;
    case "cutting":
      state.cuttingWireIndex = 0;
      state.cuttingSubPhase = "travel";
      state.cuttingSubAge = 0;
      break;
    case "shatter":
      // Build shards from the capsule outline.
      state.shards = buildShatterShards();
      state.shatterFlash = 1;
      state.capsuleBroken = true;
      break;
    case "merge":
      // Spark dives into the capsule, settles on the eye.
      state.sparkInsideCapsule = true;
      break;
    case "awaken":
      state.mergeFlash = 1;
      break;
    case "fadeout":
      state.finalFlash = 0;
      break;
  }
}

function buildShatterShards(): Shard[] {
  const shards: Shard[] = [];
  const count = 16;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const speed = 180 + Math.random() * 180;
    shards.push({
      x: CAPSULE_CX + Math.cos(angle) * CAPSULE_RX * 0.8,
      y: CAPSULE_CY + Math.sin(angle) * CAPSULE_RY * 0.8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 80, // upward bias
      rot: Math.random() * Math.PI * 2,
      rotVel: (Math.random() - 0.5) * 10,
      age: 0,
      lifetime: 1.4 + Math.random() * 0.5,
      size: 6 + Math.random() * 8,
    });
  }
  return shards;
}

function tickByPhase(state: IntroState, dt: number): void {
  switch (state.phase) {
    case "fadein": {
      const t = state.phaseTime / PHASE_DURATIONS.fadein;
      state.capsuleGlow = smoothstep(t) * 0.55;
      break;
    }
    case "establish": {
      // Hold; subtle breathing of the capsule glow.
      const breath = Math.sin(state.time * 1.2) * 0.05;
      state.capsuleGlow = 0.55 + breath;
      break;
    }
    case "lightsdie": {
      const t = state.phaseTime / PHASE_DURATIONS.lightsdie;
      state.capsuleGlow = (1 - smoothstep(t)) * 0.55;
      break;
    }
    case "silence": {
      state.capsuleGlow = 0;
      break;
    }
    case "sparkenters": {
      const t = state.phaseTime / PHASE_DURATIONS.sparkenters;
      // Travel from (W+60, -40) toward (CAPSULE_CX + 150, CAPSULE_CY - 200)
      // along an arc that decelerates.
      const targetX = CAPSULE_CX + 220;
      const targetY = CAPSULE_CY - 240;
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
      // Spark drifts inward toward the capsule center as glass breaks.
      const t = state.phaseTime / PHASE_DURATIONS.shatter;
      const eased = easeInOutCubic(t);
      const prevX = state.sparkX;
      const prevY = state.sparkY;
      // Start of shatter phase: spark was on the last wire cut location.
      // We blend toward (CAPSULE_CX, CAPSULE_CY - 40) so it ends near the eye.
      state.sparkX = lerp(state.sparkX, CAPSULE_CX + 60, eased * 0.7);
      state.sparkY = lerp(state.sparkY, CAPSULE_CY - 40, eased * 0.7);
      pushTrail(state, prevX, prevY);
      break;
    }
    case "merge": {
      tickShards(state, dt);
      // Spark moves to eye center.
      const t = state.phaseTime / PHASE_DURATIONS.merge;
      const eased = easeInOutCubic(t);
      const prevX = state.sparkX;
      const prevY = state.sparkY;
      state.sparkX = lerp(state.sparkX, CAPSULE_CX, eased);
      state.sparkY = lerp(state.sparkY, CAPSULE_CY, eased);
      state.sparkBrightness = 1 + t * 1.5;
      pushTrail(state, prevX, prevY);
      // At the end, fire the merge flash.
      if (t > 0.85) {
        state.mergeFlash = (t - 0.85) / 0.15;
      }
      break;
    }
    case "awaken": {
      tickShards(state, dt);
      // Flash decays; eye opens.
      state.mergeFlash = Math.max(0, state.mergeFlash - dt * 1.8);
      const t = state.phaseTime / PHASE_DURATIONS.awaken;
      // Eye opens with ease-out so the iris snaps into shape.
      state.eyeOpen = easeOutCubic(Math.min(1, t * 1.3));
      // Spark is now part of the eye — keep it on top of the capsule
      // center, brightness drops as it merges into the iris.
      state.sparkX = CAPSULE_CX;
      state.sparkY = CAPSULE_CY;
      state.sparkBrightness = Math.max(0, 1.5 - t * 1.5);
      break;
    }
    case "fadeout": {
      const t = state.phaseTime / PHASE_DURATIONS.fadeout;
      state.finalFlash = t;
      break;
    }
  }
}

function tickCutting(state: IntroState, dt: number): void {
  if (state.cuttingWireIndex >= WIRES.length) return;
  const wire = WIRES[state.cuttingWireIndex];
  // Cut point: 35% from capsule end along the wire's path.
  const cutT = 0.35;
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
      if (state.cuttingSubAge >= TRAVEL_SEC) {
        state.cuttingSubPhase = "flash";
        state.cuttingSubAge = 0;
        // Mark the wire as cut, spawn its loose-piece falling animation.
        const w = state.wires[state.cuttingWireIndex];
        w.cut = true;
        w.loosePieceAge = 0;
        w.loosePieceVy = -30;
        w.loosePieceYOffset = 0;
        w.loosePieceRot = 0;
      }
      break;
    }
    case "flash": {
      const FLASH_SEC = 0.2;
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
  // Floor sparks: throughout the cinematic, ambient arcs from cracks.
  // Frequency dips during silence phase (mostly quiet).
  let rate = 1.0;
  if (state.phase === "silence") rate = 0.25;
  else if (state.phase === "lightsdie") rate = 0.6;
  else if (state.phase === "awaken" || state.phase === "fadeout") rate = 0.3;

  state.sparkSpawnTimer -= dt * rate;
  if (state.sparkSpawnTimer <= 0) {
    state.sparkSpawnTimer = 0.35 + Math.random() * 0.6;
    spawnCrackSpark(state);
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
}

function spawnCrackSpark(state: IntroState): void {
  if (state.cracks.length === 0) return;
  const crack = state.cracks[Math.floor(Math.random() * state.cracks.length)];
  if (crack.pts.length < 2) return;
  const segIdx = Math.floor(Math.random() * (crack.pts.length - 1));
  const t = Math.random();
  const a = crack.pts[segIdx];
  const b = crack.pts[segIdx + 1];
  const origin = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };

  // Arc upward (outward from floor) with zigzag.
  const dirX = (Math.random() - 0.5) * 0.6;
  const dirY = -1 + (Math.random() - 0.5) * 0.4;
  const len = 18 + Math.random() * 24;
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
  // 1-2 embers.
  const emberCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < emberCount; i++) {
    const angle = Math.PI * 1.5 + (Math.random() - 0.5) * 1.4;
    const speed = 60 + Math.random() * 120;
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
  // Sample trail at every frame to avoid gaps when the spark moves fast.
  state.sparkTrail.push({ x: prevX, y: prevY });
  if (state.sparkTrail.length > 28) state.sparkTrail.shift();
}

// ---- Render ----

export function drawIntro(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
  viewW: number,
  viewH: number,
  dpr: number,
): void {
  // Letterbox: scale canonical 1200×800 to fit the viewport, center.
  const scale = Math.min(viewW / CANVAS_W, viewH / CANVAS_H);
  const renderW = CANVAS_W * scale;
  const renderH = CANVAS_H * scale;
  const offsetX = (viewW - renderW) / 2;
  const offsetY = (viewH - renderH) / 2;

  // Pure black backdrop (including letterbox bars).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, viewW, viewH);

  // Switch into canonical canvas space.
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

  // Background — very dark base + faint radial vignette from capsule.
  ctx.fillStyle = "#040608";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Subtle floor gradient so the lower third reads as "ground".
  const floorGrad = ctx.createLinearGradient(0, 500, 0, CANVAS_H);
  floorGrad.addColorStop(0, "rgba(15, 25, 40, 0)");
  floorGrad.addColorStop(1, "rgba(15, 25, 40, 0.85)");
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, 500, CANVAS_W, CANVAS_H - 500);

  // Cracks across the floor.
  drawCracks(ctx, state);

  // Ambient crack arcs + embers.
  drawCrackArcs(ctx, state);
  drawEmbers(ctx, state);

  // Wires (under capsule so they appear to enter the capsule).
  drawWires(ctx, state);
  drawLoosePieces(ctx, state);

  // Capsule + eye inside.
  drawCapsule(ctx, state);

  // Shatter shards float above the capsule once broken.
  drawShards(ctx, state);

  // The point of light + its trail.
  if (state.sparkActive) drawSpark(ctx, state);

  // Merge flash overlay (white, bright moment when consciousness joins
  // the body).
  if (state.mergeFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * state.mergeFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Shatter flash — short white pop on the frame the glass breaks.
  if (state.shatterFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.55 * state.shatterFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Final fade to white before redirect.
  if (state.finalFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.finalFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Reset back to screen space for any HUD (skip hint).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawCracks(ctx: CanvasRenderingContext2D, state: IntroState): void {
  ctx.save();
  ctx.strokeStyle = "rgba(8, 12, 22, 0.95)";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.shadowBlur = 0;
  for (const c of state.cracks) {
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
  ctx.strokeStyle = "rgba(35, 42, 60, 0.95)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.shadowBlur = 0;
  for (let i = 0; i < WIRES.length; i++) {
    const w = WIRES[i];
    const s = state.wires[i];
    if (s.cut) {
      // Draw only the anchor → cut point segment. Use Bezier sampled
      // up to t = 0.35.
      drawWireBezier(ctx, w, 0, 0.35);
    } else {
      drawWireBezier(ctx, w, 0, 1);
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
  // Sample 16 points along the Bezier curve between startT and endT.
  const samples = 16;
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
  // Quadratic Bezier from (bx, by) [anchor end] to (ax, ay) [capsule end]
  // with control point biased upward / downward via cpYOffset for curl.
  // We parameterize t = 0 at the anchor end, t = 1 at the capsule end.
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
  ctx.strokeStyle = "rgba(35, 42, 60, 0.85)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.shadowBlur = 0;
  for (let i = 0; i < WIRES.length; i++) {
    const w = WIRES[i];
    const s = state.wires[i];
    if (s.loosePieceAge < 0) continue;
    // Fade out over 1.5s.
    const u = Math.min(1, s.loosePieceAge / 1.5);
    ctx.globalAlpha = 1 - u;
    // Apply translation + rotation around the capsule attach point.
    ctx.save();
    ctx.translate(w.ax, w.ay + s.loosePieceYOffset);
    ctx.rotate(s.loosePieceRot);
    ctx.beginPath();
    const samples = 10;
    // Sample the segment from t=0.35 (cut) to t=1 (capsule attach) but
    // in the *local* frame where attach is at (0,0). To do that, we
    // build the world-space points then offset relative to (ax, ay).
    for (let k = 0; k <= samples; k++) {
      const t = 0.35 + (1 - 0.35) * (k / samples);
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

function drawCapsule(ctx: CanvasRenderingContext2D, state: IntroState): void {
  if (state.capsuleBroken && state.phase !== "shatter") {
    // After shatter the capsule is gone, only the eye remains floating.
    drawEye(ctx, state);
    return;
  }

  ctx.save();
  // Capsule body fill — translucent dark blue glass.
  ctx.fillStyle = "rgba(8, 14, 26, 0.85)";
  ctx.beginPath();
  ctx.ellipse(CAPSULE_CX, CAPSULE_CY, CAPSULE_RX, CAPSULE_RY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Inner glow — radial gradient from center.
  if (state.capsuleGlow > 0) {
    const grad = ctx.createRadialGradient(
      CAPSULE_CX,
      CAPSULE_CY,
      0,
      CAPSULE_CX,
      CAPSULE_CY,
      CAPSULE_RX * 1.6,
    );
    grad.addColorStop(0, `rgba(0, 229, 255, ${0.35 * state.capsuleGlow})`);
    grad.addColorStop(1, "rgba(0, 229, 255, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(
      CAPSULE_CX - CAPSULE_RX * 2,
      CAPSULE_CY - CAPSULE_RY * 1.8,
      CAPSULE_RX * 4,
      CAPSULE_RY * 3.6,
    );
  }

  // Glass outline + faint highlight.
  ctx.strokeStyle = `rgba(125, 211, 252, ${0.45 + state.capsuleGlow * 0.3})`;
  ctx.lineWidth = 1.8;
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = state.capsuleGlow > 0 ? 10 : 0;
  ctx.beginPath();
  ctx.ellipse(CAPSULE_CX, CAPSULE_CY, CAPSULE_RX, CAPSULE_RY, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Inner ring detail.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(125, 211, 252, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(
    CAPSULE_CX,
    CAPSULE_CY,
    CAPSULE_RX * 0.78,
    CAPSULE_RY * 0.85,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();

  // The eye, suspended inside.
  drawEye(ctx, state);

  ctx.restore();
}

function drawEye(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Eye opens from a horizontal slit to a full circle.
  // openAmount 0..1 controls the vertical scale of the iris.
  const open = state.eyeOpen;
  ctx.save();
  ctx.translate(CAPSULE_CX, CAPSULE_CY);
  // Outer eyelid silhouette (dim, just a hint).
  ctx.fillStyle = "rgba(220, 230, 245, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX + 4, EYE_RY + 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Iris — scaled by open amount on Y so closed = slit.
  const irisYScale = 0.06 + open * 0.94;
  ctx.save();
  ctx.scale(1, irisYScale);
  // Iris fill
  ctx.fillStyle = open > 0.5
    ? `rgba(125, 211, 252, ${0.85 * open})`
    : "rgba(125, 211, 252, 0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX, EYE_RY, 0, 0, Math.PI * 2);
  ctx.fill();
  // Outline
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + open * 0.4})`;
  ctx.lineWidth = 1.5 / Math.max(0.1, irisYScale);
  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_RX, EYE_RY, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Pupil (only visible when eye is more than half open).
  if (open > 0.4) {
    const pupilAlpha = (open - 0.4) / 0.6;
    ctx.fillStyle = `rgba(10, 14, 26, ${pupilAlpha})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, EYE_RX * 0.45, EYE_RY * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Awakened glow halo.
  if (open > 0.6) {
    const t = (open - 0.6) / 0.4;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, EYE_RX * 3);
    halo.addColorStop(0, `rgba(0, 229, 255, ${0.45 * t})`);
    halo.addColorStop(1, "rgba(0, 229, 255, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(-EYE_RX * 3, -EYE_RX * 3, EYE_RX * 6, EYE_RX * 6);
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
    ctx.fillStyle = "rgba(125, 211, 252, 0.7)";
    ctx.beginPath();
    ctx.moveTo(0, -s.size);
    ctx.lineTo(s.size * 0.6, s.size * 0.5);
    ctx.lineTo(-s.size * 0.6, s.size * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Trail first, dim → bright toward head.
  if (state.sparkTrail.length > 1) {
    ctx.save();
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 8;
    ctx.lineCap = "round";
    for (let i = 1; i < state.sparkTrail.length; i++) {
      const t = i / state.sparkTrail.length;
      ctx.strokeStyle = `rgba(165, 243, 252, ${t * 0.55 * state.sparkBrightness})`;
      ctx.lineWidth = 1 + t * 1.4;
      const p0 = state.sparkTrail[i - 1];
      const p1 = state.sparkTrail[i];
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Head — bright cyan-white dot with outer halo.
  const b = state.sparkBrightness;
  if (b <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Outer halo (large radial)
  const haloR = 22 * b;
  const halo = ctx.createRadialGradient(
    state.sparkX,
    state.sparkY,
    0,
    state.sparkX,
    state.sparkY,
    haloR,
  );
  halo.addColorStop(0, `rgba(165, 243, 252, ${0.55 * b})`);
  halo.addColorStop(1, "rgba(165, 243, 252, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(state.sparkX, state.sparkY, haloR, 0, Math.PI * 2);
  ctx.fill();
  // Core
  ctx.shadowColor = "#a5f3fc";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(state.sparkX, state.sparkY, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

// Skip helper — when the user presses any key or clicks after the
// minimum watch window has elapsed, advance the cinematic to the
// fadeout phase so the redirect still feels intentional rather than a
// hard cut.
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

// Avoid unused — PALETTE is intentionally not referenced inline yet
// but kept available for future colour tweaks against the canonical
// palette source.
void PALETTE;
