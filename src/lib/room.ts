import type { Door } from "./door";
import type { Enemy } from "./enemies/types";
import type { Marker } from "./markers";
import type { Wall } from "./walls";

/** Lazy enemy spawn — added to a room's `pendingEnemies` list and
 *  fired by rooms-game when `player.x` crosses `triggerX`. The `spawn`
 *  callback returns a fresh Enemy ready to push into the room.
 *  `spawned` is mutated in place so repeated calls only fire once. */
export type PendingEnemy = {
  triggerX: number;
  spawned: boolean;
  spawn: () => Enemy;
};

/** Decorative world-space text label drawn over the room's floor —
 *  signage like "INFECTED ZONE" hanging above a hazardous section.
 *  No physics, no collision; pure rendering. */
export type WorldLabel = {
  /** Centered horizontally on this x. */
  x: number;
  /** Vertical center / baseline of the label. */
  y: number;
  text: string;
  /** Font size in world px. Defaults to 32. */
  size?: number;
  /** Hex or CSS color. Defaults to neon red ("#ff2d55"). */
  color?: string;
  /** When true, the label plays the scramble-text intro on room
   *  entry: alien glyphs → resolve left→right → hold → glitch back
   *  into garble while fading out. One-shot per room visit; restart
   *  or re-entry replays it. */
  scramble?: boolean;
};

/** Sandbox-style ambient bullet field confined to a rectangle. Bullets
 *  spawn from a random edge of the rectangle, aim inward with ±60°
 *  spread, and ALL bounce off walls inside the room (perimeter +
 *  pillars + the dashable wall on the rectangle's edge). Used by
 *  Room 1 to fill the right half of the corridor with a moving threat
 *  the player has to dash through. */
export type AmbientBulletField = {
  spawnArea: { x: number; y: number; w: number; h: number };
  maxBullets: number;
  spawnIntervalMs: number;
  speed: number;
};

/** Static config for the Pulsing Heart mechanic (top side-room). */
export type HeartMechanicCfg = {
  x: number;
  y: number;
  registrationRadius: number;
  pulseOrbitRadius: number;
  pulseIntervalSec: number;
  pulseExpandSpeed: number;
  registrationGoalSec: number;
};

/** Static config for the Sleeping Chamber mechanic (bottom side-room). */
export type SleepingChamberCfg = {
  visibilityRadius: number;
};

export type Room = {
  id: string;
  walls: Wall[];
  enemies: Enemy[];
  door: Door | null;
  nextRoomId: string | null;
  spawnX: number;
  spawnY: number;
  /** Logical world dimensions. Defaults to the legacy 1200x800 if
   *  omitted; rooms wider/taller than the viewport set these and
   *  flip `useCamera` so the renderer follows the player. */
  width?: number;
  height?: number;
  /** Use a follow camera. Required for any room that doesn't fit on
   *  the on-screen letterbox at native scale. */
  useCamera?: boolean;
  /** When set, drawn as a centered overlay message on top of the room. */
  message?: string;
  /** Optional sequence of tutorial markers — game engine treats them
   *  like enemies for the room-cleared check (room is cleared once
   *  every marker has been touched in order). */
  markers?: Marker[];
  /** Lazy spawn descriptors — rooms-game ticks this every frame and
   *  fires entries whose `triggerX` is reached. Used by Room 4 to
   *  drop a Hunter into each section as the player crosses in. */
  pendingEnemies?: PendingEnemy[];
  /** Pre-placed key dropped on the floor at room load (no kill
   *  required). Mutually exclusive with `dropsKey` enemy spawns —
   *  rooms-game seeds `currentKey` from this on entry, restart, or
   *  transition. */
  initialKey?: { x: number; y: number };
  /** Optional back door on the left wall — always open, lets the
   *  player retreat to `prevRoomId`. Skipped on the campaign's first
   *  room and on the boss room. */
  backDoor?: Door | null;
  /** Id of the room this back door returns to. Required if backDoor
   *  is set; unused otherwise. */
  prevRoomId?: string | null;
  /** Ambient bullet field — bullets spawn continuously inside the
   *  configured rectangle and bounce off every wall in the room.
   *  Mutually independent of enemy fire; the spawn loop runs in
   *  rooms-game whenever this is set. */
  ambientBullets?: AmbientBulletField;
  /** Decorative world-space labels — drawn between walls and entities
   *  (so the player and bullets pass on top). Used by Room 1 for the
   *  INFECTED ZONE signage. */
  worldLabels?: WorldLabel[];
  /** Additional forward exits beyond the main `door`. Used by hub
   *  rooms (e.g. infected sector hub) that have multiple non-back
   *  exits — top + bottom doors leading to side-rooms. Each entry
   *  pairs a Door with the room id it leads to. rooms-game checks
   *  overlap against each in the same pass as `door` and `backDoor`,
   *  transitioning forward (not viaBack) when triggered. */
  extraExits?: Array<{ door: Door; nextRoomId: string }>;
  heartMechanic?: HeartMechanicCfg;
  sleepingChamber?: SleepingChamberCfg;
  /** Zone theme id (see lib/zone-theme.ts) — names the room's visual
   *  identity: floor wash, decor vocabulary, wall style, darkness.
   *  Absent / unknown ids resolve to the default theme. */
  theme?: string;
  /** Per-room override of the theme's reactivity intensity (0..1).
   *  Static in v1; rarely needed — the theme default usually fits. */
  themeIntensity?: number;
};
