import { makeDoor } from "../lib/door";
import type { Room } from "../lib/room";
import type { Wall } from "../lib/walls";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
const DOOR_CENTER_Y = 400;
const DOOR_W = 30;
const DOOR_H = 120;

// Tutorial entry room — a still, empty chamber the awakened hero
// finds itself in after the intro cinematic. Nothing here: no
// markers, no enemies, no hint. The exit on the right is open from
// the start; stepping through transitions to the real onboarding
// (the markers room, currently `room0`).
//
// Purpose: a calm beat between the cinematic and the controls. The
// player gets a moment to feel their body before the lesson begins.
export function buildRoomIntro(): Room {
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
    id: "roomIntro",
    walls,
    enemies: [],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "open",
    ),
    nextRoomId: "room0",
    spawnX: 200,
    spawnY: 400,
  };
}
