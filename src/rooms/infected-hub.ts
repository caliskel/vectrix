import { makeDoor } from "../lib/door";
import { Watcher } from "../lib/enemies/watcher";
import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1600;
const ROOM_H = 1200;
const WALL_T = 30;
const SPAWN_X = 150;
const SPAWN_Y = 600;
// East main door — vertical slot on the right wall, 2-key gated.
const EAST_DOOR_W = 30;
const EAST_DOOR_H = 120;
const EAST_DOOR_Y = 600;
// Top + bottom side-room doors — horizontal slots on the top/bottom
// walls, no key required.
const NS_DOOR_W = 120;
const NS_DOOR_H = 30;
const NS_DOOR_X = 800;

// Hub of the "infected sector" — large red arena continuing Room 1's
// quarantine visual language. Three forward exits: top + bottom go to
// side-rooms (Sprint 1 placeholders), east is the main door requiring
// both side-room keys to open.
//
// `opts.noisy` is set when the player previously triggered a wake
// event in the (Sprint 3) Sleeping Chamber and returned to the hub.
// In that branch the two Watchers spawn already in aggro (no peaceful
// idle drift) and ambient bullet density bumps ~30 % (origin doc R21).
// Sprint 1 never sets the flag — Sprint 3 wires the wake event.
export function buildInfectedHub(opts: { noisy: boolean }): Room {
  const eastGapTop = EAST_DOOR_Y - EAST_DOOR_H / 2;
  const eastGapBottom = EAST_DOOR_Y + EAST_DOOR_H / 2;
  const nsGapLeft = NS_DOOR_X - NS_DOOR_W / 2;
  const nsGapRight = NS_DOOR_X + NS_DOOR_W / 2;

  const walls: Wall[] = [
    // Top wall — split around top door.
    { x: 0, y: 0, w: nsGapLeft, h: WALL_T, infected: true },
    {
      x: nsGapRight,
      y: 0,
      w: ROOM_W - nsGapRight,
      h: WALL_T,
      infected: true,
    },
    // Bottom wall — split around bottom door.
    {
      x: 0,
      y: ROOM_H - WALL_T,
      w: nsGapLeft,
      h: WALL_T,
      infected: true,
    },
    {
      x: nsGapRight,
      y: ROOM_H - WALL_T,
      w: ROOM_W - nsGapRight,
      h: WALL_T,
      infected: true,
    },
    // Left wall — solid, no back door.
    { x: 0, y: 0, w: WALL_T, h: ROOM_H, infected: true },
    // Right wall — split around east main door.
    {
      x: ROOM_W - WALL_T,
      y: 0,
      w: WALL_T,
      h: eastGapTop,
      infected: true,
    },
    {
      x: ROOM_W - WALL_T,
      y: eastGapBottom,
      w: WALL_T,
      h: ROOM_H - eastGapBottom,
      infected: true,
    },
    // Internal pillars — LOS-cover so Watcher 2.0's gaze stack can
    // be broken. Three pillars positioned roughly along the natural
    // west→east traversal path. Positions are starting values, tune
    // in playtest.
    { x: 520, y: 540, w: 60, h: 120, infected: true },
    { x: 1130, y: 640, w: 60, h: 120, infected: true },
    { x: 770, y: 920, w: 60, h: 120, infected: true },
  ];

  // East main door — 2-key gated, leads forward into legacy chain
  // (room3 — narrow trap, no Watcher inside so Watcher 2.0 doesn't
  // break it). flipped=false → arrow faces right when open.
  const eastDoor = makeDoor(
    ROOM_W - WALL_T / 2,
    EAST_DOOR_Y,
    EAST_DOOR_W,
    EAST_DOOR_H,
    "closed",
    true, // requiresKey
    false, // flipped
    2, // keysRequired — both side-room keys needed
  );

  // Top + bottom doors — always open, no key. Lead to placeholder
  // side-rooms in Sprint 1; Sprint 2 (Pulsing Heart) and Sprint 3
  // (Sleeping Chamber) will swap the destinations to mechanic
  // rooms with the same ids.
  const topDoor = makeDoor(NS_DOOR_X, WALL_T / 2, NS_DOOR_W, NS_DOOR_H, "open", false);
  const bottomDoor = makeDoor(
    NS_DOOR_X,
    ROOM_H - WALL_T / 2,
    NS_DOOR_W,
    NS_DOOR_H,
    "open",
    false,
  );

  // Two Watchers — patrol positions chosen so idle-drift home is:
  //  a) > 700 px from player spawn (150, 600) so they read as
  //     "peaceful" for ~2 s before detection, and
  //  b) clear of all pillars (no walking-into-pillar lockup).
  // Watcher 1 at (900, 350): spawn dist ≈ 790 px. Clear of all three pillars.
  // Watcher 2 at (1100, 850): spawn dist ≈ 990 px. Below pillar-2's bbox.
  const watcher1 = opts.noisy
    ? new Watcher(900, 350, { startsAggressive: true })
    : new Watcher(900, 350);
  const watcher2 = opts.noisy
    ? new Watcher(1100, 850, { startsAggressive: true })
    : new Watcher(1100, 850);

  return {
    id: "infected-hub",
    walls,
    enemies: [watcher1, watcher2],
    door: eastDoor,
    nextRoomId: "room3",
    extraExits: [
      { door: topDoor, nextRoomId: "infected-hub-top" },
      { door: bottomDoor, nextRoomId: "infected-hub-bottom" },
    ],
    spawnX: SPAWN_X,
    spawnY: SPAWN_Y,
    width: ROOM_W,
    height: ROOM_H,
    useCamera: true,
    ambientBullets: {
      spawnArea: {
        x: WALL_T * 2,
        y: WALL_T * 2,
        w: ROOM_W - WALL_T * 4,
        h: ROOM_H - WALL_T * 4,
      },
      maxBullets: 25,
      spawnIntervalMs: opts.noisy ? 840 : 1200,
      speed: 250,
    },
  };
}
