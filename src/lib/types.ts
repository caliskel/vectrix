// Shared lightweight types that don't fit cleanly inside an entity module.

export type Bounds = { x: number; y: number; w: number; h: number };

// Identifies the active settings configuration when comparing against
// DEFAULT_SETTINGS / PRESETS for per-config best-score tracking.
export type ConfigId = "Default" | "Easy" | "Normal" | "Hard" | null;

export function hitBounds(b: Bounds | null, x: number, y: number): boolean {
  if (!b) return false;
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}
