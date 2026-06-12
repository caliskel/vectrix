import type { Room } from "../lib/room";
import type { Wall } from "../lib/walls";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;

// Tutorial outro — the void room the hero spawns into after killing
// the hunters. No enemies, no door, no exit; tutorial-game runs a
// narrator beat ("Well done... go and kill the Sentinel"), then
// fades to black and redirects to /rooms.html.
//
// Walls are the standard perimeter so the player can still walk a
// few steps without falling off the world, but they're never
// rendered in the room4 code path — tutorial-game uses the void
// backdrop instead so the scene reads as a return to the cinematic
// space, not another arena.
export function buildRoom4(): Room {
  const walls: Wall[] = [
    { x: 0, y: 0, w: ROOM_W, h: WALL_T },
    { x: 0, y: ROOM_H - WALL_T, w: ROOM_W, h: WALL_T },
    { x: 0, y: 0, w: WALL_T, h: ROOM_H },
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: ROOM_H },
  ];
  return {
    id: "room4",
    theme: "tutorial",
    walls,
    enemies: [],
    door: null,
    nextRoomId: null,
    spawnX: ROOM_W / 2,
    spawnY: ROOM_H / 2,
  };
}
