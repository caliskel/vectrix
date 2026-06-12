import { makeDoor } from "../lib/door";
import { Watcher } from "../lib/enemies/watcher";
import type { Wall } from "../lib/walls";
import type { HeartMechanicCfg, Room } from "../lib/room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
const BACK_DOOR_X = 600;
const BACK_DOOR_W = 120;
const BACK_DOOR_H = WALL_T;
// Heart is slightly north of centre so the spawn area (south) gives
// the player room to approach before being in the registration zone.
const HEART_X = 600;
const HEART_Y = 330;
const ORBIT_R = 200;

// Pulsing Heart — player stands in the registration zone for 5 s
// cumulative while two Watchers orbit. Each pulse ring momentarily
// blocks LOS so the gaze meter can decay; timing the approach to
// stay inside a pulse window is the skill expression.
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
    // Two short pillars flanking the heart — LOS cover to help manage
    // gaze stacks when moving between the safe back-door area and the
    // registration zone.
    { x: HEART_X - 260, y: HEART_Y - 50, w: 30, h: 100, infected: true },
    { x: HEART_X + 230, y: HEART_Y - 50, w: 30, h: 100, infected: true },
  ];

  const heartMechanic: HeartMechanicCfg = {
    x: HEART_X,
    y: HEART_Y,
    registrationRadius: 65,
    pulseOrbitRadius: ORBIT_R,
    pulseIntervalSec: 3.5,
    pulseExpandSpeed: 160,
    registrationGoalSec: 5,
  };

  return {
    id: "infected-hub-top",
    theme: "infected",
    walls,
    enemies: [
      // Один Watcher — стоит по другую сторону сердца от входа,
      // игрок вынужден войти в орбитальный радиус чтобы дотянуться
      // до зоны регистрации.
      new Watcher(HEART_X, HEART_Y - ORBIT_R - 30, { startsAggressive: true }),
    ],
    door: null,
    nextRoomId: null,
    backDoor: makeDoor(
      BACK_DOOR_X,
      ROOM_H - WALL_T / 2,
      BACK_DOOR_W,
      BACK_DOOR_H,
      "open",
      false,
      true,
    ),
    prevRoomId: "infected-hub",
    spawnX: BACK_DOOR_X,
    spawnY: ROOM_H - WALL_T - 60,
    width: ROOM_W,
    height: ROOM_H,
    heartMechanic,
    worldLabels: [
      {
        // По аналогии с "INFECTED ZONE" в первой комнате — надпись
        // на полу между спавном и сердцем, проявляется при входе.
        x: HEART_X,
        y: (HEART_Y + ROOM_H - WALL_T) / 2,
        text: "CHARGE THE HEART",
        size: 44,
        color: "#ff2d55",
        scramble: true,
      },
    ],
  };
}
