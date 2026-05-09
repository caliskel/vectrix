import { makeDoor } from "../lib/door";
import { Turret } from "../lib/enemies/turret";
import type { Wall } from "../lib/walls";
import type { Room } from "./room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
const DOOR_CENTER_Y = 400;
const DOOR_W = 80;
const DOOR_H = 120;

export function buildRoom1(): Room {
  // door gap is centered on the right wall, so the right-wall segments
  // are split top-and-bottom around the gap (the door entity owns the gap)
  const gapTop = DOOR_CENTER_Y - DOOR_H / 2;
  const gapBottom = DOOR_CENTER_Y + DOOR_H / 2;
  const walls: Wall[] = [
    { x: 0, y: 0, w: ROOM_W, h: WALL_T }, // top
    { x: 0, y: ROOM_H - WALL_T, w: ROOM_W, h: WALL_T }, // bottom
    { x: 0, y: 0, w: WALL_T, h: ROOM_H }, // left
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: gapTop }, // right (above door)
    {
      x: ROOM_W - WALL_T,
      y: gapBottom,
      w: WALL_T,
      h: ROOM_H - gapBottom,
    }, // right (below door)
  ];

  return {
    id: "room1",
    walls,
    enemies: [new Turret(600, 400)],
    door: makeDoor(ROOM_W, DOOR_CENTER_Y, DOOR_W, DOOR_H, "closed"),
    nextRoomId: "room2",
    spawnX: 150,
    spawnY: 400,
  };
}

export const ROOM_W_PX = ROOM_W;
export const ROOM_H_PX = ROOM_H;
