import type { Wall } from "../lib/walls";
import type { Room } from "./room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;

export function buildRoom4(): Room {
  // Placeholder: full closed border, no enemies, no door — used to
  // verify the Room 3 → Room 4 transition while Room 4 content is in
  // flight.
  const walls: Wall[] = [
    { x: 0, y: 0, w: ROOM_W, h: WALL_T },
    { x: 0, y: ROOM_H - WALL_T, w: ROOM_W, h: WALL_T },
    { x: 0, y: 0, w: WALL_T, h: ROOM_H },
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: ROOM_H },
  ];
  return {
    id: "room4",
    walls,
    enemies: [],
    door: null,
    nextRoomId: null,
    spawnX: 150,
    spawnY: 400,
    message: "Room 4 — coming soon",
  };
}
