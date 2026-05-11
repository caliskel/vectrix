// Epilogue cinematic — played after the Sentinel death sequence.
// Two acts:
//   1. Void scene: narrator speaks three lines over the same drifting
//      vector grid + dust we use in the intro, so the cinematic reads
//      as a bookend to the opening.
//   2. "To be continued" scene: hero recentres in a tutorial-sized
//      room with "продолжение следует" in the middle and a row of
//      six random profanity glyphs vibrating under the hero — comic
//      grumble after a hard win.
//
// Pure canvas 2D. Reuses void-bg, drawPlayerEye, and the typewriter
// pattern from intro-cinematic.ts.

import {
  BLINK_CLOSE_DURATION_MS,
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
import { audio } from "../lib/audio";

const CANVAS_W = 1200;
const CANVAS_H = 800;
const EYE_CX = 600;
const EYE_CY = 420;
const HERO_SIZE = 60;
const HERO_SCALE_VOID = 0.85;
const HERO_SCALE_ROOM = 0.95;

type PhaseId =
  | "fadein"
  | "settle"
  | "narration"
  | "voidfade"
  | "roompresent";

const PHASE_ORDER: PhaseId[] = [
  "fadein",
  "settle",
  "narration",
  "voidfade",
  "roompresent",
];

// The first three sentences together run ~18 s with reverse-type
// erase between beats. The "roompresent" phase has no auto-exit —
// it sits until the player clicks or presses any key.
const PHASE_DURATIONS: Record<PhaseId, number> = {
  fadein: 1.5,
  settle: 1.5,
  narration: 18.5,
  voidfade: 1.5,
  // Sentinel for "stays until input"; never reached by the auto-
  // advance because updateEpilogue clamps phaseTime in this state.
  roompresent: 9_999,
};

const NARRATION_ERASE_SPEED_MS = 35;

type NarrationBeat = {
  text: string;
  typeStart: number;
  typeDuration: number;
  holdDuration: number;
  eraseDuration: number;
};

// Three beats, total length ~18 s. The third beat ends right before
// the voidfade phase begins, so the line is fully off screen before
// the curtain drops.
const NARRATION_BEATS: NarrationBeat[] = [
  {
    text: "Ого! Не ожидал твоего успеха.",
    typeStart: 0.8,
    typeDuration: 2.1,
    holdDuration: 1.6,
    eraseDuration: 0,
  },
  {
    text: "Может с твоим появлением что-то изменится?",
    typeStart: 6.6,
    typeDuration: 3.0,
    holdDuration: 1.6,
    eraseDuration: 0,
  },
  {
    text: "Удачи Искра, она тебе понадобится.",
    typeStart: 13.4,
    typeDuration: 2.5,
    holdDuration: 1.8,
    eraseDuration: 0,
  },
];
for (const beat of NARRATION_BEATS) {
  beat.eraseDuration = (beat.text.length * NARRATION_ERASE_SPEED_MS) / 1000;
}

// Profanity glyphs — 6 chars drawn under the hero in the room scene,
// vibrating in place. Set picked to read as cartoon-profanity.
const PROFANITY_GLYPHS = "!@#$%&*?^~+=";
const PROFANITY_COUNT = 6;

export type EpilogueState = {
  time: number;
  phase: PhaseId;
  phaseTime: number;
  done: boolean;

  hero: Player;
  heroProfile: PlayerProfile;

  bg: VoidBgState;

  narratorBeatIdx: number;
  narratorCharsLast: number;

  // "Room scene" props — 6 fixed glyphs chosen once on entry, plus
  // a random per-glyph phase so the vibration looks individual.
  profanity: { ch: string; phase: number; speed: number }[];
  profanityStart: number;
};

export function createEpilogueState(): EpilogueState {
  const heroProfile = loadPlayerProfile();
  const hero = createPlayer();
  hero.x = EYE_CX;
  hero.y = EYE_CY;
  hero.isClosing = false;
  hero.closeAmount = 0;
  hero.blinkActive = false;
  hero.blinkElapsed = BLINK_CLOSE_DURATION_MS / 1000;
  hero.breathPhase = 0;
  hero.pupilOffsetX = 0;
  hero.pupilOffsetY = 0;
  const profanity: { ch: string; phase: number; speed: number }[] = [];
  for (let i = 0; i < PROFANITY_COUNT; i++) {
    profanity.push({
      ch: PROFANITY_GLYPHS[
        Math.floor(Math.random() * PROFANITY_GLYPHS.length)
      ],
      phase: Math.random() * Math.PI * 2,
      speed: 6 + Math.random() * 4,
    });
  }
  return {
    time: 0,
    phase: "fadein",
    phaseTime: 0,
    done: false,
    hero,
    heroProfile,
    bg: createVoidBg(CANVAS_W, CANVAS_H),
    narratorBeatIdx: -1,
    narratorCharsLast: 0,
    profanity,
    profanityStart: 0,
  };
}

export function updateEpilogue(state: EpilogueState, dt: number): void {
  state.time += dt;
  state.phaseTime += dt;
  const dur = PHASE_DURATIONS[state.phase];
  if (state.phase !== "roompresent" && state.phaseTime >= dur) {
    const idx = PHASE_ORDER.indexOf(state.phase);
    if (idx < PHASE_ORDER.length - 1) {
      state.phase = PHASE_ORDER[idx + 1];
      state.phaseTime = 0;
      onPhaseEnter(state);
    }
  }
  if (state.phase === "roompresent") {
    state.profanityStart += dt;
  }
  // Idle hero animation — same engine sandbox/rooms use, so blinks
  // and breath read the same.
  updateEye(state.hero, dt, {
    threat: null,
    size: HERO_SIZE,
    dashDurationSec: DASH_DURATION_MS / 1000,
  });
  tickVoidBg(state.bg, dt, CANVAS_W, CANVAS_H, 0.6);
}

function onPhaseEnter(state: EpilogueState): void {
  if (state.phase === "roompresent") {
    // Re-roll the profanity once the room scene starts — gives the
    // appearance some control even if the cinematic restarts.
    for (const p of state.profanity) {
      p.ch =
        PROFANITY_GLYPHS[
          Math.floor(Math.random() * PROFANITY_GLYPHS.length)
        ];
      p.phase = Math.random() * Math.PI * 2;
    }
    state.profanityStart = 0;
  }
}

/** Player-driven skip: fast-forward the void cinematic to the room
 *  scene. Called by the page entry on any key / pointer event. */
export function trySkipEpilogue(state: EpilogueState): void {
  if (state.phase === "roompresent") return;
  state.phase = "roompresent";
  state.phaseTime = 0;
  onPhaseEnter(state);
}

export function drawEpilogue(
  ctx: CanvasRenderingContext2D,
  state: EpilogueState,
  viewW: number,
  viewH: number,
  dpr: number,
): void {
  // Letterbox onto the canonical 1200×800 stage so layout maths stay
  // consistent across window sizes.
  const scale = Math.min(viewW / CANVAS_W, viewH / CANVAS_H);
  const offsetX = (viewW - CANVAS_W * scale) / 2;
  const offsetY = (viewH - CANVAS_H * scale) / 2;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  if (state.phase === "roompresent") {
    drawRoomScene(ctx, state);
  } else {
    drawVoidScene(ctx, state);
  }
  ctx.restore();
}

function drawVoidScene(
  ctx: CanvasRenderingContext2D,
  state: EpilogueState,
): void {
  drawVoidBg(ctx, state.bg, CANVAS_W, CANVAS_H, EYE_CX, EYE_CY);
  drawVoidVignette(ctx, CANVAS_W, CANVAS_H, EYE_CX, EYE_CY);
  // Hero drawn slightly above centre so the narrator text has space.
  ctx.save();
  ctx.translate(EYE_CX, EYE_CY);
  ctx.scale(HERO_SCALE_VOID, HERO_SCALE_VOID);
  ctx.translate(-EYE_CX, -EYE_CY);
  drawPlayerEye(ctx, state.hero, HERO_SIZE, {
    ringColor: state.heroProfile.outerRing,
    pupilColor: state.heroProfile.pupil,
    ghostColor: state.heroProfile.outerRing,
    dashDurationSec: DASH_DURATION_MS / 1000,
    profile: state.heroProfile,
  });
  ctx.restore();

  if (state.phase === "narration") drawNarration(ctx, state);

  // Curtain on the way in and the way out.
  if (state.phase === "fadein") {
    const a = 1 - Math.min(1, state.phaseTime / PHASE_DURATIONS.fadein);
    if (a > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
  } else if (state.phase === "voidfade") {
    const a = Math.min(1, state.phaseTime / PHASE_DURATIONS.voidfade);
    if (a > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
  }
}

function drawRoomScene(
  ctx: CanvasRenderingContext2D,
  state: EpilogueState,
): void {
  // Match the tutorial / rooms canonical stage so the screen reads
  // as "a room we know." Dark backplate + faint cyan grid + perimeter
  // wall outline, lifted from the rooms-game render path but pared
  // down to the static essentials.
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Faint grid.
  ctx.save();
  ctx.strokeStyle = "rgba(0, 229, 255, 0.04)";
  ctx.lineWidth = 1;
  const step = 60;
  ctx.beginPath();
  for (let x = step; x < CANVAS_W; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_H);
  }
  for (let y = step; y < CANVAS_H; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_W, y);
  }
  ctx.stroke();
  ctx.restore();
  // Perimeter wall outline — same look as room walls in the game.
  const WALL_T = 30;
  ctx.save();
  ctx.fillStyle = "rgba(20, 25, 43, 0.85)";
  ctx.fillRect(0, 0, CANVAS_W, WALL_T);
  ctx.fillRect(0, CANVAS_H - WALL_T, CANVAS_W, WALL_T);
  ctx.fillRect(0, 0, WALL_T, CANVAS_H);
  ctx.fillRect(CANVAS_W - WALL_T, 0, WALL_T, CANVAS_H);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  ctx.strokeRect(WALL_T / 2, WALL_T / 2, CANVAS_W - WALL_T, CANVAS_H - WALL_T);
  ctx.restore();

  // "Продолжение следует" — bright Orbitron-styled headline near the
  // top, slow shimmer so it doesn't feel static.
  const u = Math.min(1, state.profanityStart / 0.8);
  const headlineAlpha = u;
  if (headlineAlpha > 0) {
    const shimmer =
      0.85 + 0.15 * Math.sin(state.profanityStart * Math.PI * 1.2);
    ctx.save();
    ctx.globalAlpha = headlineAlpha * shimmer;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font =
      "700 64px Orbitron, ui-monospace, 'SF Mono', Consolas, monospace";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 229, 255, 0.85)";
    ctx.shadowBlur = 24;
    ctx.fillText("продолжение следует", CANVAS_W / 2, 230);
    ctx.restore();
  }

  // Hero — centred a bit below the headline. Pure idle render via
  // the same engine the in-game player uses.
  const heroY = CANVAS_H / 2 + 40;
  ctx.save();
  ctx.translate(CANVAS_W / 2, heroY);
  ctx.scale(HERO_SCALE_ROOM, HERO_SCALE_ROOM);
  ctx.translate(-CANVAS_W / 2, -heroY);
  state.hero.x = CANVAS_W / 2;
  state.hero.y = heroY;
  drawPlayerEye(ctx, state.hero, HERO_SIZE, {
    ringColor: state.heroProfile.outerRing,
    pupilColor: state.heroProfile.pupil,
    ghostColor: state.heroProfile.outerRing,
    dashDurationSec: DASH_DURATION_MS / 1000,
    profile: state.heroProfile,
  });
  ctx.restore();

  // Profanity glyphs — six chars under the hero. Each glyph
  // vibrates in place (sin offset + alpha jitter) so the row reads
  // as comic cursing, not a static label.
  const glyphY = heroY + 90;
  const glyphSpacing = 38;
  const rowWidth = (PROFANITY_COUNT - 1) * glyphSpacing;
  const rowLeft = CANVAS_W / 2 - rowWidth / 2;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font =
    "700 42px ui-monospace, 'SF Mono', Consolas, 'Liberation Mono', monospace";
  for (let i = 0; i < state.profanity.length; i++) {
    const p = state.profanity[i];
    const t = state.profanityStart * p.speed + p.phase;
    const dx = Math.sin(t * 1.7) * 3.5;
    const dy = Math.cos(t) * 2.5;
    const rot = Math.sin(t * 0.8) * 0.18;
    const flicker = 0.7 + Math.abs(Math.sin(t * 2.2)) * 0.3;
    const x = rowLeft + i * glyphSpacing + dx;
    const y = glyphY + dy;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = headlineAlpha * flicker;
    ctx.fillStyle = "#ff2d55";
    ctx.shadowColor = "#ff5577";
    ctx.shadowBlur = 12;
    ctx.fillText(p.ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // Footer hint — "ANY KEY → MENU" so the player has a clear exit.
  ctx.save();
  ctx.globalAlpha = Math.min(1, state.profanityStart / 1.6) * 0.55;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#7d8590";
  ctx.fillText(
    "PRESS ANY KEY — RETURN TO MAIN MENU",
    CANVAS_W / 2,
    CANVAS_H - 32,
  );
  ctx.restore();
}

function drawNarration(
  ctx: CanvasRenderingContext2D,
  state: EpilogueState,
): void {
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
  if (state.narratorBeatIdx !== activeIdx) {
    state.narratorBeatIdx = activeIdx;
    state.narratorCharsLast = 0;
  }
  if (inTyping && charsVisible > state.narratorCharsLast) {
    audio.play.narratorTick();
    state.narratorCharsLast = charsVisible;
  } else if (!inTyping) {
    state.narratorCharsLast = charsVisible;
  }
  const partial = active.text.slice(0, charsVisible);

  const fadeInSec = 0.25;
  const alpha = rel < fadeInSec ? rel / fadeInSec : 1;
  if (alpha <= 0) return;

  const showCursor =
    rel < holdEnd
      ? rel < active.typeDuration || Math.floor(rel * 2.5) % 2 === 0
      : true;
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
  ctx.fillText(display, EYE_CX, 130);
  ctx.restore();
}
