import { makeDoor } from "../lib/door";
import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
// Back door on the SOUTH wall — player came UP from the hub's top
// door, lands inside this room facing north. Walking back south
// through the door returns to hub.
const BACK_DOOR_X = 600;
const BACK_DOOR_W = 120;
const BACK_DOOR_H = WALL_T;
// Key in the far north-east corner — placeholder pickup, replaced
// by Pulsing Heart mechanic in Sprint 2.
const KEY_X = 1050;
const KEY_Y = 150;

// Placeholder top side-room — Sprint 2 (Pulsing Heart) replaces this
// file. For Sprint 1 it just proves the connectivity loop: player
// enters from hub's top door, picks up key, walks back through the
// back door, returns to hub with keysHeld incremented.
export function buildInfectedHubTop(): Room {
  const gapLeft = BACK_DOOR_X - BACK_DOOR_W / 2;
  const gapRight = BACK_DOOR_X + BACK_DOOR_W / 2;

  const walls: Wall[] = [
    // Top wall — solid.
    { x: 0, y: 0, w: ROOM_W, h: WALL_T, infected: true },
    // Bottom wall — split around back door (south, facing hub).
    { x: 0, y: ROOM_H - WALL_T, w: gapLeft, h: WALL_T, infected: true },
    {
      x: gapRight,
      y: ROOM_H - WALL_T,
      w: ROOM_W - gapRight,
      h: WALL_T,
      infected: true,
    },
    // Left wall — solid.
    { x: 0, y: 0, w: WALL_T, h: ROOM_H, infected: true },
    // Right wall — solid.
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: ROOM_H, infected: true },
  ];

  return {
    id: "infected-hub-top",
    walls,
    enemies: [],
    // No forward door — this is a dead-end pickup room. Player
    // returns via backDoor.
    door: null,
    nextRoomId: null,
    backDoor: makeDoor(
      BACK_DOOR_X,
      ROOM_H - WALL_T / 2,
      BACK_DOOR_W,
      BACK_DOOR_H,
      "open",
      false,
      true, // flipped — arrow points back toward hub
    ),
    prevRoomId: "infected-hub",
    // Spawn just north of the back door so player enters facing
    // into the room.
    spawnX: BACK_DOOR_X,
    spawnY: ROOM_H - WALL_T - 60,
    width: ROOM_W,
    height: ROOM_H,
    initialKey: { x: KEY_X, y: KEY_Y },
  };
}
