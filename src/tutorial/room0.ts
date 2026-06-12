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

// Tutorial Room 0 — controls onboarding. Player spawns at (200, 400)
// and the engine drives a 3-phase progression:
//
//   1. Movement: 4 markers in 4 directions, any-order. Hint
//      "USE [W][A][S][D] TO MOVE".
//   2. Dash: a single marker behind a horizontal wall obstacle that
//      can only be passed during dash i-frames. Hint "PRESS [X] TO
//      DASH".
//   3. Combat: a TrainingDummy in the center. Three dash-throughs
//      kill it. Hint "DASH THROUGH THE TARGET 3 TIMES TO DESTROY IT".
//
// Phase wiring lives in tutorial-game.ts; this factory only sets up
// the initial Phase 1 state — perimeter walls, the four direction
// markers, and a closed door.
export function buildRoom0(): Room {
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
    id: "room0",
    theme: "tutorial",
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
    // Phase 1 — four movement markers walked in strict 1 → 2 → 3 → 4
    // order. Path: center → upper-left → upper-right → lower-left.
    // The last marker lands the player on the LEFT side so that when
    // Phase 2's vertical wall slams down at x=585, the dash lane runs
    // left-to-right through it.
    markers: [
      createMarker(600, 400, 1, "→"),
      createMarker(200, 200, 2, "↖"),
      createMarker(1000, 200, 3, "↗"),
      createMarker(300, 600, 4, "↙"),
    ],
  };
}
