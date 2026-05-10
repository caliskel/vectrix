import { makeDoor } from "../lib/door";
import { Turret } from "../lib/enemies/turret";
import { Watcher } from "../lib/enemies/watcher";
import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1400;
const ROOM_H = 900;
const WALL_T = 30;
const DOOR_CENTER_Y = 450;
const DOOR_W = 30;
const DOOR_H = 120;

// Arena with circular defence — four corner turrets and a Watcher in
// the middle. Fully open: no internal cover, no column clipping for
// bullets or beams. Forces distance management instead of cover-and-
// peek; we can drop a column or two back in if the open layout reads
// as too punishing.
export function buildRoom2(): Room {
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
  ];

  const turretTL = new Turret(250, 250);
  const turretTR = new Turret(1150, 250);
  const turretBL = new Turret(250, 650);
  const turretBR = new Turret(1150, 650);
  const watcher = new Watcher(700, 450);
  // Watcher is the carrier — its kill spawns the key in the centre,
  // which the player then has to collect before the door opens.
  watcher.dropsKey = true;

  return {
    id: "room2",
    walls,
    enemies: [turretTL, turretTR, turretBL, turretBR, watcher],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
      true, // requiresKey
    ),
    nextRoomId: "room4",
    spawnX: 200,
    spawnY: 450,
    width: ROOM_W,
    height: ROOM_H,
    useCamera: true,
  };
}
