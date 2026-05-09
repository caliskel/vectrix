// Style score tuning. Plain constants — they're feel parameters that
// don't need a menu surface.

export const DASH_BASE = 100;
export const NEAR_MISS_BASE = 50;
export const NEAR_MISS_SPEED_THRESHOLD = 50;
export const HIT_PENALTY = 500;

export const MULT_GROW = 0.2;
export const MULT_MAX = 10.0;
export const MULT_MIN = 1.0;
export const MULT_DECAY_DELAY = 2.0;
export const MULT_DECAY_RATE = 0.5;

// Tier thresholds where the run plays the "tier up" cue and the HUD glow
// turns on. Crossing each one is tracked once per run.
export const MULT_TIER_PORTS = [3, 5, 7, 10] as const;

// Maps multiplier value to a HUD text color: white below 3, then warm
// yellow → red as it climbs toward MULT_MAX. Keeps the multiplier
// visually informative without a dedicated bar.
export function multColor(m: number): string {
  if (m < 3) return "#ffffff";
  const t = Math.min(1, (m - 3) / (MULT_MAX - 3));
  // yellow (255,220,60) → red (255,40,0)
  const r = 255;
  const g = Math.round(220 * (1 - t) + 40 * t);
  const b = Math.round(60 * (1 - t));
  return `rgb(${r},${g},${b})`;
}
