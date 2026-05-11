// Scrambled-glyph → resolved text effect. Used for the hero's first
// thoughts in the intro cinematic ("who am i?") and in the tutorial
// ("who was that?"): the line emerges as alien static, then characters
// settle one-by-one from left to right into their real letters.
//
// Stateless rendering — the caller owns the time driver (phaseTime,
// thoughtAge, etc.) and the schedule (when fade-in starts, how long
// the settle takes, etc.). One function fits both intro and tutorial
// contexts without coupling them to a shared timer.

const DEFAULT_GARBLE =
  "░▒▓◇◆▌▐▀▄■□★※╳⌐?!&*%$#@/\\<>{}≡≢×∴∵";

export type ScrambleSchedule = {
  /** Seconds before any text becomes visible. */
  appearStart: number;
  /** Seconds when characters start resolving left-to-right. */
  settleStart: number;
  /** Seconds when every character is resolved (fully legible). */
  holdStart: number;
  /** Seconds when the fade-out begins. */
  fadeOutStart: number;
  /** Seconds when alpha reaches 0 (nothing drawn afterwards). */
  totalDuration: number;
};

export type ScrambleVisualOpts = {
  color?: string;
  shadowColor?: string;
  shadowBlur?: number;
  font?: string;
};

export type ScrambleScheduleOpts = {
  appearStart?: number;
  /** Seconds between appearStart and settleStart (alpha 0 → 1 with
   *  all chars garbled). */
  fadeInDuration?: number;
  /** Seconds spent resolving all chars left-to-right. */
  settleDuration?: number;
  /** Seconds the resolved text stays at full alpha. */
  holdDuration?: number;
  /** Seconds spent fading out at the end. */
  fadeOutDuration?: number;
};

/** Build a sensible default schedule scaled by text length. Callers
 *  can override any individual timing. Defaults assume a short
 *  thought (~9-15 chars). */
export function makeScrambleSchedule(
  opts: ScrambleScheduleOpts = {},
): ScrambleSchedule {
  const appearStart = opts.appearStart ?? 1.5;
  const fadeInDuration = opts.fadeInDuration ?? 0.5;
  const settleDuration = opts.settleDuration ?? 1.4;
  const holdDuration = opts.holdDuration ?? 0.5;
  const fadeOutDuration = opts.fadeOutDuration ?? 0.6;
  const settleStart = appearStart + fadeInDuration;
  const holdStart = settleStart + settleDuration;
  const fadeOutStart = holdStart + holdDuration;
  const totalDuration = fadeOutStart + fadeOutDuration;
  return {
    appearStart,
    settleStart,
    holdStart,
    fadeOutStart,
    totalDuration,
  };
}

/** Returns true when the schedule's total duration has elapsed at
 *  the given time — useful for "is this thought done playing?"
 *  checks in the caller. */
export function isScrambleTextDone(
  time: number,
  schedule: ScrambleSchedule,
): boolean {
  return time >= schedule.totalDuration;
}

export function drawScrambleText(
  ctx: CanvasRenderingContext2D,
  text: string,
  time: number,
  schedule: ScrambleSchedule,
  x: number,
  y: number,
  visual: ScrambleVisualOpts = {},
): void {
  if (time < schedule.appearStart || time >= schedule.totalDuration) return;

  // Alpha — fade in during [appearStart, settleStart], hold 1,
  // fade out during [fadeOutStart, totalDuration].
  let alpha = 1;
  if (time < schedule.settleStart) {
    alpha = (time - schedule.appearStart) /
      (schedule.settleStart - schedule.appearStart);
  } else if (time >= schedule.fadeOutStart) {
    alpha = Math.max(
      0,
      1 -
        (time - schedule.fadeOutStart) /
          (schedule.totalDuration - schedule.fadeOutStart),
    );
  }
  if (alpha <= 0) return;

  // Settled character count grows linearly across [settleStart, holdStart].
  const len = text.length;
  let settledCount = 0;
  if (time >= schedule.settleStart && time < schedule.holdStart) {
    settledCount = Math.floor(
      ((time - schedule.settleStart) /
        (schedule.holdStart - schedule.settleStart)) *
        len,
    );
  } else if (time >= schedule.holdStart) {
    settledCount = len;
  }

  // Build display string. Settled prefix is the real text; the tail
  // is pulled from the garble pool with a frame-stable index so it
  // reads as fast-changing static rather than per-frame noise. The
  // per-character seed offsets keep adjacent chars from showing the
  // same glyph at the same time.
  const flickerStep = Math.floor(time * 14);
  let display = "";
  for (let i = 0; i < len; i++) {
    const real = text[i];
    if (i < settledCount || real === " ") {
      display += real;
    } else {
      const idx =
        (flickerStep + i * 7 + (real.charCodeAt(0) % 13)) %
        DEFAULT_GARBLE.length;
      display += DEFAULT_GARBLE[idx];
    }
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font =
    visual.font ?? "300 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = visual.color ?? "#ffffff";
  ctx.shadowColor = visual.shadowColor ?? "#ffffff";
  ctx.shadowBlur = visual.shadowBlur ?? 6;
  ctx.fillText(display, x, y);
  ctx.restore();
}
