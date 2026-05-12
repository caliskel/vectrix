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

// Long horizontal corridor — empty intro. Player spawns at the left,
// the key sits a few steps ahead on the floor, and the door at the
// far right opens on key pickup. No enemies — this room teaches the
// "see key → grab → walk to door" loop before combat starts.
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
    // interior obstacles — short pillars that shape the corridor.
    { x: 1100, y: 280, w: 60, h: 120 },
    { x: 1900, y: 100, w: 60, h: 120 },
    { x: 2700, y: 360, w: 60, h: 120 },
  ];

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
  };
}
