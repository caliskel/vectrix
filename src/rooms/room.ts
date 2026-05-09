import type { Door } from "../lib/door";
import type { Enemy } from "../lib/enemies/types";
import type { Wall } from "../lib/walls";

export type Room = {
  id: string;
  walls: Wall[];
  enemies: Enemy[];
  door: Door | null;
  nextRoomId: string | null;
  spawnX: number;
  spawnY: number;
  /** When set, drawn as a centered overlay message on top of the room. */
  message?: string;
};
