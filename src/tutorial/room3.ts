import { makeDoor } from "../lib/door";
import { Hunter } from "../lib/enemies/hunter";
import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
const DOOR_CENTER_Y = 400;
const DOOR_W = 30;
const DOOR_H = 120;

export function buildRoom3(): Room {
  // Same exit shape as Room 1 / 2 — the player learns the door pattern,
  // and the encounter focus is dodging the Hunter, not relearning the
  // arena.
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
    id: "room3",
    walls,
    // Two hunters — a vertical pair forming a wedge the player must
    // dash through. Spread symmetrically above + below the door y so
    // the threat reads from both sides on entry.
    enemies: [new Hunter(900, 280), new Hunter(900, 520)],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
    ),
    nextRoomId: "room4",
    spawnX: 150,
    spawnY: 400,
  };
}
