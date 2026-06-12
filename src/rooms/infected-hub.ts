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

// ── Irregular perimeter (U6) ────────────────────────────────────────
// The hub silhouette is no longer a plain rectangle: every corner is
// cut by a two-level stairstep and each long (top/bottom) edge carries
// one shallow alcove — the notched-octagon language of
// docs/brainstorms/visual-overhaul-reference.jpg. All notches are made
// by THICKENING the wall locally, pushing the inner face inward; the
// outer extent stays the full 1600×1200 rectangle, so width/height,
// camera, and arena-bg math are untouched and no floor leaks outside
// the silhouette. Collision is unchanged in kind — just more flush
// AABB blocks.
//
// Stairstep corner — NW shown; the other three are exact mirrors.
// Inner-face profile (world coords, NW):
//   top wall face  y = 30   for x ≥ 320
//   step face      y = 110  for x ∈ [200, 320]
//   step face      y = 200  for x ∈ [110, 200]
//   step face      x = 110  for y ∈ [200, 320]
//   left wall face x = 30   for y ≥ 320
// Decomposed into 7 flush rects (STEP_BLOCKS below) whose internal
// seams are tiled EXACTLY so the merge flags suppress every internal
// trim stroke. Seam audit (NW frame):
//   strip.bottom (x 0..320)  = a2.top (0..200) ∪ b2.top (200..320)
//   a2.bottom    (x 0..200)  = a3.top (0..110) ∪ b3.top (110..200)
//   a3.bottom    (x 0..110)  = a4.top (0..30)  ∪ b4.top (30..110)
//   a2|b2 seam x=200 (y 30..110), a3|b3 seam x=110 (y 110..200),
//   a4|b4 seam x=30 (y 200..320) — full-edge matches
//   strip.right  (x=320, y 0..30)  = continuing top-wall left edge
//   a4.bottom    (x 0..30, y=320)  = side-wall top edge
// Exposed step faces (b2/b3/b4 right + bottom) are all ≥ 80 px so
// sliding along the steps feels intentional, not snaggy.
const CORNER_SPAN = 320; // stairstep footprint along each wall

// Shallow alcoves — one per long edge, placed clear of the door gaps
// (top jamb at x=860 → alcove at 1020, 160 px clearance; bottom jamb
// at x=740 → alcove ends at 580, 160 px clearance). The alcove is the
// wall thickened to ALCOVE_DEPTH over ALCOVE_W; its strip merges into
// the neighbouring wall runs and down into the alcove body.
const ALCOVE_W = 160;
const ALCOVE_DEPTH = 120; // inner face depth from the outer edge
const TOP_ALCOVE_X = 1020; // east of the top door
const BOTTOM_ALCOVE_X = 420; // west of the bottom door

// Stairstep blocks in the NW corner's local frame (origin at the room
// corner, +x along the top wall, +y along the side wall). merge sides
// are local too — steppedCorner() mirrors both under sx/sy.
type StepBlock = {
  x: number;
  y: number;
  w: number;
  h: number;
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
};

const STEP_BLOCKS: StepBlock[] = [
  // strip — the top-wall run over the corner; merges outward into the
  // continuing top wall and down into row 2.
  { x: 0, y: 0, w: CORNER_SPAN, h: WALL_T, bottom: true, right: true },
  // row 2 (y 30..110) — inner face y=110 for x ∈ [200, 320]
  { x: 0, y: 30, w: 200, h: 80, top: true, right: true, bottom: true },
  { x: 200, y: 30, w: 120, h: 80, top: true, left: true },
  // row 3 (y 110..200) — inner face y=200 for x ∈ [110, 200]
  { x: 0, y: 110, w: 110, h: 90, top: true, right: true, bottom: true },
  { x: 110, y: 110, w: 90, h: 90, top: true, left: true },
  // row 4 (y 200..320) — inner face x=110 for y ∈ [200, 320]; the
  // x<30 column merges down into the side wall.
  { x: 0, y: 200, w: WALL_T, h: 120, top: true, right: true, bottom: true },
  { x: WALL_T, y: 200, w: 80, h: 120, top: true, left: true },
];

// Emits the 7 flush blocks of one stairstep corner. (sx, sy) pick the
// corner: (1,1)=NW, (-1,1)=NE, (1,-1)=SW, (-1,-1)=SE. mergeLeft/Right
// swap under the x-mirror and mergeTop/Bottom under the y-mirror so
// every internal seam keeps its suppressed trim after mirroring.
function steppedCorner(sx: 1 | -1, sy: 1 | -1): Wall[] {
  return STEP_BLOCKS.map((b) => {
    const wall: Wall = {
      x: sx > 0 ? b.x : ROOM_W - b.x - b.w,
      y: sy > 0 ? b.y : ROOM_H - b.y - b.h,
      w: b.w,
      h: b.h,
      infected: true,
    };
    if (sx > 0 ? b.left : b.right) wall.mergeLeft = true;
    if (sx > 0 ? b.right : b.left) wall.mergeRight = true;
    if (sy > 0 ? b.top : b.bottom) wall.mergeTop = true;
    if (sy > 0 ? b.bottom : b.top) wall.mergeBottom = true;
    return wall;
  });
}

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
    // Four stairstep corners — 7 flush blocks each (see STEP_BLOCKS).
    ...steppedCorner(1, 1), // NW
    ...steppedCorner(-1, 1), // NE
    ...steppedCorner(1, -1), // SW
    ...steppedCorner(-1, -1), // SE

    // ── Top edge, west → east. Corner strips already cover x < 320
    // and x > 1280; the runs below tile [320..1280] minus the door
    // gap [740..860], with the alcove at [1020..1180].
    // [320..740] — plain run up to the top-door jamb (jamb edge stays
    // un-merged so the doorway keeps its trim, exactly like before).
    {
      x: CORNER_SPAN,
      y: 0,
      w: nsGapLeft - CORNER_SPAN,
      h: WALL_T,
      infected: true,
      mergeLeft: true,
    },
    // [860..1020] — jamb to alcove.
    {
      x: nsGapRight,
      y: 0,
      w: TOP_ALCOVE_X - nsGapRight,
      h: WALL_T,
      infected: true,
      mergeRight: true,
    },
    // [1020..1180] — alcove strip, thickened by the body below it.
    {
      x: TOP_ALCOVE_X,
      y: 0,
      w: ALCOVE_W,
      h: WALL_T,
      infected: true,
      mergeLeft: true,
      mergeRight: true,
      mergeBottom: true,
    },
    // Alcove body — inner face drops to y=120. Exposed faces: left /
    // right (90 px) + bottom (160 px). Top seam = strip bottom, exact.
    {
      x: TOP_ALCOVE_X,
      y: WALL_T,
      w: ALCOVE_W,
      h: ALCOVE_DEPTH - WALL_T,
      infected: true,
      mergeTop: true,
    },
    // [1180..1280] — alcove to the NE corner strip.
    {
      x: TOP_ALCOVE_X + ALCOVE_W,
      y: 0,
      w: ROOM_W - CORNER_SPAN - (TOP_ALCOVE_X + ALCOVE_W),
      h: WALL_T,
      infected: true,
      mergeLeft: true,
      mergeRight: true,
    },

    // ── Bottom edge, west → east. Same tiling, alcove at [420..580].
    // [320..420] — SW corner strip to alcove.
    {
      x: CORNER_SPAN,
      y: ROOM_H - WALL_T,
      w: BOTTOM_ALCOVE_X - CORNER_SPAN,
      h: WALL_T,
      infected: true,
      mergeLeft: true,
      mergeRight: true,
    },
    // [420..580] — alcove strip.
    {
      x: BOTTOM_ALCOVE_X,
      y: ROOM_H - WALL_T,
      w: ALCOVE_W,
      h: WALL_T,
      infected: true,
      mergeLeft: true,
      mergeRight: true,
      mergeTop: true,
    },
    // Alcove body — inner face rises to y=1080.
    {
      x: BOTTOM_ALCOVE_X,
      y: ROOM_H - ALCOVE_DEPTH,
      w: ALCOVE_W,
      h: ALCOVE_DEPTH - WALL_T,
      infected: true,
      mergeBottom: true,
    },
    // [580..740] — alcove to the bottom-door jamb.
    {
      x: BOTTOM_ALCOVE_X + ALCOVE_W,
      y: ROOM_H - WALL_T,
      w: nsGapLeft - (BOTTOM_ALCOVE_X + ALCOVE_W),
      h: WALL_T,
      infected: true,
      mergeLeft: true,
    },
    // [860..1280] — jamb to the SE corner strip.
    {
      x: nsGapRight,
      y: ROOM_H - WALL_T,
      w: ROOM_W - CORNER_SPAN - nsGapRight,
      h: WALL_T,
      infected: true,
      mergeRight: true,
    },

    // ── Left wall, between the NW/SW corner steps (y 320..880),
    // split by the back-door gap [540..660]. Top/bottom seams merge
    // into the corner a4 blocks; the jamb edges stay un-merged.
    {
      x: 0,
      y: CORNER_SPAN,
      w: WALL_T,
      h: SPAWN_Y - EAST_DOOR_H / 2 - CORNER_SPAN,
      infected: true,
      mergeTop: true,
    },
    {
      x: 0,
      y: SPAWN_Y + EAST_DOOR_H / 2,
      w: WALL_T,
      h: ROOM_H - CORNER_SPAN - (SPAWN_Y + EAST_DOOR_H / 2),
      infected: true,
      mergeBottom: true,
    },
    // Безопасный бокс у левого выхода (spawn ≈ 150, 600).
    // Три dashable-стены толщиной WALL_T — как дашабельные ворота в комнате 1.
    // Верхняя и нижняя примыкают к зазору backDoor (540–660),
    // правая закрывает бокс и позволяет выйти дашем в комнату.
    {
      x: WALL_T,
      y: SPAWN_Y - EAST_DOOR_H / 2 - WALL_T,
      w: 200,
      h: WALL_T,
      dashable: true,
    },
    {
      x: WALL_T,
      y: SPAWN_Y + EAST_DOOR_H / 2,
      w: 200,
      h: WALL_T,
      dashable: true,
    },
    {
      x: WALL_T + 200,
      y: SPAWN_Y - EAST_DOOR_H / 2 - WALL_T,
      w: WALL_T,
      h: EAST_DOOR_H + WALL_T * 2,
      dashable: true,
    },
    // ── Right wall, between the NE/SE corner steps (y 320..880),
    // split by the east main door gap [540..660].
    {
      x: ROOM_W - WALL_T,
      y: CORNER_SPAN,
      w: WALL_T,
      h: eastGapTop - CORNER_SPAN,
      infected: true,
      mergeTop: true,
    },
    {
      x: ROOM_W - WALL_T,
      y: eastGapBottom,
      w: WALL_T,
      h: ROOM_H - CORNER_SPAN - eastGapBottom,
      infected: true,
      mergeBottom: true,
    },
    // Internal pillars — LOS-cover so Watcher 2.0's gaze stack can
    // be broken. Three pillars positioned roughly along the natural
    // west→east traversal path. Positions are starting values, tune
    // in playtest.
    { x: 520, y: 540, w: 60, h: 120, infected: true },
    { x: 1130, y: 640, w: 60, h: 120, infected: true },
    { x: 770, y: 920, w: 60, h: 120, infected: true },
  ];

  // Back door on the LEFT wall — returns to room1 (the infected
  // corridor). Centred vertically at spawn y, same height as the east
  // door so the gap is symmetric and reads as an intentional doorway.
  const backDoor = makeDoor(
    WALL_T / 2,
    SPAWN_Y,
    EAST_DOOR_W, // w = wall thickness (30 px, horizontal extent)
    EAST_DOOR_H, // h = gap height (120 px, vertical extent)
    "open",
    false,
    true, // flipped — arrow points left toward room1
  );

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
    theme: "infected",
    walls,
    enemies: [watcher1, watcher2],
    door: eastDoor,
    nextRoomId: "room5",
    backDoor,
    prevRoomId: "room1",
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
      // U6 authoring rule: the spawn rect must lie fully inside the
      // notched silhouette. Corner stairsteps reach x=320 / x=1280
      // (for y ≤ 320 / y ≥ 880) and the alcoves reach y=120 (top) /
      // y=1080 (bottom), so x ∈ [350, 1250] × y ∈ [150, 1050] clears
      // every perimeter block with a 30 px margin (same margin the
      // old rect kept from the plain walls), centred on the room.
      // Bullets bounce, so they still cover the whole floor.
      spawnArea: { x: 350, y: 150, w: 900, h: 900 },
      maxBullets: 25,
      spawnIntervalMs: opts.noisy ? 840 : 1200,
      speed: 250,
    },
  };
}
