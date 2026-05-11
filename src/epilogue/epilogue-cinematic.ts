// Epilogue cinematic — played after the Sentinel death sequence.
// Two acts:
//   1. Void scene: narrator speaks three English lines over the same
//      drifting grid + dust used in the intro, so the cinematic reads
//      as a bookend to the opening.
//   2. Playable "to be continued" room: a one-to-one clone of the
//      tutorial Room 0 visual stack — same camera follow, same
//      BackgroundFx + EnergyBackground + BackgroundText margin
//      effects, same animated arenaBg, same flickering grid nodes,
//      same wall layer + wallFx, same scanlines. Only the
//      onboarding-specific layers (markers, door, HUD, hint banner)
//      are dropped. "TO BE CONTINUED" sits at the world centre in
//      the cyan colour of the tutorial hint banner, styled like the
//      tutorial's "who was that?" first-thought line.
//
// Pure canvas 2D. Reuses void-bg for the cinematic and the full
// tutorial render pipeline for the room.

import {
  BLINK_CLOSE_DURATION_MS,
  DASH_DURATION_MS,
  PLAYER_MAX_SPEED,
  PLAYER_SIZE,
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
  createArenaBg,
  drawArenaBg,
  drawScanlines,
  tickScanlines,
  updateArenaBg,
  type ArenaBg,
} from "../lib/arena-bg";
import {
  createGridNodeState,
  drawRoomGrid,
  updateGridNodes,
  type GridNodeState,
} from "../lib/grid";
import {
  createWallFx,
  drawWallOverlay,
  drawWalls,
  updateWallFx,
  type Wall,
  type WallFx,
} from "../lib/walls";
import {
  createCamera,
  snapCamera,
  updateCamera,
  type Camera,
} from "../lib/camera";
import { BackgroundFx } from "../lib/bg-fx";
import {
  createEnergyBackground,
  drawEnergyBackground,
  updateEnergyBackground,
  type ArenaScreenBounds,
  type EnergyBackground,
} from "../lib/background-energy";
import {
  createBackgroundTextState,
  drawBackgroundTexts,
  updateBackgroundTexts,
  type BackgroundTextState,
} from "../lib/background-text";
import {
  drawScrambleText,
  makeScrambleSchedule,
  type ScrambleSchedule,
} from "../lib/scramble-text";
import { PALETTE } from "../lib/palette";
import { audio } from "../lib/audio";

// Canonical room dimensions — match the tutorial exactly so the
// hero scale, camera maths, and bg modules all stay 1:1 with what
// the player saw in the tutorial.
const ROOM_W_PX = 1200;
const ROOM_H_PX = 800;
const EYE_CX = ROOM_W_PX / 2;
const EYE_CY = 420;
const HERO_SIZE = PLAYER_SIZE;
const HERO_SCALE_VOID = 0.85;
const ACCEL_FACTOR = 9;
const FRICTION = 8.0;
const WALL_T = 30;

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
  narration: 18.5,
  voidfade: 1.5,
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

const TBC_TEXT = "TO BE CONTINUED";
const TBC_SCRAMBLE_SCHEDULE: ScrambleSchedule = makeScrambleSchedule({
  appearStart: 0.4,
  fadeInDuration: 0.6,
  settleDuration: 1.9,
  holdDuration: 9_000,
  fadeOutDuration: 0.4,
});
const TBC_COLOR = "#7dd3fc";
const TBC_SHADOW = "#7dd3fc";

export type EpilogueState = {
  time: number;
  phase: PhaseId;
  phaseTime: number;
  done: boolean;

  hero: Player;
  heroProfile: PlayerProfile;
  keybinds: KeybindProfile;
  keys: Set<string>;

  // Void cinematic background.
  bg: VoidBgState;

  // Tutorial-style room visual stack — created once, ticked / drawn
  // only while phase === "roompresent".
  roomWalls: Wall[];
  roomArenaBg: ArenaBg;
  roomGridNodes: GridNodeState;
  roomWallFx: WallFx;
  roomCamera: Camera;
  // Screen-space margin effects — sized to viewport on creation,
  // re-sized via the regenerate calls when the window dimensions
  // change between frames.
  roomBgFx: BackgroundFx;
  roomEnergyBg: EnergyBackground | null;
  roomBgText: BackgroundTextState | null;
  // Cached viewport dimensions so the resize check inside
  // updateEpilogue can detect changes without an external trigger.
  lastViewW: number;
  lastViewH: number;

  narratorBeatIdx: number;
  narratorCharsLast: number;
  roomAge: number;
};

export function createEpilogueState(): EpilogueState {
  const heroProfile = loadPlayerProfile();
  const hero = createPlayer();
  hero.x = ROOM_W_PX / 2;
  hero.y = ROOM_H_PX / 2 + 80;
  hero.isClosing = false;
  hero.closeAmount = 0;
  hero.blinkActive = false;
  hero.blinkElapsed = BLINK_CLOSE_DURATION_MS / 1000;
  hero.breathPhase = 0;
  hero.pupilOffsetX = 0;
  hero.pupilOffsetY = 0;
  // Perimeter-only walls — no door gap, no internal obstacles. Player
  // can walk the whole 1200×800 floor.
  const roomWalls: Wall[] = [
    { x: 0, y: 0, w: ROOM_W_PX, h: WALL_T },
    { x: 0, y: ROOM_H_PX - WALL_T, w: ROOM_W_PX, h: WALL_T },
    { x: 0, y: 0, w: WALL_T, h: ROOM_H_PX },
    { x: ROOM_W_PX - WALL_T, y: 0, w: WALL_T, h: ROOM_H_PX },
  ];
  return {
    time: 0,
    phase: "fadein",
    phaseTime: 0,
    done: false,
    hero,
    heroProfile,
    keybinds: loadKeybinds(),
    keys: new Set<string>(),
    bg: createVoidBg(ROOM_W_PX, ROOM_H_PX),
    roomWalls,
    roomArenaBg: createArenaBg(ROOM_W_PX, ROOM_H_PX),
    roomGridNodes: createGridNodeState(ROOM_W_PX, ROOM_H_PX),
    roomWallFx: createWallFx(roomWalls),
    roomCamera: createCamera(),
    roomBgFx: new BackgroundFx(),
    roomEnergyBg: null,
    roomBgText: null,
    lastViewW: 0,
    lastViewH: 0,
    narratorBeatIdx: -1,
    narratorCharsLast: 0,
    roomAge: 0,
  };
}

export function updateEpilogue(
  state: EpilogueState,
  dt: number,
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
): void {
  state.time += dt;
  state.phaseTime += dt;
  const dur = PHASE_DURATIONS[state.phase];
  if (state.phase !== "roompresent" && state.phaseTime >= dur) {
    const idx = PHASE_ORDER.indexOf(state.phase);
    if (idx < PHASE_ORDER.length - 1) {
      state.phase = PHASE_ORDER[idx + 1];
      state.phaseTime = 0;
      onPhaseEnter(state, viewW, viewH);
    }
  }
  if (state.phase === "roompresent") {
    state.roomAge += dt;
    // Recreate the viewport-sized bg modules if the window changed
    // size since last frame (initial creation also goes through this
    // branch via the lastViewW = 0 sentinel).
    if (state.lastViewW !== viewW || state.lastViewH !== viewH) {
      state.roomEnergyBg = createEnergyBackground(viewW, viewH);
      state.roomBgText = createBackgroundTextState(viewW, viewH);
      state.lastViewW = viewW;
      state.lastViewH = viewH;
      state.roomBgFx.resize(viewW, viewH);
    }
    tickRoomScene(state, dt);
    updateArenaBg(state.roomArenaBg, dt);
    updateWallFx(state.roomWallFx, dt, state.roomWalls);
    updateGridNodes(state.roomGridNodes, dt);
    if (state.roomEnergyBg) {
      updateEnergyBackground(state.roomEnergyBg, dt, viewW, viewH);
    }
    if (state.roomBgText) {
      updateBackgroundTexts(
        state.roomBgText,
        dt,
        ctx,
        viewW,
        viewH,
        computeArenaBounds(state, viewW, viewH),
      );
    }
    tickScanlines(dt);
    // Always centre the camera on the player — same lerp the tutorial
    // and rooms use.
    updateCamera(
      state.roomCamera,
      state.hero.x,
      state.hero.y,
      ROOM_W_PX,
      ROOM_H_PX,
      { minX: 0, minY: 0, maxX: ROOM_W_PX, maxY: ROOM_H_PX },
    );
  }
  updateEye(state.hero, dt, {
    threat: null,
    size: HERO_SIZE,
    dashDurationSec: DASH_DURATION_MS / 1000,
  });
  tickVoidBg(state.bg, dt, ROOM_W_PX, ROOM_H_PX, 0.6);
}

function onPhaseEnter(
  state: EpilogueState,
  viewW: number,
  viewH: number,
): void {
  if (state.phase === "roompresent") {
    state.roomAge = 0;
    state.hero.vx = 0;
    state.hero.vy = 0;
    // Spawn at the canonical room centre so the camera starts
    // already aligned and the "TO BE CONTINUED" title sits above
    // the hero.
    state.hero.x = ROOM_W_PX / 2;
    state.hero.y = ROOM_H_PX / 2 + 120;
    // Prime camera + viewport-sized bg modules so the first frame
    // doesn't have stale state.
    updateCamera(
      state.roomCamera,
      state.hero.x,
      state.hero.y,
      ROOM_W_PX,
      ROOM_H_PX,
      { minX: 0, minY: 0, maxX: ROOM_W_PX, maxY: ROOM_H_PX },
    );
    snapCamera(state.roomCamera);
    if (viewW > 0 && viewH > 0) {
      state.roomEnergyBg = createEnergyBackground(viewW, viewH);
      state.roomBgText = createBackgroundTextState(viewW, viewH);
      state.lastViewW = viewW;
      state.lastViewH = viewH;
      state.roomBgFx.resize(viewW, viewH);
    }
  }
}

export function trySkipEpilogue(state: EpilogueState): void {
  if (state.phase === "roompresent") return;
  state.phase = "roompresent";
  state.phaseTime = 0;
  onPhaseEnter(state, state.lastViewW, state.lastViewH);
}

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
  // Perimeter clamp — PLAYER_SIZE / 2 = 16, matching the in-game
  // tutorial so the visual edge stops at the wall identically.
  const half = PLAYER_SIZE / 2;
  const minX = WALL_T + half;
  const maxX = ROOM_W_PX - WALL_T - half;
  const minY = WALL_T + half;
  const maxY = ROOM_H_PX - WALL_T - half;
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

/** Same arena-bounds projection the tutorial uses — converts the
 *  visible chunk of the canonical 1200×800 room into screen-space
 *  coords so the energy + bg-text passes can clip to it. */
function computeArenaBounds(
  state: EpilogueState,
  viewW: number,
  viewH: number,
): ArenaScreenBounds {
  const scale = Math.min(viewW / ROOM_W_PX, viewH / ROOM_H_PX);
  const offsetX = (viewW - ROOM_W_PX * scale) / 2;
  const offsetY = (viewH - ROOM_H_PX * scale) / 2;
  const camera = state.roomCamera;
  const canonLeft = Math.max(0, -camera.x);
  const canonTop = Math.max(0, -camera.y);
  const canonRight = Math.min(ROOM_W_PX, ROOM_W_PX - camera.x);
  const canonBottom = Math.min(ROOM_H_PX, ROOM_H_PX - camera.y);
  return {
    x: offsetX + canonLeft * scale,
    y: offsetY + canonTop * scale,
    w: Math.max(0, (canonRight - canonLeft) * scale),
    h: Math.max(0, (canonBottom - canonTop) * scale),
  };
}

export function drawEpilogue(
  ctx: CanvasRenderingContext2D,
  state: EpilogueState,
  viewW: number,
  viewH: number,
  dpr: number,
): void {
  if (state.phase === "roompresent") {
    drawRoomScene(ctx, state, viewW, viewH, dpr);
  } else {
    drawVoidScene(ctx, state, viewW, viewH, dpr);
  }
}

function drawVoidScene(
  ctx: CanvasRenderingContext2D,
  state: EpilogueState,
  viewW: number,
  viewH: number,
  dpr: number,
): void {
  const scale = Math.min(viewW / ROOM_W_PX, viewH / ROOM_H_PX);
  const offsetX = (viewW - ROOM_W_PX * scale) / 2;
  const offsetY = (viewH - ROOM_H_PX * scale) / 2;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.setTransform(
    scale * dpr,
    0,
    0,
    scale * dpr,
    offsetX * dpr,
    offsetY * dpr,
  );
  drawVoidBg(ctx, state.bg, ROOM_W_PX, ROOM_H_PX, EYE_CX, EYE_CY);
  drawVoidVignette(ctx, ROOM_W_PX, ROOM_H_PX, EYE_CX, EYE_CY);
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
  if (state.phase === "fadein") {
    const a = 1 - Math.min(1, state.phaseTime / PHASE_DURATIONS.fadein);
    if (a > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      ctx.fillRect(0, 0, ROOM_W_PX, ROOM_H_PX);
    }
  } else if (state.phase === "voidfade") {
    const a = Math.min(1, state.phaseTime / PHASE_DURATIONS.voidfade);
    if (a > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      ctx.fillRect(0, 0, ROOM_W_PX, ROOM_H_PX);
    }
  }
  ctx.restore();
}

function drawRoomScene(
  ctx: CanvasRenderingContext2D,
  state: EpilogueState,
  viewW: number,
  viewH: number,
  dpr: number,
): void {
  const scale = Math.min(viewW / ROOM_W_PX, viewH / ROOM_H_PX);
  const offsetX = (viewW - ROOM_W_PX * scale) / 2;
  const offsetY = (viewH - ROOM_H_PX * scale) / 2;
  // === Same render order as tutorial-game.ts → render() ===
  // 1. screen-space PALETTE.bg fill, 2. BackgroundFx back layer,
  // 3. energy + text margin passes, 4. switch into the letterboxed
  // canonical canvas with the camera transform, 5. arena bg + grid
  // + walls + wall fx, 6. hero, 7. back to screen-space for
  // scanlines / curtains.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, viewW, viewH);
  state.roomBgFx.drawBack(ctx, viewW, viewH);
  const arenaBounds = computeArenaBounds(state, viewW, viewH);
  if (state.roomEnergyBg) {
    drawEnergyBackground(ctx, state.roomEnergyBg, viewW, viewH, arenaBounds);
  }
  if (state.roomBgText) {
    drawBackgroundTexts(ctx, state.roomBgText, viewW, viewH, arenaBounds);
  }
  // Letterboxed canonical canvas — same setTransform pattern the
  // tutorial uses so the room scale is identical.
  ctx.setTransform(
    scale * dpr,
    0,
    0,
    scale * dpr,
    offsetX * dpr,
    offsetY * dpr,
  );
  // Camera transform — world scrolls around the always-centred hero.
  ctx.save();
  ctx.translate(-state.roomCamera.x, -state.roomCamera.y);
  drawArenaBg(ctx, state.roomArenaBg, {
    x: state.hero.x,
    y: state.hero.y,
  });
  drawRoomGrid(ctx, ROOM_W_PX, ROOM_H_PX, state.roomGridNodes);
  drawWalls(ctx, state.roomWalls);
  drawWallOverlay(ctx, state.roomWallFx, state.roomWalls);
  // "TO BE CONTINUED" — pinned to the world centre of the room. Sits
  // INSIDE the camera transform so it stays anchored to the room as
  // the player walks around it.
  drawScrambleText(
    ctx,
    TBC_TEXT,
    state.roomAge,
    TBC_SCRAMBLE_SCHEDULE,
    ROOM_W_PX / 2,
    ROOM_H_PX / 2,
    {
      color: TBC_COLOR,
      shadowColor: TBC_SHADOW,
      shadowBlur: 6,
    },
  );
  drawPlayerEye(ctx, state.hero, HERO_SIZE, {
    ringColor: state.heroProfile.outerRing,
    pupilColor: state.heroProfile.pupil,
    ghostColor: state.heroProfile.outerRing,
    dashDurationSec: DASH_DURATION_MS / 1000,
    profile: state.heroProfile,
  });
  ctx.restore();
  // Back to screen-space for the CRT scanline overlay and the
  // footer hint.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScanlines(ctx, viewW, viewH);
  // Footer hint — quiet "PRESS ENTER → MAIN MENU". Keyboard-only
  // nav so an accidental mouse click doesn't bounce the player out.
  ctx.save();
  ctx.globalAlpha = Math.min(1, state.roomAge / 1.6) * 0.55;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#7d8590";
  ctx.fillText(
    "PRESS ENTER — RETURN TO MAIN MENU",
    viewW / 2,
    viewH - 32,
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
