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
    // Left wall split around the back-door gap.
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
  // Section dividers — full-height, dashable so the player can phase
  // through during dash i-frames. Cyan dashed outline reads "phase
  // through this on dash" without copy.
  const dividerXs = [1300, 2600, 3900, 5200, 6500];
  for (const x of dividerXs) {
    walls.push({ x, y: 0, w: WALL_T, h: ROOM_H, dashable: true });
  }

  // Two Hunters per section, each spawning from a random off-arena
  // edge (top / bottom / right of the section bounding box) so the
  // pair "flies in" from different angles rather than parking
  // directly in front of the player. ignoresWalls keeps each Hunter
  // able to converge across dividers from the section it spawned
  // for. Section 1 fires immediately on entry (triggerX = 0); later
  // sections fire when the player crosses just inside their left
  // edge.
  const sections: { triggerX: number; xMin: number; xMax: number }[] = [
    { triggerX: 0,    xMin: WALL_T + 100,   xMax: 1270 },
    { triggerX: 1340, xMin: 1330 + 100,     xMax: 2570 },
    { triggerX: 2640, xMin: 2630 + 100,     xMax: 3870 },
    { triggerX: 3940, xMin: 3930 + 100,     xMax: 5170 },
    { triggerX: 5240, xMin: 5230 + 100,     xMax: 6470 },
    { triggerX: 6540, xMin: 6530 + 100,     xMax: 7770 },
  ];
  if (sections.length !== SECTION_COUNT) {
    throw new Error("Room 4: section descriptors out of sync with count");
  }
  function pickHunterSpawn(xMin: number, xMax: number): { x: number; y: number } {
    // 0:top, 1:bottom, 2:right. Skipping "left" (behind the player)
    // since the run-up direction shouldn't have ambush spawns.
    const edge = Math.floor(Math.random() * 3);
    if (edge === 0) {
      return {
        x: xMin + Math.random() * (xMax - xMin),
        y: -60,
      };
    }
    if (edge === 1) {
      return {
        x: xMin + Math.random() * (xMax - xMin),
        y: ROOM_H + 60,
      };
    }
    return {
      x: xMax + 60,
      y: 80 + Math.random() * (ROOM_H - 160),
    };
  }
  const pendingEnemies: PendingEnemy[] = [];
  for (const s of sections) {
    for (let i = 0; i < 2; i++) {
      pendingEnemies.push({
        triggerX: s.triggerX,
        spawned: false,
        spawn: () => {
          const p = pickHunterSpawn(s.xMin, s.xMax);
          return new Hunter(p.x, p.y, {
            startsAggressive: true,
            ignoresWalls: true,
          });
        },
      });
    }
  }

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
    backDoor: makeDoor(
      WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "open",
      false,
      true,
    ),
    prevRoomId: "room2",
  };
}
