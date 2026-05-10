import { makeDoor } from "../lib/door";
import { Turret } from "../lib/enemies/turret";
import { Watcher } from "../lib/enemies/watcher";
import type { Wall } from "../lib/walls";
import type { Room } from "./room";

const ROOM_W = 3600;
const ROOM_H = 600;
const WALL_T = 30;
const DOOR_CENTER_Y = 300;
const DOOR_W = 30;
const DOOR_H = 120;

// Long horizontal corridor — 3x wider than the viewport, so it needs
// the follow camera. Player walks the room left-to-right past three
// turrets and a Watcher; the third turret drops a key, Door at the
// far right requires the key + all enemies dead.
export function buildRoom4(): Room {
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
    // interior obstacles — short pillars the player has to weave
    // around. Enemies don't collide with these (simplification noted
    // in the spec); they only constrain the player.
    { x: 1100, y: 280, w: 60, h: 120 },
    { x: 1900, y: 100, w: 60, h: 120 },
    { x: 2700, y: 360, w: 60, h: 120 },
  ];

  const turret1 = new Turret(900, 300);
  const turret2 = new Turret(1900, 300);
  const turret3 = new Turret(2900, 300);
  // Third turret holds the key — its kill spawns the pickup.
  turret3.dropsKey = true;
  const watcher = new Watcher(3300, 300);

  return {
    id: "room4",
    walls,
    enemies: [turret1, turret2, turret3, watcher],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
      true, // requiresKey
    ),
    nextRoomId: "room5",
    spawnX: 200,
    spawnY: DOOR_CENTER_Y,
    width: ROOM_W,
    height: ROOM_H,
    useCamera: true,
  };
}
