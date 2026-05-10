import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;

// Placeholder past the campaign — full closed border, no enemies, no
// door. Confirms the Room 4 → Room 5 transition while real Room 5
// content is in flight.
export function buildRoom5(): Room {
  const walls: Wall[] = [
    { x: 0, y: 0, w: ROOM_W, h: WALL_T },
    { x: 0, y: ROOM_H - WALL_T, w: ROOM_W, h: WALL_T },
    { x: 0, y: 0, w: WALL_T, h: ROOM_H },
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: ROOM_H },
  ];
  return {
    id: "room5",
    walls,
    enemies: [],
    door: null,
    nextRoomId: null,
    spawnX: 150,
    spawnY: 400,
    message: "Room 5 — coming soon",
  };
}
