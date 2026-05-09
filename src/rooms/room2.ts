import { makeDoor } from "../lib/door";
import { Watcher } from "../lib/enemies/watcher";
import type { Wall } from "../lib/walls";
import type { Room } from "./room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
const DOOR_CENTER_Y = 400;
const DOOR_W = 30; // matches WALL_T so the door sits flush inside the wall
const DOOR_H = 120;

export function buildRoom2(): Room {
  // Right wall has a door gap centered vertically — same shape as Room 1
  // so the player learns the exit pattern.
  const gapTop = DOOR_CENTER_Y - DOOR_H / 2;
  const gapBottom = DOOR_CENTER_Y + DOOR_H / 2;
  const walls: Wall[] = [
    { x: 0, y: 0, w: ROOM_W, h: WALL_T },
    { x: 0, y: ROOM_H - WALL_T, w: ROOM_W, h: WALL_T },
    { x: 0, y: 0, w: WALL_T, h: ROOM_H },
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: gapTop },
    {
      x: ROOM_W - WALL_T,
      y: gapBottom,
      w: WALL_T,
      h: ROOM_H - gapBottom,
    },
  ];
  return {
    id: "room2",
    walls,
    enemies: [new Watcher(950, 400)],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
    ),
    nextRoomId: "room3",
    spawnX: 150,
    spawnY: 400,
  };
}
