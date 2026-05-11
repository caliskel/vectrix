import { makeDoor } from "../lib/door";
import { Hunter } from "../lib/enemies/hunter";
import { Turret } from "../lib/enemies/turret";
import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
const DOOR_CENTER_Y = 400;
const DOOR_W = 30;
const DOOR_H = 120;

// Narrow trap — two crossfire turrets carving the centre line and a
// Hunter that's hostile from the first frame. The room teaches
// constant motion: standing still on y = DOOR_CENTER_Y catches both
// turret streams, and the Hunter's inertia punishes idle holds. Any
// strategy works as long as the player keeps moving.
export function buildRoom3(): Room {
  const gapTop = DOOR_CENTER_Y - DOOR_H / 2;
  const gapBottom = DOOR_CENTER_Y + DOOR_H / 2;
  const walls: Wall[] = [
    { x: 0, y: 0, w: ROOM_W, h: WALL_T },
    { x: 0, y: ROOM_H - WALL_T, w: ROOM_W, h: WALL_T },
    // Left wall is split around the back-door gap (mirrors the right
    // wall's forward-door gap).
    { x: 0, y: 0, w: WALL_T, h: gapTop },
    { x: 0, y: gapBottom, w: WALL_T, h: ROOM_H - gapBottom },
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: gapTop },
    {
      x: ROOM_W - WALL_T,
      y: gapBottom,
      w: WALL_T,
      h: ROOM_H - gapBottom,
    },
  ];

  const turretTop = new Turret(600, 150);
  const turretBottom = new Turret(600, 650);
  // Hunter starts mid-pounce so the player has no breathing room on
  // entry — the urgency is the lesson.
  const hunter = new Hunter(900, 400, { startsAggressive: true });
  hunter.dropsKey = true;

  return {
    id: "room3",
    walls,
    enemies: [turretTop, turretBottom, hunter],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
      true, // requiresKey
    ),
    nextRoomId: "room2",
    spawnX: 150,
    spawnY: 400,
    width: ROOM_W,
    height: ROOM_H,
    useCamera: true,
    backDoor: makeDoor(
      WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "open",
      false,
      true,
    ),
    prevRoomId: "room1",
  };
}
