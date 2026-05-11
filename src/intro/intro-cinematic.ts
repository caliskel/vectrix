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
import {
  createVoidBg,
  drawVoidBg,
  drawVoidVignette,
  tickVoidBg,
  type VoidBgState,
} from "../lib/void-bg";
import {
  drawScrambleText,
  makeScrambleSchedule,
  type ScrambleSchedule,
} from "../lib/scramble-text";
import { audio } from "../lib/audio";

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
  | "pullback"
  | "narration"
  | "fadeout";

const PHASE_ORDER: PhaseId[] = [
  "fadein",
  "dormant",
  "sparkapproach",
  "merge",
  "awaken",
  "askname",
  "pullback",
  "narration",
  "fadeout",
];

const PHASE_DURATIONS: Record<PhaseId, number> = {
  fadein: 1.5,
  dormant: 2.5,
  sparkapproach: 3.5,
  merge: 1.0,
  awaken: 4.0,
  askname: 4.5,
  // Camera slowly pulls back from the awakened eye, the bloom dies
  // out, and the void around it becomes the focal point again. Long
  // enough that the scale change reads as breathing rather than zoom.
  pullback: 5.5,
  // Narrator speaks four beats over typewriter text at the top of
  // the stage. Same canvas, same void — reads as one continuous
  // cinematic rather than two. Bumped from 21.5 → 24.5 to fit the
  // reverse-type erase on each beat (~35 ms / char).
  narration: 24.5,
  // Fades to BLACK (not white). The page navigation to tutorial.html
  // happens during full black so there's no scene-switch flash; the
  // tutorial loads room0 underneath the darkness.
  fadeout: 1.2,
};

// Camera scale at the start / end of the pullback — eye returns to
// roughly its dormant-phase size so the narration plays over the same
// "small glyph in the void" composition the cinematic opened on.
const PULLBACK_SCALE_END = 0.45;

// Narrator beats — four typewriter lines played sequentially during
// the narration phase. Timing is in seconds-from-narration-start.
// Each beat reverse-types itself out during a trailing eraseDuration
// window (chars dropped from the end at ~35 ms each) instead of
// alpha-fading. typeStarts retimed so later beats start AFTER the
// previous one finishes erasing.
type NarrationBeat = {
  text: string;
  typeStart: number;
  typeDuration: number; // ≈ 70 ms/char
  holdDuration: number;
  eraseDuration: number; // set at module init: text.length * NARRATION_ERASE_SPEED_MS / 1000
};

const NARRATION_ERASE_SPEED_MS = 35;

const NARRATION_BEATS: NarrationBeat[] = [
  {
    text: "Oh? A spark?",
    typeStart: 1.5,
    typeDuration: 0.85,
    holdDuration: 1.6,
    eraseDuration: 0,
  },
  {
    text: "I thought they were all destroyed by the Archivist.",
    typeStart: 4.6,
    typeDuration: 3.4,
    holdDuration: 1.9,
    eraseDuration: 0,
  },
  {
    text: "Well then. I hope you handle the task.",
    typeStart: 12.3,
    typeDuration: 2.6,
    holdDuration: 1.7,
    eraseDuration: 0,
  },
  {
    text: "Initiating training protocol.",
    typeStart: 18.4,
    typeDuration: 1.9,
    holdDuration: 1.6,
    eraseDuration: 0,
  },
];
for (const beat of NARRATION_BEATS) {
  beat.eraseDuration = (beat.text.length * NARRATION_ERASE_SPEED_MS) / 1000;
}

// ---- Types ----

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

  // Background — shared void renderer (grid + dust + radial wash).
  bg: VoidBgState;

  // Flashes
  mergeFlash: number;
  finalFlash: number;

  // Narrator typing — last-rendered char count, used to fire the
  // typewriter tick exactly once per new char advance. Keyed by beat
  // index so jumping between beats doesn't accidentally fire bursts.
  narratorBeatIdx: number;
  narratorCharsLast: number;
};

const DORMANT_HEX = "#000000";
// Dim slate-blue for the ring during dormant — visible enough to
// read as "a glyph is here" but dim enough that the void is what the
// viewer perceives as the focal point.
const RING_DORMANT_HEX = "#1c2436";

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
    bg: createVoidBg(CANVAS_W, CANVAS_H),
    mergeFlash: 0,
    finalFlash: 0,
    narratorBeatIdx: -1,
    narratorCharsLast: 0,
  };
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
      // Colour transition wraps up during the slow-crack window so
      // the body has its real palette before the saccade starts.
      state.heroIrisT = Math.min(1, state.heroIrisT + dt / 0.5);
      state.heroBloom = Math.max(0, 1 - u * 0.7);
      state.heroScale = lerp(0.82, HERO_SCALE_FULL, easeOutCubic(u));
      // 4-second awaken phase. Four acts:
      //  1) slow drowsy crack to 20 % open;
      //  2) hold cracked while pupil saccades right → left → centre,
      //     with three reflex half-blinks (0.20 → 0 → 0.20) between
      //     and after the saccade moves;
      //  3) close back to 0 (the body briefly shuts again);
      //  4) smooth full open. Engine handoff at 0.95.
      //
      //  u-windows:
      //   0.00–0.04  hold closed
      //   0.04–0.20  slow crack to 0.20 (~0.64 s)
      //   0.20–0.78  HOLD CRACKED with saccades + reflex blinks (~2.3 s)
      //   0.78–0.84  close back to 0
      //   0.84–0.86  held shut
      //   0.86–0.95  smooth full open (~0.36 s)
      //   0.95–1.00  wide. Engine handoff.
      const CRACK = 0.20;
      let blinkOpen = 0;
      let pupilX = 0;
      let pupilY = 0;

      if (u < 0.04) {
        blinkOpen = 0;
      } else if (u < 0.20) {
        const k = (u - 0.04) / 0.16;
        blinkOpen = easeInOutCubic(k) * CRACK;
      } else if (u < 0.78) {
        // Held cracked. Saccade + reflex-blink choreography across
        // a ~2.3 s window (in 4 s phase). Each saccade dart is
        // ~0.28 s and each reflex blink is a sinusoidal dip from
        // CRACK to 0 and back over ~0.24 s.
        //
        //   0.20–0.27  dart right
        //   0.27–0.33  reflex blink at right
        //   0.33–0.40  hold right
        //   0.40–0.47  sweep to left
        //   0.47–0.53  reflex blink at left
        //   0.53–0.60  hold left
        //   0.60–0.66  settle to centre
        //   0.66–0.72  reflex blink at centre
        //   0.72–0.78  hold centre
        blinkOpen = CRACK;
        const SACC = 9;
        if (u < 0.27) {
          const k = (u - 0.20) / 0.07;
          pupilX = easeOutCubic(k) * SACC;
        } else if (u < 0.33) {
          pupilX = SACC;
          blinkOpen = blinkPulse((u - 0.27) / 0.06, CRACK);
        } else if (u < 0.40) {
          pupilX = SACC;
        } else if (u < 0.47) {
          const k = (u - 0.40) / 0.07;
          pupilX = lerp(SACC, -SACC, easeOutCubic(k));
        } else if (u < 0.53) {
          pupilX = -SACC;
          blinkOpen = blinkPulse((u - 0.47) / 0.06, CRACK);
        } else if (u < 0.60) {
          pupilX = -SACC;
        } else if (u < 0.66) {
          const k = (u - 0.60) / 0.06;
          pupilX = lerp(-SACC, 0, easeOutCubic(k));
        } else if (u < 0.72) {
          pupilX = 0;
          blinkOpen = blinkPulse((u - 0.66) / 0.06, CRACK);
        } else {
          pupilX = 0;
        }
      } else if (u < 0.84) {
        const k = (u - 0.78) / 0.06;
        blinkOpen = lerp(CRACK, 0, easeInQuad(k));
      } else if (u < 0.86) {
        blinkOpen = 0;
      } else if (u < 0.95) {
        const k = (u - 0.86) / 0.09;
        blinkOpen = easeInOutCubic(k);
      } else {
        blinkOpen = 1;
      }

      state.heroBlinkOpenT = blinkOpen;
      state.hero.pupilOffsetX = pupilX;
      state.hero.pupilOffsetY = pupilY;

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
    case "pullback": {
      // Camera retreats with a soft S-curve. easeInOutQuad's slope is
      // gentler in the middle than cubic — no abrupt mid-phase
      // acceleration, reads as a long sustained pull. Bloom finishes
      // burning off across the same window.
      const startScale = HERO_SCALE_FULL;
      state.heroScale = lerp(
        startScale,
        PULLBACK_SCALE_END,
        easeInOutQuad(u),
      );
      state.heroBloom = Math.max(0, state.heroBloom - dt * 0.4);
      break;
    }
    case "narration":
      // Hold the small-in-void composition. Hero stays at pullback's
      // end scale, engine drives the eye's blinks / idle look, the
      // void grid drifts on its own.
      state.heroScale = PULLBACK_SCALE_END;
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
  tickVoidBg(state.bg, dt, CANVAS_W, CANVAS_H, speedMul);
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

  drawVoidBg(ctx, state.bg, CANVAS_W, CANVAS_H, EYE_CX, EYE_CY);

  if (state.sparkActive || state.sparkTrail.length > 0) {
    drawSpark(ctx, state);
  }

  if (state.heroBloom > 0) drawHeroBloom(ctx, state);

  // Hero is drawn at all times. During dormant the ring is dim slate
  // and the lid covers the iris with pure black, so the body reads
  // as a barely-there silhouette — exactly the "glyph in the void"
  // brief.
  drawHero(ctx, state);

  drawVoidVignette(ctx, CANVAS_W, CANVAS_H, EYE_CX, EYE_CY);

  if (state.mergeFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * state.mergeFlash})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  if (state.phase === "askname") drawAskNameText(ctx, state);
  if (state.phase === "narration") drawNarration(ctx, state);

  if (state.finalFlash > 0) {
    // Fade-to-BLACK during the final phase so the page navigation
    // to tutorial.html happens under cover of darkness. Tutorial
    // loads room0 underneath; the scene-switch feels like the camera
    // simply closed its eyes rather than a hard cut.
    ctx.fillStyle = `rgba(0, 0, 0, ${state.finalFlash})`;
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
  // dormant black/slate to the profile palette over heroIrisT — and
  // crucially the lerped values are stuffed into the PROFILE field
  // because drawPlayerEye prefers profile.outerRing / profile.pupil
  // over the bare ringColor / pupilColor opts. Without that
  // indirection the dormant body silently reverted to the white
  // profile defaults and the eyelid seam at y=0 leaked a 1-pixel
  // white hairline of pupil + highlight through pitch-black lids.
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
  const highlightColor = lerpHex(
    DORMANT_HEX,
    "#ffffff",
    state.heroIrisT,
  );
  const profile: PlayerProfile = {
    outerRing: ringColor,
    iris,
    pupil: pupilColor,
    dashParticles: state.heroProfile.dashParticles,
  };
  // Camera-style scaling: draw the eye at a fixed HERO_SIZE and wrap
  // it in ctx.scale around the eye centre. drawPlayerEye's cached
  // ring sprite is keyed on `Math.round(radius)`, so animating size
  // by tweening drawPlayerEye's size param thrashes the cache and
  // makes the eye visibly "step" across integer pixel boundaries
  // during the pullback. Wrapping in ctx.scale keeps the sprite at
  // one cached radius and lets canvas interpolate the visual size
  // smoothly — no stepping, no sprite rebuilds per frame.
  const s = state.heroScale;
  ctx.save();
  ctx.translate(EYE_CX, EYE_CY);
  ctx.scale(s, s);
  ctx.translate(-EYE_CX, -EYE_CY);
  drawPlayerEye(ctx, state.hero, HERO_SIZE, {
    ringColor,
    pupilColor,
    ghostColor: ringColor,
    dashDurationSec: DASH_DURATION_MS / 1000,
    profile,
    lidColor,
    highlightColor,
  });
  ctx.restore();
}

// Hero's first thought ("who am i?") emerges as scrambled glyphs,
// then resolves left-to-right into the legible question. The
// schedule fits the askname phase (4.5 s): silence → scramble fade-in
// → settle → hold → fade out.
const ASK_NAME_SCHEDULE: ScrambleSchedule = makeScrambleSchedule({
  appearStart: 1.5,
  fadeInDuration: 0.5,
  settleDuration: 1.4,
  holdDuration: 0.5,
  fadeOutDuration: 0.6,
});

function drawAskNameText(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
): void {
  drawScrambleText(
    ctx,
    "who am i?",
    state.phaseTime,
    ASK_NAME_SCHEDULE,
    EYE_CX,
    EYE_CY + 110,
  );
}

function drawNarration(
  ctx: CanvasRenderingContext2D,
  state: IntroState,
): void {
  // Find the active beat — beats are sequential and retimed so they
  // don't overlap; pick the first whose [typeStart, end] window
  // contains phaseTime.
  const t = state.phaseTime;
  let active: NarrationBeat | null = null;
  let activeIdx = -1;
  for (let i = 0; i < NARRATION_BEATS.length; i++) {
    const beat = NARRATION_BEATS[i];
    const end =
      beat.typeStart +
      beat.typeDuration +
      beat.holdDuration +
      beat.eraseDuration;
    if (t >= beat.typeStart && t < end) {
      active = beat;
      activeIdx = i;
      break;
    }
  }
  if (!active) return;

  const rel = t - active.typeStart;
  const holdEnd = active.typeDuration + active.holdDuration;
  // typing phase → hold phase → reverse-type erase phase.
  let charsVisible: number;
  let inTyping = false;
  if (rel < active.typeDuration) {
    const typedT = Math.min(1, rel / active.typeDuration);
    charsVisible = Math.floor(active.text.length * typedT);
    inTyping = true;
  } else if (rel < holdEnd) {
    charsVisible = active.text.length;
  } else {
    const eraseRel = rel - holdEnd;
    const erased = Math.floor(
      eraseRel / (NARRATION_ERASE_SPEED_MS / 1000),
    );
    charsVisible = Math.max(0, active.text.length - erased);
    if (charsVisible <= 0) return;
  }
  // Typewriter tick — fire once per new revealed character during the
  // typing phase. Resets across beat boundaries so each line starts
  // fresh. No tick during erase (the visual is a deliberate
  // backspace; sound would imply more characters being added).
  if (state.narratorBeatIdx !== activeIdx) {
    state.narratorBeatIdx = activeIdx;
    state.narratorCharsLast = 0;
  }
  if (inTyping && charsVisible > state.narratorCharsLast) {
    audio.play.narratorTick();
    state.narratorCharsLast = charsVisible;
  } else if (!inTyping) {
    // hold / erase: keep last value sane so a re-enter into typing
    // (shouldn't happen) wouldn't burst-fire all remaining ticks.
    state.narratorCharsLast = charsVisible;
  }
  const partial = active.text.slice(0, charsVisible);

  // Soft fade-in on the first 0.25 s so the line doesn't snap on.
  // No alpha drop at the end — the erase is the disappear animation.
  const fadeInSec = 0.25;
  const alpha = rel < fadeInSec ? rel / fadeInSec : 1;
  if (alpha <= 0) return;

  const showCursor =
    rel < holdEnd
      ? rel < active.typeDuration || Math.floor(rel * 2.5) % 2 === 0
      : true; // keep cursor pinned to the trailing edge while erasing
  const display = partial + (showCursor ? "▍" : "");

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font =
    "500 24px ui-monospace, 'SF Mono', 'Consolas', 'Liberation Mono', monospace";
  ctx.fillStyle = "#7dd3fc";
  ctx.shadowColor = "#38bdf8";
  ctx.shadowBlur = 12;
  // Top of the stage — 120 px from the top of the canonical 800-px
  // canvas, centred horizontally.
  ctx.fillText(display, EYE_CX, 120);
  ctx.restore();
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

function easeInQuad(t: number): number {
  return t * t;
}

// Sinusoidal dip from `baseline` to 0 and back to `baseline`. k=0
// returns baseline, k=0.5 returns 0, k=1 returns baseline. Used for
// reflex half-blinks while the eye is held at a non-zero cracked
// state — drops to fully shut at the midpoint and rises back.
function blinkPulse(k: number, baseline: number): number {
  if (k <= 0 || k >= 1) return baseline;
  return baseline * (1 - Math.sin(Math.PI * k));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ---- Skip ----

export const MIN_WATCH_BEFORE_SKIP_SEC = 2.0;

export function trySkipIntro(state: IntroState): boolean {
  if (state.time < MIN_WATCH_BEFORE_SKIP_SEC) return false;
  if (state.done) return false;
  // Hard skip — slam the screen to full black this frame and flag
  // the run as done so main.ts triggers the redirect. The tutorial
  // page handles its own fade-in from black on the other side, so
  // the player sees: cinematic content → single black frame →
  // tutorial fading in. No phase fast-forward, no narration burn-down.
  state.finalFlash = 1;
  state.done = true;
  return true;
}

export const TOTAL_DURATION_SEC = PHASE_ORDER.reduce(
  (acc, p) => acc + PHASE_DURATIONS[p],
  0,
);
