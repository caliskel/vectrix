import type { Door } from "./door";
import type { Enemy } from "./enemies/types";
import type { Marker } from "./markers";
import type { Wall } from "./walls";

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
};
