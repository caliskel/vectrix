// Cyberpunk-terminal phrases that type themselves out in the canvas
// margins outside the playfield. Mix of system, lore-ish, and
// cryptic strings — each one cycles typing → stable (with blinking
// cursor) → fadeout. Up to FLOATING_TEXT_MAX_CONCURRENT live at
// once; respects the arena rect so text never lands on top of the
// playfield. Shared across rooms / tutorial / sandbox.

import {
  FLOATING_TEXT_CURSOR_BLINK_MS,
  FLOATING_TEXT_FADEOUT_MS,
  FLOATING_TEXT_FONT_SIZE_MAX,
  FLOATING_TEXT_FONT_SIZE_MIN,
  FLOATING_TEXT_MAX_CONCURRENT,
  FLOATING_TEXT_SPAWN_INTERVAL_MAX_MS,
  FLOATING_TEXT_SPAWN_INTERVAL_MIN_MS,
  FLOATING_TEXT_SPAWN_RETRY_LIMIT,
  FLOATING_TEXT_STABLE_DURATION_MAX_MS,
  FLOATING_TEXT_STABLE_DURATION_MIN_MS,
  FLOATING_TEXT_TYPING_SPEED_MS,
} from "./config";
import type { ArenaScreenBounds } from "./background-energy";

const WORD_POOL: string[] = [
  // --- System / technical ---
  "SYSTEM.BOOT_OK",
  "PROTOCOL // INIT",
  "HANDSHAKE_FAIL",
  "CYCLE 003 // STABLE",
  "ERROR: NULL VECTOR",
  "WARNING: OBSERVED",
  "SIGNAL LOST",
  "LOG_INTEGRITY: 87%",
  "0xFF2D55 // FALLBACK",
  "ACCESS DENIED",
  "NEURAL // STANDBY",
  "ROUTING THROUGH 7",
  "SYNC LOST -- RETRYING",
  "TRACE: ANOMALY DETECTED",
  "THREAD.SUSPEND",
  "MEM_LEAK // CONTAINED",
  "CRC: VALID",
  "PING 47ms",
  "NO ROUTE TO HOST",
  "FRAME DROPPED",
  // --- Lore / suggestive ---
  "the vector remembers",
  "witness protocol active",
  "they were here before",
  "who built this place",
  "9 cycles since",
  "something is awake",
  "the others did not return",
  "walls do not hold them",
  "key marked / found",
  "echoes from inside",
  "who is watching",
  "the door does not open",
  "remember the pattern",
  "pulse confirmed",
  "trace left behind",
  "sentinel approaches",
  "return to start",
  "new pattern detected",
  "beneath the grid",
  "fragments do not lie",
  // --- Cryptic / strange ---
  "i see you i see you",
  "not all eyes blink",
  "shapes within shapes",
  "echo without source",
  "the geometry forgets",
  "vector // dream",
  "red is a sound",
  "listen for the silence",
  "between two pulses",
  "the watcher is watched",
  "zero is also one",
  "we were never meant",
  "remember tomorrow",
  "the hex breathes",
  "follow the wrong path",
  "inside the inside",
  "mirror without face",
  "silent like a circle",
  "the eye does not close",
  "glass cascade",
];

type WordPhase = "typing" | "stable" | "fadeout";

type Word = {
  text: string;
  // Anchor in screen-space CSS pixels — top-left corner of the text
  // bounding box. Text renders with textAlign "left", baseline "top",
  // so the bbox is anchored cleanly here.
  x: number;
  y: number;
  fontSize: number;
  color: string;
  maxAlpha: number;     // peak alpha (color-specific)
  phase: WordPhase;
  phaseTime: number;    // seconds elapsed in current phase
  typingDurationSec: number;
  stableDurationSec: number;
  cursorPhase: number;  // 0..1 cycle (50% on, 50% off)
  charWidth: number;    // pre-measured advance per character
};

export type BackgroundTextState = {
  words: Word[];
  spawnTimer: number;
  viewW: number;
  viewH: number;
};

export function createBackgroundTextState(
  viewW: number,
  viewH: number,
): BackgroundTextState {
  return {
    words: [],
    spawnTimer: pickIntervalSec(
      FLOATING_TEXT_SPAWN_INTERVAL_MIN_MS / 1000,
      FLOATING_TEXT_SPAWN_INTERVAL_MAX_MS / 1000,
    ),
    viewW,
    viewH,
  };
}

export function updateBackgroundTexts(
  state: BackgroundTextState,
  dt: number,
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  arena: ArenaScreenBounds | null,
): void {
  state.viewW = viewW;
  state.viewH = viewH;

  // Advance / cull existing words.
  for (let i = state.words.length - 1; i >= 0; i--) {
    const w = state.words[i];
    w.phaseTime += dt;
    w.cursorPhase = (w.cursorPhase + dt / (FLOATING_TEXT_CURSOR_BLINK_MS / 1000)) % 1;
    if (w.phase === "typing" && w.phaseTime >= w.typingDurationSec) {
      w.phase = "stable";
      w.phaseTime = 0;
    } else if (w.phase === "stable" && w.phaseTime >= w.stableDurationSec) {
      w.phase = "fadeout";
      w.phaseTime = 0;
    } else if (
      w.phase === "fadeout" &&
      w.phaseTime >= FLOATING_TEXT_FADEOUT_MS / 1000
    ) {
      state.words.splice(i, 1);
    }
  }

  // Maybe spawn a new word.
  state.spawnTimer -= dt;
  if (
    state.spawnTimer <= 0 &&
    state.words.length < FLOATING_TEXT_MAX_CONCURRENT
  ) {
    state.spawnTimer = pickIntervalSec(
      FLOATING_TEXT_SPAWN_INTERVAL_MIN_MS / 1000,
      FLOATING_TEXT_SPAWN_INTERVAL_MAX_MS / 1000,
    );
    const spawned = trySpawnWord(state, ctx, viewW, viewH, arena);
    if (!spawned) {
      // No fit found this tick. Cool down a shorter beat so we
      // keep trying without saturating the loop.
      state.spawnTimer = Math.min(state.spawnTimer, 1.5);
    }
  }
}

function trySpawnWord(
  state: BackgroundTextState,
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  arena: ArenaScreenBounds | null,
): boolean {
  const text = WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)];
  const fontSize =
    FLOATING_TEXT_FONT_SIZE_MIN +
    Math.floor(
      Math.random() * (FLOATING_TEXT_FONT_SIZE_MAX - FLOATING_TEXT_FONT_SIZE_MIN + 1),
    );
  const { color, maxAlpha } = pickColor();
  // Pre-measure advance so the bbox check below is exact for
  // monospace + 2px letter-spacing. measureText is cheap, but we
  // only do it once per spawn.
  ctx.save();
  ctx.font = `${fontSize}px ui-monospace, "Courier New", monospace`;
  // Letter-spacing affects measureText on browsers that support it.
  // Fall back is just a tiny under-measure; alignment stays correct.
  const ctxAny = ctx as unknown as { letterSpacing?: string };
  ctxAny.letterSpacing = "2px";
  // Effective per-char advance — "M" is a stable wide reference for
  // monospace, plus the configured letter spacing.
  const sampleWidth = ctx.measureText("M").width + 2;
  // Reserve room for the blinking cursor too.
  const textWidth = (text.length + 1) * sampleWidth;
  const textHeight = Math.ceil(fontSize * 1.25);
  ctx.restore();

  for (let attempt = 0; attempt < FLOATING_TEXT_SPAWN_RETRY_LIMIT; attempt++) {
    const x = Math.random() * Math.max(1, viewW - textWidth);
    const y = Math.random() * Math.max(1, viewH - textHeight);
    if (arena && rectsOverlap(x, y, textWidth, textHeight, arena)) continue;
    state.words.push({
      text,
      x,
      y,
      fontSize,
      color,
      maxAlpha,
      phase: "typing",
      phaseTime: 0,
      typingDurationSec: (text.length * FLOATING_TEXT_TYPING_SPEED_MS) / 1000,
      stableDurationSec: pickIntervalSec(
        FLOATING_TEXT_STABLE_DURATION_MIN_MS / 1000,
        FLOATING_TEXT_STABLE_DURATION_MAX_MS / 1000,
      ),
      cursorPhase: 0,
      charWidth: sampleWidth,
    });
    return true;
  }
  return false;
}

export function drawBackgroundTexts(
  ctx: CanvasRenderingContext2D,
  state: BackgroundTextState,
  viewW: number,
  viewH: number,
  arena: ArenaScreenBounds | null,
): void {
  if (state.words.length === 0) return;
  ctx.save();
  // Clip out the arena rect — defence-in-depth in case any word
  // partially overlaps despite the spawn-side reject (e.g. window
  // resize after spawn). When the arena covers the entire viewport
  // there's nowhere to draw — bail early.
  if (arena) {
    if (
      arena.x <= 0 &&
      arena.y <= 0 &&
      arena.x + arena.w >= viewW &&
      arena.y + arena.h >= viewH
    ) {
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.rect(0, 0, viewW, viewH);
    ctx.rect(arena.x, arena.y, arena.w, arena.h);
    ctx.clip("evenodd");
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  for (const w of state.words) {
    const charsShown =
      w.phase === "typing"
        ? Math.min(
            w.text.length,
            Math.floor(w.phaseTime / (FLOATING_TEXT_TYPING_SPEED_MS / 1000)),
          )
        : w.text.length;
    let alpha = w.maxAlpha;
    if (w.phase === "fadeout") {
      alpha = w.maxAlpha * Math.max(0, 1 - w.phaseTime / (FLOATING_TEXT_FADEOUT_MS / 1000));
    }
    const cursorOn = w.phase !== "fadeout" && w.cursorPhase < 0.5;
    let renderText = w.text.substring(0, charsShown);
    if (cursorOn) renderText += "_";

    ctx.font = `${w.fontSize}px ui-monospace, "Courier New", monospace`;
    const ctxAny = ctx as unknown as { letterSpacing?: string };
    ctxAny.letterSpacing = "2px";
    ctx.globalAlpha = alpha;
    ctx.fillStyle = w.color;
    ctx.shadowColor = w.color;
    ctx.shadowBlur = 4;
    ctx.fillText(renderText, w.x, w.y);
  }
  ctx.restore();
}

function pickColor(): { color: string; maxAlpha: number } {
  const r = Math.random();
  // ~70 % cyan, ~15 % red, ~15 % white. Alpha caps from the spec.
  if (r < 0.7) return { color: "#00e5ff", maxAlpha: 0.35 };
  if (r < 0.85) return { color: "#ff2d55", maxAlpha: 0.30 };
  return { color: "#ffffff", maxAlpha: 0.25 };
}

function pickIntervalSec(minSec: number, maxSec: number): number {
  return minSec + Math.random() * (maxSec - minSec);
}

function rectsOverlap(
  x: number,
  y: number,
  w: number,
  h: number,
  arena: ArenaScreenBounds,
): boolean {
  return !(
    x + w <= arena.x ||
    x >= arena.x + arena.w ||
    y + h <= arena.y ||
    y >= arena.y + arena.h
  );
}
