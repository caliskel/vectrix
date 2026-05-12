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
const ENTRY_DASH_WALL_X = 600;
const DASH_WALL_W = 30;
// Exit dashable wall is placed so the vestibule on its right mirrors
// the safe-left zone in width: ROOM_W (3600) − safeLeftWidth (615) =
// 2985 for the tint-seam centre, which puts the wall itself at
// 2985 − DASH_WALL_W/2 = 2970.
const EXIT_DASH_WALL_X = 2970;

// Long horizontal corridor — first encounter. Three zones:
//
//   safe-left   x ∈ [0, 630]     — spawn, key on the floor.
//   infected    x ∈ [630, 3400]  — red walls, "INFECTED ZONE" sign,
//                                  sandbox-style bouncing bullets.
//   safe-right  x ∈ [3430, 3600] — vestibule, door to next room.
//
// Two dashable gates bookend the infected zone (cyan dashed, player
// phases through during dash i-frames, solid for bullets so the
// field is sealed in). No enemies.
export function buildRoom1(): Room {
  const gapTop = DOOR_CENTER_Y - DOOR_H / 2;
  const gapBottom = DOOR_CENTER_Y + DOOR_H / 2;
  // Perimeter tint boundaries — the cyan→red transition lands at the
  // horizontal centre of each dashable wall, so the gate visually
  // splits the safe ↔ infected panels in half. Bullet-spawn bounds
  // are independent and sit just outside the dashable walls so
  // bullets never spawn inside a solid.
  const infectedTopBottomStart = ENTRY_DASH_WALL_X + DASH_WALL_W / 2;
  const infectedTopBottomEnd = EXIT_DASH_WALL_X + DASH_WALL_W / 2;
  const infectedFieldStart = ENTRY_DASH_WALL_X + DASH_WALL_W;
  const infectedFieldEnd = EXIT_DASH_WALL_X;
  const safeRightStart = infectedTopBottomEnd;

  const walls: Wall[] = [
    // perimeter top — three segments (safe / infected / safe). The
    // merge flags suppress the outer stroke + corner brackets on the
    // touching edges so the cyan→red→cyan transition reads as a
    // single continuous panel with a tint change.
    {
      x: 0,
      y: 0,
      w: infectedTopBottomStart,
      h: WALL_T,
      mergeRight: true,
    },
    {
      x: infectedTopBottomStart,
      y: 0,
      w: infectedTopBottomEnd - infectedTopBottomStart,
      h: WALL_T,
      infected: true,
      mergeLeft: true,
      mergeRight: true,
    },
    {
      x: safeRightStart,
      y: 0,
      w: ROOM_W - safeRightStart,
      h: WALL_T,
      mergeLeft: true,
    },
    // perimeter bottom — same split.
    {
      x: 0,
      y: ROOM_H - WALL_T,
      w: infectedTopBottomStart,
      h: WALL_T,
      mergeRight: true,
    },
    {
      x: infectedTopBottomStart,
      y: ROOM_H - WALL_T,
      w: infectedTopBottomEnd - infectedTopBottomStart,
      h: WALL_T,
      infected: true,
      mergeLeft: true,
      mergeRight: true,
    },
    {
      x: safeRightStart,
      y: ROOM_H - WALL_T,
      w: ROOM_W - safeRightStart,
      h: WALL_T,
      mergeLeft: true,
    },
    // perimeter left + right (right is split around the door gap).
    { x: 0, y: 0, w: WALL_T, h: ROOM_H },
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: gapTop },
    {
      x: ROOM_W - WALL_T,
      y: gapBottom,
      w: WALL_T,
      h: ROOM_H - gapBottom,
    },
    // Entry dashable gate — opens the infected zone.
    {
      x: ENTRY_DASH_WALL_X,
      y: WALL_T,
      w: DASH_WALL_W,
      h: ROOM_H - WALL_T * 2,
      dashable: true,
    },
    // Exit dashable gate — seals the vestibule so bouncing bullets
    // can't reach the door area. Solid for bullets, dash-through for
    // the player.
    {
      x: EXIT_DASH_WALL_X,
      y: WALL_T,
      w: DASH_WALL_W,
      h: ROOM_H - WALL_T * 2,
      dashable: true,
    },
    // Infected interior pillars — short cover columns inside the
    // quarantine band.
    { x: 1100, y: 280, w: 60, h: 120, infected: true },
    { x: 1900, y: 100, w: 60, h: 120, infected: true },
    { x: 2700, y: 360, w: 60, h: 120, infected: true },
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
    ambientBullets: {
      spawnArea: {
        x: infectedFieldStart,
        y: WALL_T,
        w: infectedFieldEnd - infectedFieldStart,
        h: ROOM_H - WALL_T * 2,
      },
      maxBullets: 30,
      spawnIntervalMs: 1200,
      speed: 250,
    },
    worldLabels: [
      {
        // Centred inside the infected band — horizontal midpoint of
        // the bullet field, vertical midpoint of the arena. Renders
        // under bullets/player, over walls, so the sign reads as a
        // hazard label painted on the floor that fire passes over.
        x: (infectedFieldStart + infectedFieldEnd) / 2,
        y: ROOM_H / 2,
        text: "INFECTED ZONE",
        size: 56,
        color: "#ff2d55",
        scramble: true,
      },
    ],
  };
}
