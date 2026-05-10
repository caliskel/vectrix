import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;

// Placeholder beyond the arena — full closed border, no enemies, no
// door. Confirms the Room 2 → Room 3 transition while real Room 3
// content is in flight.
export function buildRoom3(): Room {
  const walls: Wall[] = [
    { x: 0, y: 0, w: ROOM_W, h: WALL_T },
    { x: 0, y: ROOM_H - WALL_T, w: ROOM_W, h: WALL_T },
    { x: 0, y: 0, w: WALL_T, h: ROOM_H },
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: ROOM_H },
  ];
  return {
    id: "room3",
    walls,
    enemies: [],
    door: null,
    nextRoomId: null,
    spawnX: 150,
    spawnY: 400,
    message: "Room 3 — coming soon",
  };
}
