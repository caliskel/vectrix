import { makeDoor } from "../lib/door";
import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 3600;
const ROOM_H = 600;
const WALL_T = 30;
const DOOR_CENTER_Y = 300;
const DOOR_W = 30;
const DOOR_H = 120;
const SPAWN_X = 200;
const KEY_X = 300;
const DASH_WALL_X = 600;
const DASH_WALL_W = 30;

// Long horizontal corridor — intro encounter. Player spawns at the
// left, the key sits a few steps ahead, then a vertical dashable
// wall blocks the corridor (cyan dashed, phases through during dash
// i-frames). The whole zone right of the wall is filled with
// sandbox-style bouncing bullets. No enemies.
export function buildRoom1(): Room {
  const gapTop = DOOR_CENTER_Y - DOOR_H / 2;
  const gapBottom = DOOR_CENTER_Y + DOOR_H / 2;
  const walls: Wall[] = [
    // perimeter
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
    // Dashable gate — solid for bullets (they bounce off), permeable
    // for the player only during dash i-frames. Same flag as the
    // tutorial Room 0 phase-2 wall.
    {
      x: DASH_WALL_X,
      y: WALL_T,
      w: DASH_WALL_W,
      h: ROOM_H - WALL_T * 2,
      dashable: true,
    },
    // interior obstacles — short pillars that shape the corridor.
    { x: 1100, y: 280, w: 60, h: 120 },
    { x: 1900, y: 100, w: 60, h: 120 },
    { x: 2700, y: 360, w: 60, h: 120 },
  ];

  const fieldX = DASH_WALL_X + DASH_WALL_W;
  return {
    id: "room1",
    walls,
    enemies: [],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
      true, // requiresKey
    ),
    nextRoomId: "room3",
    spawnX: SPAWN_X,
    spawnY: DOOR_CENTER_Y,
    width: ROOM_W,
    height: ROOM_H,
    useCamera: true,
    initialKey: { x: KEY_X, y: DOOR_CENTER_Y },
    ambientBullets: {
      spawnArea: {
        x: fieldX,
        y: WALL_T,
        w: ROOM_W - WALL_T - fieldX,
        h: ROOM_H - WALL_T * 2,
      },
      maxBullets: 30,
      spawnIntervalMs: 1200,
      speed: 250,
    },
  };
}
