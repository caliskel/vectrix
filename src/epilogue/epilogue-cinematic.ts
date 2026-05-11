// Epilogue cinematic — played after the Sentinel death sequence.
// Two acts:
//   1. Void scene: narrator speaks three English lines over the same
//      drifting grid + dust used in the intro, so the cinematic reads
//      as a bookend to the opening.
//   2. Playable "to be continued" room (tutorial-sized): the hero can
//      walk around with the same physics they used in-game. A turquoise
//      "TO BE CONTINUED" headline resolves in via the same scramble-
//      text effect the intro used for "who am i?", and six random
//      profanity glyphs vibrate just below the hero — comic grumble
//      after a hard fight. Movement only, no enemies, no exit; the
//      footer hint tells the player to press a key to return to menu.
//
// Pure canvas 2D. Reuses void-bg, drawPlayerEye, the typewriter pattern
// from intro-cinematic.ts, and the scramble-text helper.

import {
  BLINK_CLOSE_DURATION_MS,
  DASH_DURATION_MS,
  PLAYER_MAX_SPEED,
  PLAYER_WALK_FACTOR,
} from "../lib/config";
import {
  createPlayer,
  drawPlayerEye,
  inputDirection,
  loadPlayerProfile,
  updateEye,
  type Player,
  type PlayerProfile,
} from "../lib/player";
import {
  isActionPressed,
  loadKeybinds,
  type KeybindProfile,
} from "../lib/keybinds";
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
const EYE_CY = 420;
// HERO_SIZE matches the intro cinematic (60 px) so the cached ring
// sprite is generated at a high enough resolution to stay crisp when
// the letterbox transform upscales the canonical canvas onto a
// large window. The in-game PLAYER_SIZE (32) is intentionally
// rejected here — its sprite cache is too low-res to survive the
// 1.6×+ letterbox magnification cleanly and read as "pixelated."
const HERO_SIZE = 60;
// Void scene scale matches the intro's narration phase
// (PULLBACK_SCALE_END = 0.45) so the hero sits at the same small
// "glyph in the void" composition during the narrator beats.
const HERO_SCALE_VOID = 0.45;
const ACCEL_FACTOR = 9;
const FRICTION = 8.0;

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

const PHASE_DURATIONS: Record<PhaseId, number> = {
  fadein: 1.5,
  settle: 1.5,
  // Three English beats with reverse-type erase between them — total
  // ~18.5 s, sized to match the intro's narration pacing.
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

// English narrator beats. Pacing follows the intro: typing speed
// roughly tracks ~70 ms/char, holdDuration covers the legibility
// window before reverse-type erase kicks in. typeStarts retimed so
// later beats begin AFTER the previous one fully erases.
const NARRATION_BEATS: NarrationBeat[] = [
  {
    text: "Oh? I didn't expect you to win.",
    typeStart: 0.8,
    typeDuration: 2.4,
    holdDuration: 1.6,
    eraseDuration: 0,
  },
  {
    text: "Maybe your arrival will change something?",
    typeStart: 6.8,
    typeDuration: 3.0,
    holdDuration: 1.6,
    eraseDuration: 0,
  },
  {
    text: "Good luck, Spark. You'll need it.",
    typeStart: 13.4,
    typeDuration: 2.5,
    holdDuration: 1.9,
    eraseDuration: 0,
  },
];
for (const beat of NARRATION_BEATS) {
  beat.eraseDuration = (beat.text.length * NARRATION_ERASE_SPEED_MS) / 1000;
}

// Profanity glyphs — six chars drawn under the hero in the room scene,
// vibrating in place. Set picked to read as cartoon-profanity.
const PROFANITY_GLYPHS = "!@#$%&*?^~+=";
const PROFANITY_COUNT = 6;

// "TO BE CONTINUED" scramble schedule. The user asked for the SAME
// style as the tutorial's "who was that?" boot thought (default
// drawScrambleText font + scramble effect) but recoloured to match
// the tutorial hint banner at the bottom of the screen. Slow settle
// reads as a deliberate end-of-act beat rather than a quick thought.
const TBC_TEXT = "TO BE CONTINUED";
const TBC_SCRAMBLE_SCHEDULE: ScrambleSchedule = makeScrambleSchedule({
  appearStart: 0.4,
  fadeInDuration: 0.6,
  settleDuration: 1.9,
  // Long hold — this is the final beat of the game, not a transient
  // thought. Big honking holdDuration so the scramble never fades
  // back out while the player explores the room.
  holdDuration: 9_000,
  fadeOutDuration: 0.4,
});
// Matches the tutorial hint banner colour (HINT_TEXT_COLOR =
// "#7dd3fc"). Per the user's note, the "WHITE / specific font" feel
// they want is the *scramble style* of "who was that?" — kept by
// using drawScrambleText's default font — paired with the hint
// banner colour for cohesion with the rest of the tutorial-style
// presentation.
const TBC_COLOR = "#7dd3fc";
const TBC_SHADOW = "#7dd3fc";

export type EpilogueState = {
  time: number;
  phase: PhaseId;
  phaseTime: number;
  done: boolean;

  hero: Player;
  heroProfile: PlayerProfile;
  // Input — bound to the player's saved keybinds (same global profile
  // as gameplay). Movement uses the same accel/friction model as the
  // tutorial / sandbox loops so the feel carries over.
  keybinds: KeybindProfile;
  keys: Set<string>;

  bg: VoidBgState;

  narratorBeatIdx: number;
  narratorCharsLast: number;

  // "Room scene" props — 6 fixed glyphs chosen once on entry, plus a
  // random per-glyph phase so the vibration looks individual.
  profanity: { ch: string; phase: number; speed: number }[];
  profanityStart: number;
};

export function createEpilogueState(): EpilogueState {
  const heroProfile = loadPlayerProfile();
  const hero = createPlayer();
  hero.x = CANVAS_W / 2;
  hero.y = CANVAS_H / 2 + 40;
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
    keybinds: loadKeybinds(),
    keys: new Set<string>(),
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
    tickRoomScene(state, dt);
  }
  // Idle hero animation — same engine sandbox/rooms use, so blinks
  // and breath read the same. Drives pupil / breath even during the
  // playable room (the eye still tracks dash cooldown etc.).
  updateEye(state.hero, dt, {
    threat: null,
    size: HERO_SIZE,
    dashDurationSec: DASH_DURATION_MS / 1000,
  });
  tickVoidBg(state.bg, dt, CANVAS_W, CANVAS_H, 0.6);
}

function onPhaseEnter(state: EpilogueState): void {
  if (state.phase === "roompresent") {
    // Re-roll the profanity once the room scene starts.
    for (const p of state.profanity) {
      p.ch =
        PROFANITY_GLYPHS[
          Math.floor(Math.random() * PROFANITY_GLYPHS.length)
        ];
      p.phase = Math.random() * Math.PI * 2;
    }
    state.profanityStart = 0;
    // Reset player velocity so the room starts still even if a stray
    // accel slipped through from the void scene. Spawn near the
    // bottom-centre so the hero stands clear of the "TO BE CONTINUED"
    // title pinned at the canvas centre.
    state.hero.vx = 0;
    state.hero.vy = 0;
    state.hero.x = CANVAS_W / 2;
    state.hero.y = CANVAS_H - 200;
  }
}

/** Player-driven skip: fast-forward the void cinematic to the room
 *  scene. Called by the page entry on any key / pointer event during
 *  the void. */
export function trySkipEpilogue(state: EpilogueState): void {
  if (state.phase === "roompresent") return;
  state.phase = "roompresent";
  state.phaseTime = 0;
  onPhaseEnter(state);
}

/** Input plumbing — the page entry registers keydown/keyup at window
 *  level and forwards into these. Mirrors the gameplay loops so a
 *  rebound key works here too. */
export function epilogueOnKeyDown(state: EpilogueState, code: string): void {
  state.keys.add(code);
}
export function epilogueOnKeyUp(state: EpilogueState, code: string): void {
  state.keys.delete(code);
}
export function epilogueClearKeys(state: EpilogueState): void {
  state.keys.clear();
}
export function epilogueIsInRoom(state: EpilogueState): boolean {
  return state.phase === "roompresent";
}

function tickRoomScene(state: EpilogueState, dt: number): void {
  const player = state.hero;
  // Same accel/friction model as sandbox + tutorial: ramp into the
  // input direction, exponential damping, then cap speed to the walk
  // factor when WALK is held.
  const input = inputDirection(state.keys, state.keybinds);
  if (input.x !== 0 || input.y !== 0) {
    player.facingX = input.x;
    player.facingY = input.y;
  }
  const accel = PLAYER_MAX_SPEED * ACCEL_FACTOR;
  player.vx += input.x * accel * dt;
  player.vy += input.y * accel * dt;
  const damp = Math.exp(-FRICTION * dt);
  player.vx *= damp;
  player.vy *= damp;
  const cap = isActionPressed("walk", state.keys, state.keybinds)
    ? PLAYER_MAX_SPEED * PLAYER_WALK_FACTOR
    : PLAYER_MAX_SPEED;
  const sp = Math.hypot(player.vx, player.vy);
  if (sp > cap) {
    const k = cap / sp;
    player.vx *= k;
    player.vy *= k;
  }
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  // Perimeter clamp — uses the cinematic HERO_SIZE (60) so the visual
  // hero edge stops at the wall rather than the smaller in-game
  // PLAYER_SIZE (32). 30 px wall thickness matches every other room
  // in the game.
  const half = HERO_SIZE / 2;
  const WALL_T = 30;
  const minX = WALL_T + half;
  const maxX = CANVAS_W - WALL_T - half;
  const minY = WALL_T + half;
  const maxY = CANVAS_H - WALL_T - half;
  if (player.x < minX) {
    player.x = minX;
    if (player.vx < 0) player.vx = 0;
  } else if (player.x > maxX) {
    player.x = maxX;
    if (player.vx > 0) player.vx = 0;
  }
  if (player.y < minY) {
    player.y = minY;
    if (player.vy < 0) player.vy = 0;
  } else if (player.y > maxY) {
    player.y = maxY;
    if (player.vy > 0) player.vy = 0;
  }
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
  state.hero.x = EYE_CX;
  state.hero.y = EYE_CY;
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
  // Match the tutorial / rooms canonical stage so the screen reads as
  // "a room we know." Dark backplate + faint cyan grid + perimeter
  // wall outline, lifted from the rooms-game render path but pared
  // down to the static essentials.
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Faint grid.
  ctx.save();
  ctx.strokeStyle = "rgba(0, 229, 255, 0.05)";
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
  // Perimeter wall — same 30 px wall thickness used everywhere else.
  const WALL_T = 30;
  ctx.save();
  ctx.fillStyle = "rgba(20, 25, 43, 0.9)";
  ctx.fillRect(0, 0, CANVAS_W, WALL_T);
  ctx.fillRect(0, CANVAS_H - WALL_T, CANVAS_W, WALL_T);
  ctx.fillRect(0, 0, WALL_T, CANVAS_H);
  ctx.fillRect(CANVAS_W - WALL_T, 0, WALL_T, CANVAS_H);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(WALL_T / 2, WALL_T / 2, CANVAS_W - WALL_T, CANVAS_H - WALL_T);
  ctx.restore();

  // "TO BE CONTINUED" — pinned to the centre of the room. Uses
  // drawScrambleText with the DEFAULT font ("300 22px ui-monospace,
  // SFMono-Regular, Menlo, monospace") so the scramble effect, weight
  // and size match the tutorial's "who was that?" exactly. Colour is
  // the tutorial hint-banner cyan so the line reads as part of the
  // tutorial visual language. Resolves left-to-right, then holds
  // legible while the player walks the room.
  drawScrambleText(
    ctx,
    TBC_TEXT,
    state.profanityStart,
    TBC_SCRAMBLE_SCHEDULE,
    CANVAS_W / 2,
    CANVAS_H / 2,
    {
      color: TBC_COLOR,
      shadowColor: TBC_SHADOW,
      shadowBlur: 6,
    },
  );

  // Hero — drawn at his live (x, y) from the movement physics. Same
  // engine the in-game player uses.
  ctx.save();
  drawPlayerEye(ctx, state.hero, HERO_SIZE, {
    ringColor: state.heroProfile.outerRing,
    pupilColor: state.heroProfile.pupil,
    ghostColor: state.heroProfile.outerRing,
    dashDurationSec: DASH_DURATION_MS / 1000,
    profile: state.heroProfile,
  });
  ctx.restore();

  // Profanity glyphs — six chars under the hero, vibrating in place.
  // Anchored to the hero's live position so the cursing follows him
  // around the room.
  const glyphAnchorY = state.hero.y + HERO_SIZE * 1.7;
  const glyphSpacing = 30;
  const rowWidth = (PROFANITY_COUNT - 1) * glyphSpacing;
  const rowLeft = state.hero.x - rowWidth / 2;
  // Fade in over the first 0.8 s so the line doesn't snap on the
  // moment the room appears.
  const glyphFade = Math.min(1, state.profanityStart / 0.8);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font =
    "700 32px ui-monospace, 'SF Mono', Consolas, 'Liberation Mono', monospace";
  for (let i = 0; i < state.profanity.length; i++) {
    const p = state.profanity[i];
    const t = state.profanityStart * p.speed + p.phase;
    const dx = Math.sin(t * 1.7) * 3.5;
    const dy = Math.cos(t) * 2.5;
    const rot = Math.sin(t * 0.8) * 0.18;
    const flicker = 0.7 + Math.abs(Math.sin(t * 2.2)) * 0.3;
    const x = rowLeft + i * glyphSpacing + dx;
    const y = glyphAnchorY + dy;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = glyphFade * flicker;
    ctx.fillStyle = "#ff2d55";
    ctx.shadowColor = "#ff5577";
    ctx.shadowBlur = 10;
    ctx.fillText(p.ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // Footer hint — "PRESS ENTER → MAIN MENU" so the player has a clear
  // exit that doesn't collide with movement keys. WASD / Shift /
  // Space (the gameplay bindings) are owned by the room movement
  // here, so the menu nav is gated to Enter / Escape.
  ctx.save();
  ctx.globalAlpha = Math.min(1, state.profanityStart / 1.6) * 0.55;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#7d8590";
  ctx.fillText(
    "PRESS ENTER — RETURN TO MAIN MENU",
    CANVAS_W / 2,
    CANVAS_H - 50,
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
