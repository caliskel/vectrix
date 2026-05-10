import { makeDoor } from "../lib/door";
import { createMarker } from "../lib/markers";
import type { Room } from "../lib/room";
import type { Wall } from "../lib/walls";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
const DOOR_CENTER_Y = 400;
const DOOR_W = 30;
const DOOR_H = 120;

export function buildRoom0(): Room {
  // Tutorial controls room — no enemies, just five sequenced markers
  // that teach D / W / A / S / X. Two short pillar walls between
  // markers 4 and 5 force the player into a dash.
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
    // Twin pillar walls between markers 4 and 5 with a narrow gap
    // that's awkward to walk through — easier to dash.
    { x: 700, y: 350, w: 50, h: 70 },
    { x: 700, y: 480, w: 50, h: 70 },
  ];

  return {
    id: "room0",
    walls,
    enemies: [],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
    ),
    nextRoomId: "room1",
    spawnX: 200,
    spawnY: 400,
    markers: [
      createMarker(600, 400, 1, "→ MOVE RIGHT (D)"),
      createMarker(600, 200, 2, "↑ MOVE UP (W)"),
      createMarker(200, 200, 3, "← MOVE LEFT (A)"),
      createMarker(200, 600, 4, "↓ MOVE DOWN (S)"),
      createMarker(1000, 400, 5, "DASH THROUGH (X)"),
    ],
  };
}
