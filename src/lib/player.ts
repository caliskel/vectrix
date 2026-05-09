import type { Bindings } from "./config";

export type Player = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  dashTime: number;
  dashIframeTime: number;
  cooldown: number;
  dashDirX: number;
  dashDirY: number;
};

export function createPlayer(): Player {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facingX: 0,
    facingY: -1,
    dashTime: 0,
    dashIframeTime: 0,
    cooldown: 0,
    dashDirX: 0,
    dashDirY: 0,
  };
}

// Resolve normalized movement input from currently-pressed keys.
export function inputDirection(
  keys: Set<string>,
  bindings: Bindings,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (keys.has(bindings.left)) x -= 1;
  if (keys.has(bindings.right)) x += 1;
  if (keys.has(bindings.up)) y -= 1;
  if (keys.has(bindings.down)) y += 1;
  const len = Math.hypot(x, y);
  if (len > 0) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

// Dash speed derived from configured distance and duration so both menu
// sliders are live (settings.dash.distance / durationMs).
export function dashSpeed(distance: number, durationMs: number): number {
  const dur = durationMs / 1000;
  return dur > 0 ? distance / dur : 0;
}
