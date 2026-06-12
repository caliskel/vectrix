import { makeDoor } from "../lib/door";
import { Watcher } from "../lib/enemies/watcher";
import type { Wall } from "../lib/walls";
import type { Room, SleepingChamberCfg } from "../lib/room";

const ROOM_W = 1200;
const ROOM_H = 800;
const WALL_T = 30;
const BACK_DOOR_X = 600;
const BACK_DOOR_W = 120;
const BACK_DOOR_H = WALL_T;
const KEY_X = 1050;
const KEY_Y = 650;

// Sleeping Chamber — тёмная комната (радиальная видимость 240px).
// Два Watcher-а с уменьшенным радиусом детекции (270px вместо 700) —
// в темноте их не видно издалека, но сближение смертельно опасно.
// Ключ лежит в дальнем углу, убийство не требуется.
// Если хоть один Watcher перейдёт в aggro — noisySector = true,
// и hub при возврате будет злее.
export function buildInfectedHubBottom(): Room {
  const gapLeft = BACK_DOOR_X - BACK_DOOR_W / 2;
  const gapRight = BACK_DOOR_X + BACK_DOOR_W / 2;

  const walls: Wall[] = [
    // Top wall — split around back door (north, facing hub).
    { x: 0, y: 0, w: gapLeft, h: WALL_T, infected: true },
    {
      x: gapRight,
      y: 0,
      w: ROOM_W - gapRight,
      h: WALL_T,
      infected: true,
    },
    // Bottom wall — solid.
    { x: 0, y: ROOM_H - WALL_T, w: ROOM_W, h: WALL_T, infected: true },
    // Left wall — solid.
    { x: 0, y: 0, w: WALL_T, h: ROOM_H, infected: true },
    // Right wall — solid.
    { x: ROOM_W - WALL_T, y: 0, w: WALL_T, h: ROOM_H, infected: true },

    // ──── Внутренние стены — лабиринт ────
    // Горизонтальная перегородка слева — блокирует прямой прорыв,
    // заставляет игрока зайти в левый коридор вдоль стены.
    { x: 30, y: 210, w: 270, h: 22, infected: true },
    // Правая горизонтальная — зеркально отражает левую, создаёт правый коридор.
    { x: 790, y: 210, w: 380, h: 22, infected: true },
    // Вертикальная перегородка по центру — делит верхнюю часть на два пути.
    { x: 530, y: 265, w: 22, h: 185, infected: true },
    // Короткая горизонтальная ниже центра — ещё один поворот влево.
    { x: 140, y: 490, w: 220, h: 22, infected: true },
    // Вертикальная справа от Watcher 2 — заставляет обходить его.
    { x: 800, y: 420, w: 22, h: 160, infected: true },
    // Горизонтальная низко справа — последний барьер перед ключом.
    { x: 890, y: 540, w: 280, h: 22, infected: true },
    // Центральный пиллар у W1 — ЛОС-укрытие.
    { x: 350, y: 365, w: 70, h: 22, infected: true },
  ];

  const sleepingChamber: SleepingChamberCfg = {
    visibilityRadius: 240,
  };

  const w1 = new Watcher(300, 460);
  w1.detectionRadius = 270;
  const w2 = new Watcher(870, 540);
  w2.detectionRadius = 270;

  return {
    id: "infected-hub-bottom",
    theme: "infected",
    walls,
    enemies: [w1, w2],
    door: null,
    nextRoomId: null,
    backDoor: makeDoor(
      BACK_DOOR_X,
      WALL_T / 2,
      BACK_DOOR_W,
      BACK_DOOR_H,
      "open",
      false,
      true,
    ),
    prevRoomId: "infected-hub",
    spawnX: BACK_DOOR_X,
    spawnY: WALL_T + 60,
    width: ROOM_W,
    height: ROOM_H,
    initialKey: { x: KEY_X, y: KEY_Y },
    sleepingChamber,
  };
}
