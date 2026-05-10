import { makeDoor } from "../lib/door";
import { Sentinel } from "../lib/enemies/sentinel";
import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1600;
const ROOM_H = 1200;
const WALL_T = 30;
const DOOR_CENTER_Y = 600;
const DOOR_W = 30;
const DOOR_H = 120;
const SENTINEL_X = 800;
const SENTINEL_Y = 600;

// Boss arena. Open square room with a single Sentinel in the centre.
// rooms-game runs the intro + death sequence (slowmo, layered
// explosion, VICTORY text, Game Complete overlay) on top of this
// room — the file just provides the geometry and the boss instance.
// nextRoomId is null because the campaign ends here; door opens on
// Sentinel kill via the standard "all enemies dead" rule.
export function buildRoom5(): Room {
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
    id: "room5",
    walls,
    enemies: [
      new Sentinel(SENTINEL_X, SENTINEL_Y, {
        arenaW: ROOM_W,
        arenaH: ROOM_H,
      }),
    ],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
      false,
    ),
    nextRoomId: null,
    spawnX: 200,
    spawnY: 600,
    width: ROOM_W,
    height: ROOM_H,
    useCamera: true,
  };
}
