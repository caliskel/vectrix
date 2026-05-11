// Intro cinematic — VECTRIX boot. ~16s of dialogue-free awakening
// staged in pure void:
//
//   The hero floats dormant in deep blackness, a single dim glyph at
//   the centre of a slow-drifting vector grid. A spark of light arrives
//   from off-screen, curves through the void, merges with the body,
//   and the eye opens. "who am i?" surfaces as the first thought.
//
// Pure canvas 2D. Seven phases, minimal scene — no walls, no capsule,
// no wires, no glass. The eye and the spark are the whole stage;
// everything else is atmosphere.

import {
  BLINK_CLOSE_DURATION_MS,
  BLINK_OPEN_DURATION_MS,
  DASH_DURATION_MS,
} from "../lib/config";
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
const EYE_CX = 600;
const EYE_CY = 400;

// Eye size at full-awake. ~2× in-game PLAYER_SIZE so the final reveal
// reads as person-scale, not a token.
const HERO_SIZE = 60;

// Camera push-in: the dormant body sits at 0.45× of HERO_SIZE so the
// spark's approach reads as the camera closing distance. By the end
// of awaken we hit 1.0×.
const HERO_SCALE_DORMANT = 0.45;
const HERO_SCALE_FULL = 1.0;

// ---- Phases ----

type PhaseId =
  | "fadein"
  | "dormant"
  | "sparkapproach"
  | "merge"
  | "awaken"
  | "askname"
  | "fadeout";

const PHASE_ORDER: PhaseId[] = [
  "fadein",
  "dormant",
  "sparkapproach",
  "merge",
  "awaken",
  "askname",
  "fadeout",
];

const PHASE_DURATIONS: Record<PhaseId, number> = {
  fadein: 1.5,
  dormant: 2.5,
  sparkapproach: 3.5,
  merge: 1.0,
  awaken: 2.0,
  askname: 4.5,
  fadeout: 0.7,
};

// ---- Types ----

type DustMote = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
};

type SparkPath = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  // Quadratic-bezier control point — pulled off the straight line so
  // the spark arcs into the eye rather than ruler-tracking.
  cpX: number;
  cpY: number;
  duration: number;
};

export type IntroState = {
  time: number;
  phase: PhaseId;
  phaseTime: number;
  done: boolean;

  // Hero — drawn via drawPlayerEye (same renderer as gameplay). The
  // eye is held closed via a pinned blink (tickHero); the eyelid +
  // iris + ring colours all interpolate from dormant black to the
  // player's profile colours over heroIrisT, and heroBlinkOpenT
  // drives the slow lid-lift during the awaken phase.
  hero: Player;
  heroProfile: PlayerProfile;
  heroFrozen: boolean;
  heroIrisT: number;
  heroBlinkOpenT: number;
  heroScale: number;
  heroBloom: number;

  // Spark of light. Single bezier path from the off-screen entry to
  // the eye centre.
  sparkX: number;
  sparkY: number;
  sparkActive: boolean;
  sparkBrightness: number;
  sparkTrail: { x: number; y: number }[];
  sparkPath: SparkPath | null;
  sparkPathT: number;

  // Background
  gridOffsetX: number;
  gridOffsetY: number;
  dust: DustMote[];

  // Flashes
  mergeFlash: number;
  finalFlash: number;
};

const DORMANT_HEX = "#000000";
// Dim slate-blue for the ring during dormant — visible enough to
// read as "a glyph is here" but dim enough that the void is what the
// viewer perceives as the focal point.
const RING_DORMANT_HEX = "#1c2436";

const GRID_SPACING = 100;
const GRID_DRIFT_X = 8; // px/s
const GRID_DRIFT_Y = 5;

// ---- State builders ----

export function createIntroState(): IntroState {
  const heroProfile = loadPlayerProfile();
  const hero = createPlayer();
  hero.x = EYE_CX;
  hero.y = EYE_CY;
  hero.isClosing = false;
  hero.closeAmount = 0;
  // Pin the blink "fully closed" — eyelids cover the iris from
  // frame 0. tickHero keeps reasserting this every frame while
  // heroFrozen is true.
  hero.blinkActive = true;
  hero.blinkElapsed = BLINK_CLOSE_DURATION_MS / 1000;
  hero.breathPhase = 0;
  hero.pupilOffsetX = 0;
  hero.pupilOffsetY = 0;
  return {
    time: 0,
    phase: "fadein",
    phaseTime: 0,
    done: false,
    hero,
    heroProfile,
    heroFrozen: true,
    heroIrisT: 0,
    heroBlinkOpenT: 0,
    heroScale: HERO_SCALE_DORMANT,
    heroBloom: 0,
    sparkX: 0,
    sparkY: 0,
    sparkActive: false,
    sparkBrightness: 0,
    sparkTrail: [],
    sparkPath: null,
    sparkPathT: 0,
    gridOffsetX: 0,
    gridOffsetY: 0,
    dust: buildDust(),
    mergeFlash: 0,
    finalFlash: 0,
  };
}

function buildDust(): DustMote[] {
  const dust: DustMote[] = [];
  for (let i = 0; i < 60; i++) {
    dust.push({
      x: Math.random() * CANVAS_W,
      y: Math.random() * CANVAS_H,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      size: 0.8 + Math.random() * 1.4,
      alpha: 0.08 + Math.random() * 0.18,
    });
  }
  return dust;
}

// ---- Update ----

export function updateIntro(state: IntroState, dt: number): void {
  state.time += dt;
  state.phaseTime += dt;
  const dur = PHASE_DURATIONS[state.phase];
  if (state.phaseTime >= dur) {
    const idx = PHASE_ORDER.indexOf(state.phase);
    if (idx < PHASE_ORDER.length - 1) {
      state.phase = PHASE_ORDER[idx + 1];
      state.phaseTime = 0;
      onPhaseEnter(state);
    } else {
      state.done = true;
    }
  }
  tickHero(state, dt);
  tickPhase(state, dt);
  tickAmbient(state, dt);
}

function onPhaseEnter(state: IntroState): void {
  switch (state.phase) {
    case "sparkapproach":
      // Spark drops in from the upper-right, off-screen.
      state.sparkActive = true;
      state.sparkBrightness = 1;
      state.sparkX = CANVAS_W + 60;
      state.sparkY = -60;
      startSparkPath(
        state,
        state.sparkX,
        state.sparkY,
        EYE_CX,
        EYE_CY,
        PHASE_DURATIONS.sparkapproach * 0.92,
        320,
      );
      break;
    case "merge":
      // Spark is on the eye now — flash, then dissolve into the body.
      state.sparkX = EYE_CX;
      state.sparkY = EYE_CY;
      state.mergeFlash = 1.0;
      break;
    case "awaken":
      // Spark has been consumed by the body.
      state.sparkActive = false;
      state.sparkBrightness = 0;
      state.sparkTrail.length = 0;
      break;
    case "askname":
      // Eye is open — release the engine so it can run idle look,
      // blink scheduling, and breath naturally.
      state.heroFrozen = false;
      break;
    case "fadeout":
      break;
  }
}

function tickPhase(state: IntroState, dt: number): void {
  const t = state.phaseTime;
  const dur = PHASE_DURATIONS[state.phase];
  const u = Math.min(1, t / dur);

  switch (state.phase) {
    case "fadein":
    case "dormant":
      // Body sits at dormant scale, frozen, irisT=0. Nothing to drive.
      break;
    case "sparkapproach": {
      advanceSparkPath(state, dt, easeInOutCubic);
      // Camera push-in begins — scale grows from 0.45 to 0.62 across
      // this phase. The remaining push happens during merge + awaken.
      state.heroScale = lerp(HERO_SCALE_DORMANT, 0.62, easeInOutCubic(u));
      break;
    }
    case "merge": {
      // Merge flash decays fast.
      state.mergeFlash = Math.max(0, 1 - u * 1.8);
      // Bloom on the body ramps up.
      state.heroBloom = Math.min(1, u * 1.4);
      // Spark fades out as the body absorbs it.
      state.sparkBrightness = Math.max(0, 1 - u * 1.5);
      // Iris colour starts shifting from black toward profile during
      // the back half — black → ~0.6 by end of merge, finished in
      // awaken. Split across two phases so the change feels earned.
      const irisU = u < 0.4 ? 0 : (u - 0.4) / 0.6;
      state.heroIrisT = irisU * 0.6;
      // Camera continues to push in.
      state.heroScale = lerp(0.62, 0.82, easeOutCubic(u));
      break;
    }
    case "awaken": {
      // Iris / ring / lid colour finishes shifting in the first ~30%.
      state.heroIrisT = Math.min(1, state.heroIrisT + dt / 0.6);
      // Bloom decays as the body becomes the only luminous element.
      state.heroBloom = Math.max(0, 1 - u * 0.7);
      // Final scale push.
      state.heroScale = lerp(0.82, HERO_SCALE_FULL, easeOutCubic(u));
      // Eye-opening choreography — five staged beats across the 2 s
      // phase instead of a single linear sweep. Reads as a real
      // waking eye: hesitate, crack, hold, snap, settle.
      //   0.00–0.12 : hold closed with a faint micro-tremor (the
      //               body "deciding" to wake)
      //   0.12–0.26 : drowsy crack to ~18 % open
      //   0.26–0.40 : hold the crack with a tiny breath wobble
      //   0.40–0.60 : snap open (easeOutCubic) all the way to 100 %
      //   0.60–1.00 : wide open. Engine handoff at 0.95 so it can
      //               schedule natural blinks during askname.
      if (u < 0.12) {
        const wiggle = Math.sin(state.time * 24) * 0.015;
        state.heroBlinkOpenT = Math.max(0, wiggle);
      } else if (u < 0.26) {
        const k = (u - 0.12) / 0.14;
        state.heroBlinkOpenT = easeOutCubic(k) * 0.18;
      } else if (u < 0.40) {
        state.heroBlinkOpenT = 0.18 + Math.sin(state.time * 5.5) * 0.012;
      } else if (u < 0.60) {
        const k = (u - 0.40) / 0.20;
        state.heroBlinkOpenT = 0.18 + easeOutCubic(k) * (1 - 0.18);
      } else {
        state.heroBlinkOpenT = 1;
      }
      if (u >= 0.95 && state.heroFrozen) {
        state.heroFrozen = false;
        state.hero.blinkActive = false;
        state.hero.blinkElapsed = 0;
      }
      break;
    }
    case "askname":
      // Bloom slowly fades to nothing.
      state.heroBloom = Math.max(0, state.heroBloom - dt * 0.25);
      break;
    case "fadeout":
      state.finalFlash = u;
      break;
  }
}

function tickHero(state: IntroState, dt: number): void {
  state.hero.x = EYE_CX;
  state.hero.y = EYE_CY;
  if (state.heroFrozen) {
    const closeSec = BLINK_CLOSE_DURATION_MS / 1000;
    const openSec = BLINK_OPEN_DURATION_MS / 1000;
    state.hero.blinkActive = true;
    state.hero.blinkElapsed = closeSec + openSec * state.heroBlinkOpenT;
    state.hero.breathPhase = 0;
    state.hero.pupilOffsetX = 0;
    state.hero.pupilOffsetY = 0;
    state.hero.isClosing = false;
    state.hero.closeAmount = 0;
    return;
  }
  updateEye(state.hero, dt, {
    threat: null,
    size: HERO_SIZE * state.heroScale,
    dashDurationSec: DASH_DURATION_MS / 1000,
  });
}

function tickAmbient(state: IntroState, dt: number): void {
  // Grid drift accelerates subtly as the spark closes in — reads as
  // "the void stirring."
  let speedMul = 1.0;
  if (state.phase === "sparkapproach") {
    speedMul =
      1.0 + (state.phaseTime / PHASE_DURATIONS.sparkapproach) * 0.6;
  } else if (state.phase === "merge") {
    speedMul = 1.6;
  } else if (state.phase === "awaken") {
    speedMul = 1.2 - (state.phaseTime / PHASE_DURATIONS.awaken) * 0.4;
  }
  state.gridOffsetX =
    (state.gridOffsetX + GRID_DRIFT_X * dt * speedMul) % GRID_SPACING;
  state.gridOffsetY =
    (state.gridOffsetY + GRID_DRIFT_Y * dt * speedMul) % GRID_SPACING;

  for (const m of state.dust) {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.x < -10) m.x = CANVAS_W + 10;
    if (m.x > CANVAS_W + 10) m.x = -10;
    if (m.y < -10) m.y = CANVAS_H + 10;
    if (m.y > CANVAS_H + 10) m.y = -10;
  }
}

// ---- Spark path ----

function startSparkPath(
  state: IntroState,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  duration: number,
  curl: number,
): void {
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular offset on the line midpoint. Positive curl pulls
  // the bezier control toward the lower-left so the spark arcs in
  // from above-right.
  const perpX = -dy / len;
  const perpY = dx / len;
  const midX = (startX + endX) / 2 + perpX * curl;
  const midY = (startY + endY) / 2 + perpY * curl;
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
): void {
  const path = state.sparkPath;
  if (!path) return;
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
  // Tiny perpendicular wobble — keeps the motion alive without
  // reading as jitter.
  const tanX =
    2 * u * (path.cpX - path.startX) + 2 * t * (path.endX - path.cpX);
  const tanY =
    2 * u * (path.cpY - path.startY) + 2 * t * (path.endY - path.cpY);
  const tlen = Math.hypot(tanX, tanY) || 1;
  const wpx = -tanY / tlen;
  const wpy = tanX / tlen;
  const wobble = Math.sin(state.time * 4.5) * 1.4;
  state.sparkX += wpx * wobble;
  state.sparkY += wpy * wobble;
  pushTrail(state, prevX, prevY);
}

function pushTrail(state: IntroState, x: number, y: number): void {
  state.sparkTrail.push({ x, y });
  if (state.sparkTrail.length > 36) state.sparkTrail.shift();
}

// ---- Render ----

export function drawIntro(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
  viewW: number,
  viewH: number,
  dpr: number,
): void {
  const scale = Math.min(viewW / CANVAS_W, viewH / CANVAS_H);
  const renderW = CANVAS_W * scale;
  const renderH = CANVAS_H * scale;
  const offsetX = (viewW - renderW) / 2;
  const offsetY = (viewH - renderH) / 2;

  // Pure black backdrop covers letterbox bars too.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, viewW, viewH);

  // Canonical 1200×800 canvas space.
  ctx.setTransform(
    scale * dpr,
    0,
    0,
    scale * dpr,
    offsetX * dpr,
    offsetY * dpr,
  );

  drawGrid(ctx, state);
  drawDust(ctx, state);

  if (state.sparkActive || state.sparkTrail.length > 0) {
    drawSpark(ctx, state);
  }

  if (state.heroBloom > 0) drawHeroBloom(ctx, state);

  // Hero is drawn at all times. During dormant the ring is dim slate
  // and the lid covers the iris with pure black, so the body reads
  // as a barely-there silhouette — exactly the "glyph in the void"
  // brief.
  drawHero(ctx, state);

  drawVignette(ctx);

  if (state.mergeFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * state.mergeFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  if (state.phase === "askname") drawAskNameText(ctx, state);

  if (state.finalFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.finalFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  if (state.phase === "fadein") {
    const t = state.phaseTime / PHASE_DURATIONS.fadein;
    const a = 1 - smoothstep(t);
    if (a > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGrid(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Slow drifting vector grid — sits behind the void as a hint of
  // structure. Dim enough that the eye stays the focal point.
  ctx.save();
  ctx.strokeStyle = "rgba(40, 80, 130, 0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const offX = state.gridOffsetX;
  const offY = state.gridOffsetY;
  for (
    let x = -GRID_SPACING + (offX % GRID_SPACING);
    x < CANVAS_W + GRID_SPACING;
    x += GRID_SPACING
  ) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_H);
  }
  for (
    let y = -GRID_SPACING + (offY % GRID_SPACING);
    y < CANVAS_H + GRID_SPACING;
    y += GRID_SPACING
  ) {
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_W, y);
  }
  ctx.stroke();
  // Radial wash from the eye centre fades the grid to deep black at
  // the edges so the composition pools around the focal point.
  const wash = ctx.createRadialGradient(
    EYE_CX,
    EYE_CY,
    80,
    EYE_CX,
    EYE_CY,
    720,
  );
  wash.addColorStop(0, "rgba(0, 0, 0, 0)");
  wash.addColorStop(1, "rgba(0, 0, 0, 0.85)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

function drawDust(ctx: CanvasRenderingContext2D, state: IntroState): void {
  ctx.save();
  for (const m of state.dust) {
    ctx.fillStyle = `rgba(255, 255, 255, ${m.alpha})`;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Soft trail — alpha grows along the path so the head reads as the
  // brightest point.
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

  // Two soft halo layers — wispy, no hot pinpoint.
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

  // A few slow curling filaments — keyed to time so they don't snap
  // per-frame.
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
      const uu = s / segs;
      const swirl = Math.sin(uu * Math.PI * 1.5 + state.time * 1.4) * 4;
      cx =
        state.sparkX +
        Math.cos(angle) * len * uu +
        Math.cos(angle + Math.PI / 2) * swirl;
      cy =
        state.sparkY +
        Math.sin(angle) * len * uu +
        Math.sin(angle + Math.PI / 2) * swirl;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawHeroBloom(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
): void {
  // Soft white halo behind the body. Reads as "the spark warming up
  // inside the shell" during merge → askname.
  const r = HERO_SIZE * state.heroScale * 2.6;
  const grad = ctx.createRadialGradient(EYE_CX, EYE_CY, 0, EYE_CX, EYE_CY, r);
  grad.addColorStop(0, `rgba(255, 255, 255, ${0.55 * state.heroBloom})`);
  grad.addColorStop(0.35, `rgba(220, 240, 255, ${0.3 * state.heroBloom})`);
  grad.addColorStop(1, "rgba(165, 243, 252, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(EYE_CX, EYE_CY, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHero(ctx: CanvasRenderingContext2D, state: IntroState): void {
  // Same drawPlayerEye used in gameplay. EVERY body colour lerps from
  // dormant black/slate to the profile palette over heroIrisT, so the
  // same renderer covers both the empty-shell silhouette and the
  // awakened hero. Critically the pupil is also lerped — drawPlayerEye
  // draws the iris/pupil/highlight BEFORE clipping in the eyelids,
  // and the eyelid seam at y=0 leaks a sub-pixel hairline of whatever
  // sits underneath. If the pupil stayed white during dormant, that
  // hairline read as a bright white horizontal line through a
  // pitch-black eye.
  const ringColor = lerpHex(
    RING_DORMANT_HEX,
    state.heroProfile.outerRing,
    state.heroIrisT,
  );
  const lidColor = lerpHex(
    DORMANT_HEX,
    state.heroProfile.outerRing,
    state.heroIrisT,
  );
  const iris = lerpHex(
    DORMANT_HEX,
    state.heroProfile.iris,
    state.heroIrisT,
  );
  const pupilColor = lerpHex(
    DORMANT_HEX,
    state.heroProfile.pupil,
    state.heroIrisT,
  );
  const profile: PlayerProfile = { ...state.heroProfile, iris };
  const size = HERO_SIZE * state.heroScale;
  drawPlayerEye(ctx, state.hero, size, {
    ringColor,
    pupilColor,
    ghostColor: state.heroProfile.outerRing,
    dashDurationSec: DASH_DURATION_MS / 1000,
    profile,
    lidColor,
  });
}

function drawAskNameText(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
): void {
  // Bare monospace below the eye — no window, no brackets. The text
  // surfaces 1.5 s after the askname phase begins (silence first),
  // fades in over 0.6 s, holds, fades out over 0.6 s.
  const appearSec = 1.5;
  const fadeInSec = 0.6;
  const fadeOutSec = 0.6;
  const totalSec = PHASE_DURATIONS.askname;
  const visible = state.phaseTime - appearSec;
  if (visible < 0) return;
  let alpha = 1;
  if (visible < fadeInSec) alpha = visible / fadeInSec;
  const tailStart = totalSec - appearSec - fadeOutSec;
  if (visible > tailStart) {
    alpha = Math.min(
      alpha,
      Math.max(0, 1 - (visible - tailStart) / fadeOutSec),
    );
  }
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "300 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#a5f3fc";
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 8;
  ctx.fillText("who am i?", EYE_CX, EYE_CY + 110);
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createRadialGradient(
    EYE_CX,
    EYE_CY,
    220,
    EYE_CX,
    EYE_CY,
    720,
  );
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.75)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// ---- Util ----

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHex(a: string, b: string, t: number): string {
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * tt);
  const g = Math.round(ag + (bg - ag) * tt);
  const bl = Math.round(ab + (bb - ab) * tt);
  return `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
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
