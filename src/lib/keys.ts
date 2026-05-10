import { drawNeon } from "./neon";

// Key pickup — golden diamond + stem + teeth. Doesn't expire (lives
// at the kill site until the player walks over it). One key per room
// for now; rooms-game tracks a `keyHeld: boolean`.

const KEY_COLOR = "#ffd60a";
const KEY_RADIUS = 10;
const KEY_PICKUP_RADIUS = 28;
const KEY_GLOW_BLUR = 18;
const KEY_GLOW_SOFT = 6;
const KEY_SPAWN_DURATION_SEC = 0.25;
const KEY_BOB_HZ = 1.6;
const KEY_BOB_AMPLITUDE_PX = 3;

export type Key = {
  x: number;
  y: number;
  collected: boolean;
  /** Counts up while the key is on the floor; drives spawn-pop and bob. */
  age: number;
};

export function createKey(x: number, y: number): Key {
  return { x, y, collected: false, age: 0 };
}

export function updateKey(key: Key, dt: number): void {
  if (key.collected) return;
  key.age += dt;
}

export function checkKeyPickup(
  key: Key,
  px: number,
  py: number,
): boolean {
  if (key.collected) return false;
  const dx = px - key.x;
  const dy = py - key.y;
  return dx * dx + dy * dy < KEY_PICKUP_RADIUS * KEY_PICKUP_RADIUS;
}

export function drawKey(ctx: CanvasRenderingContext2D, key: Key): void {
  if (key.collected) return;
  // Spawn pop: scale from 0.4 → 1.0 over the first 250 ms so the key
  // doesn't appear as a hard pop at the kill site.
  const spawnT = Math.min(1, key.age / KEY_SPAWN_DURATION_SEC);
  const scale = 0.4 + 0.6 * spawnT;
  // Subtle hover so the player notices it
  const bobY = Math.sin(key.age * KEY_BOB_HZ * Math.PI * 2) * KEY_BOB_AMPLITUDE_PX;
  ctx.save();
  ctx.translate(key.x, key.y + bobY);
  ctx.scale(scale, scale);
  drawNeon(
    ctx,
    () => {
      // Diamond head
      ctx.beginPath();
      ctx.moveTo(0, -KEY_RADIUS);
      ctx.lineTo(KEY_RADIUS, 0);
      ctx.lineTo(0, KEY_RADIUS);
      ctx.lineTo(-KEY_RADIUS, 0);
      ctx.closePath();
      ctx.fillStyle = KEY_COLOR;
      ctx.fill();
      // Stem + teeth
      ctx.fillRect(-2, 0, 4, KEY_RADIUS + 4);
      ctx.fillRect(2, KEY_RADIUS + 2, 4, 3);
      ctx.fillRect(2, KEY_RADIUS + 8, 3, 3);
    },
    KEY_COLOR,
    KEY_GLOW_BLUR,
    KEY_GLOW_SOFT,
  );
  ctx.restore();
}

/** HUD slot — golden silhouette outline if not yet collected, solid
 *  filled key icon when held. (x, y) is the icon center in screen px. */
export function drawKeyHudIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  collected: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = collected ? 1 : 0.4;
  const r = 6;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r, 0);
  ctx.closePath();
  if (collected) {
    ctx.fillStyle = KEY_COLOR;
    ctx.fill();
  }
  ctx.strokeStyle = KEY_COLOR;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (collected) {
    ctx.fillStyle = KEY_COLOR;
    ctx.fillRect(-1.5, 0, 3, 8);
    ctx.fillRect(1.5, 6, 3, 2);
  } else {
    ctx.strokeRect(-1.5, 0, 3, 8);
  }
  ctx.restore();
}

export const KEY_PICKUP_RADIUS_PX = KEY_PICKUP_RADIUS;
