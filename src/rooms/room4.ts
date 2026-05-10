import { makeDoor } from "../lib/door";
import { Hunter } from "../lib/enemies/hunter";
import type { Wall } from "../lib/walls";
import type { Room, PendingEnemy } from "../lib/room";

const ROOM_W = 8000;
const ROOM_H = 700;
const WALL_T = 30;
const SECTION_COUNT = 6;
// Sections are ~1300 px wide separated by 30 px dividers. With
// SECTION_COUNT = 6 the room takes 6 sections + 5 dividers + a final
// right-wall slab for the door, which lines up to ROOM_W = 8000.
const DOOR_CENTER_Y = 350;
const DOOR_W = 30;
const DOOR_H = 120;
const KEY_X = 4500;
const KEY_Y = 350;

// Long 6-section corridor. Each section is 1300 px wide separated by
// dashable dividers — the player has to clear each section with a
// dash. A wall-phasing Hunter spawns into each section as the player
// crosses in (lazy via Room.pendingEnemies), so by mid-corridor up to
// half a dozen hunters are converging from every direction at once.
// The key is pre-placed on the floor in section 4 (`Room.initialKey`)
// instead of a kill drop — the hunters never carry it.
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
  ];
  // Section dividers — full-height, dashable so the player can phase
  // through during dash i-frames. Cyan dashed outline reads "phase
  // through this on dash" without copy.
  const dividerXs = [1300, 2600, 3900, 5200, 6500];
  for (const x of dividerXs) {
    walls.push({ x, y: 0, w: WALL_T, h: ROOM_H, dashable: true });
  }

  // One Hunter per section — each spawns at the section's far end
  // when the player crosses just inside the section's left edge.
  // Section 1 (the spawn section) fires immediately at triggerX = 0.
  // Spawn x sits ~1100 px past the trigger so the chase has room to
  // build up. ignoresWalls keeps every Hunter able to converge across
  // dividers regardless of where the player currently is.
  const sections: { triggerX: number; spawnX: number }[] = [
    { triggerX: 0, spawnX: 1100 },
    { triggerX: 1340, spawnX: 2400 },
    { triggerX: 2640, spawnX: 3700 },
    { triggerX: 3940, spawnX: 5000 },
    { triggerX: 5240, spawnX: 6300 },
    { triggerX: 6540, spawnX: 7700 },
  ];
  if (sections.length !== SECTION_COUNT) {
    throw new Error("Room 4: section descriptors out of sync with count");
  }
  const pendingEnemies: PendingEnemy[] = sections.map((s) => ({
    triggerX: s.triggerX,
    spawned: false,
    spawn: () =>
      new Hunter(s.spawnX, DOOR_CENTER_Y, {
        startsAggressive: true,
        ignoresWalls: true,
      }),
  }));

  return {
    id: "room4",
    walls,
    enemies: [],
    pendingEnemies,
    initialKey: { x: KEY_X, y: KEY_Y },
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
