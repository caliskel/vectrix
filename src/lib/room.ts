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
};
