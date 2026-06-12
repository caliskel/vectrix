import { makeDoor } from "../lib/door";
import { Sentinel } from "../lib/enemies/sentinel";
import type { Wall } from "../lib/walls";
import type { Room } from "../lib/room";

const ROOM_W = 1600;
const ROOM_H = 1200;
const WALL_T = 30;
const DOOR_CENTER_Y = 600;
const DOOR_W = 30;
const DOOR_H = 120;
const SENTINEL_X = 800;
const SENTINEL_Y = 600;

// ── Irregular perimeter (U6) ────────────────────────────────────────
// Pinwheel corner slabs: each corner is cut by a single rectangular
// slab laid along one wall — NW/SE along the top/bottom walls
// (300×120), NE/SW along the right/left walls (120×260). Every slab
// thickens the wall INWARD — the outer 1600×1200 extent is unchanged,
// so width/height, camera, and arena-bg math hold, and no floor leaks
// outside the silhouette. Collision stays plain AABB blocks.
//
// Intrusion past the original 30 px inner face is exactly 90 px,
// modest on purpose: the Sentinel's lemniscate (x amp 630, y
// deviation ≤ 215 around centre, body radius 110) only nears the
// east/west walls at y ≈ 600 and only nears y-extremes at
// x ≈ 800 ± 445, so the body keeps clear of every slab region —
// closest approach is the NE/SW vertical slabs, where x-overlap
// requires |sin t| ≥ 0.905, capping |y dev| at 183 px vs the 230 px
// needed to reach the slab band. No mid-edge alcoves here (corner
// steps only, per the boss-arena clearance rule).
const H_SLAB_SPAN = 300; // NW + SE slab extent along the top/bottom walls
const V_SLAB_SPAN = 260; // NE + SW slab extent along the right/left walls
const SLAB_DEPTH = 120; // slab thickness from the outer edge

// Boss arena. Open square room with a single Sentinel in the centre.
// rooms-game runs the intro + death sequence (slowmo, layered
// explosion, VICTORY text, Game Complete overlay) on top of this
// room — the file just provides the geometry and the boss instance.
// nextRoomId is null because the campaign ends here; door opens on
// Sentinel kill via the standard "all enemies dead" rule.
export function buildRoom5(): Room {
  const gapTop = DOOR_CENTER_Y - DOOR_H / 2;
  const gapBottom = DOOR_CENTER_Y + DOOR_H / 2;
  // Flush perimeter blocks with exact seams — every internal seam is
  // a full-edge (or exactly-tiled) match so merge flags suppress the
  // trim on internal joints; exposed slab faces are 90 px or longer.
  // Seam audit (coordinates in world space):
  //   top strips:   x=300 (y 0..30), x=1480 (y 0..30)
  //   NW: strip.bottom (x 0..300) = col.top (0..30) ∪ body.top (30..300);
  //       col|body seam x=30 (y 30..120); col.bottom (x 0..30, y=120)
  //       = left-wall top
  //   NE: strip.bottom (x 1480..1600) = body.top (1480..1570) ∪
  //       col.top (1570..1600); body|col seam x=1570 (y 30..260);
  //       col.bottom (x 1570..1600, y=260) = right-wall(N) top
  //   left wall (y 120..940): top = NW col, bottom = SW col
  //   SW: col.top (x 0..30, y=940) = left-wall bottom; col|body seam
  //       x=30 (y 940..1170); col.bottom ∪ body.bottom (x 0..120)
  //       = bottom strip B1 top
  //   SE: col.top (x 1570..1600, y=1080) = right-wall(S) bottom;
  //       body|col seam x=1570 (y 1080..1170); body.bottom ∪
  //       col.bottom (x 1300..1600) = bottom strip B3 top
  //   bottom strips: x=120 (y 1170..1200), x=1300 (y 1170..1200)
  //   right wall door jambs at y=540 / y=660 stay un-merged.
  const walls: Wall[] = [
    // ── Top edge, west → east ──
    // NW slab strip [x 0..300].
    { x: 0, y: 0, w: H_SLAB_SPAN, h: WALL_T, mergeRight: true, mergeBottom: true },
    // Plain run [x 300..1480].
    {
      x: H_SLAB_SPAN,
      y: 0,
      w: ROOM_W - SLAB_DEPTH - H_SLAB_SPAN,
      h: WALL_T,
      mergeLeft: true,
      mergeRight: true,
    },
    // NE slab strip [x 1480..1600].
    {
      x: ROOM_W - SLAB_DEPTH,
      y: 0,
      w: SLAB_DEPTH,
      h: WALL_T,
      mergeLeft: true,
      mergeBottom: true,
    },

    // ── NW corner slab body (y 30..120) ──
    // Wall-column part [x 0..30] — continues the left wall through
    // the slab; its bottom edge seams exactly with the left wall top.
    {
      x: 0,
      y: WALL_T,
      w: WALL_T,
      h: SLAB_DEPTH - WALL_T,
      mergeTop: true,
      mergeRight: true,
      mergeBottom: true,
    },
    // Slab body [x 30..300] — exposed faces: right (x=300, 90 px)
    // and bottom (y=120, 270 px).
    {
      x: WALL_T,
      y: WALL_T,
      w: H_SLAB_SPAN - WALL_T,
      h: SLAB_DEPTH - WALL_T,
      mergeTop: true,
      mergeLeft: true,
    },

    // ── NE corner slab body (x 1480..1600, y 30..260) ──
    // Slab body [x 1480..1570] — exposed faces: left (x=1480,
    // 230 px) and bottom (y=260, 90 px).
    {
      x: ROOM_W - SLAB_DEPTH,
      y: WALL_T,
      w: SLAB_DEPTH - WALL_T,
      h: V_SLAB_SPAN - WALL_T,
      mergeTop: true,
      mergeRight: true,
    },
    // Wall-column part [x 1570..1600] — continues the right wall.
    {
      x: ROOM_W - WALL_T,
      y: WALL_T,
      w: WALL_T,
      h: V_SLAB_SPAN - WALL_T,
      mergeTop: true,
      mergeLeft: true,
      mergeBottom: true,
    },

    // ── Left wall [y 120..940] between the NW and SW slabs ──
    {
      x: 0,
      y: SLAB_DEPTH,
      w: WALL_T,
      h: ROOM_H - V_SLAB_SPAN - SLAB_DEPTH,
      mergeTop: true,
      mergeBottom: true,
    },

    // ── Right wall, split by the door gap [540..660] ──
    // [y 260..540] — NE slab to the door jamb.
    {
      x: ROOM_W - WALL_T,
      y: V_SLAB_SPAN,
      w: WALL_T,
      h: gapTop - V_SLAB_SPAN,
      mergeTop: true,
    },
    // [y 660..1080] — jamb to the SE slab.
    {
      x: ROOM_W - WALL_T,
      y: gapBottom,
      w: WALL_T,
      h: ROOM_H - SLAB_DEPTH - gapBottom,
      mergeBottom: true,
    },

    // ── SW corner slab body (x 0..120, y 940..1170) ──
    // Wall-column part [x 0..30].
    {
      x: 0,
      y: ROOM_H - V_SLAB_SPAN,
      w: WALL_T,
      h: V_SLAB_SPAN - WALL_T,
      mergeTop: true,
      mergeRight: true,
      mergeBottom: true,
    },
    // Slab body [x 30..120] — exposed faces: top (y=940, 90 px) and
    // right (x=120, 230 px).
    {
      x: WALL_T,
      y: ROOM_H - V_SLAB_SPAN,
      w: SLAB_DEPTH - WALL_T,
      h: V_SLAB_SPAN - WALL_T,
      mergeLeft: true,
      mergeBottom: true,
    },

    // ── SE corner slab body (x 1300..1600, y 1080..1170) ──
    // Slab body [x 1300..1570] — exposed faces: left (x=1300, 90 px)
    // and top (y=1080, 270 px).
    {
      x: ROOM_W - H_SLAB_SPAN,
      y: ROOM_H - SLAB_DEPTH,
      w: H_SLAB_SPAN - WALL_T,
      h: SLAB_DEPTH - WALL_T,
      mergeRight: true,
      mergeBottom: true,
    },
    // Wall-column part [x 1570..1600].
    {
      x: ROOM_W - WALL_T,
      y: ROOM_H - SLAB_DEPTH,
      w: WALL_T,
      h: SLAB_DEPTH - WALL_T,
      mergeTop: true,
      mergeLeft: true,
      mergeBottom: true,
    },

    // ── Bottom edge, west → east ──
    // SW slab strip [x 0..120].
    {
      x: 0,
      y: ROOM_H - WALL_T,
      w: SLAB_DEPTH,
      h: WALL_T,
      mergeTop: true,
      mergeRight: true,
    },
    // Plain run [x 120..1300].
    {
      x: SLAB_DEPTH,
      y: ROOM_H - WALL_T,
      w: ROOM_W - H_SLAB_SPAN - SLAB_DEPTH,
      h: WALL_T,
      mergeLeft: true,
      mergeRight: true,
    },
    // SE slab strip [x 1300..1600].
    {
      x: ROOM_W - H_SLAB_SPAN,
      y: ROOM_H - WALL_T,
      w: H_SLAB_SPAN,
      h: WALL_T,
      mergeLeft: true,
      mergeTop: true,
    },
  ];

  return {
    id: "room5",
    theme: "boss",
    walls,
    enemies: [
      new Sentinel(SENTINEL_X, SENTINEL_Y, {
        arenaW: ROOM_W,
        arenaH: ROOM_H,
      }),
    ],
    door: makeDoor(
      ROOM_W - WALL_T / 2,
      DOOR_CENTER_Y,
      DOOR_W,
      DOOR_H,
      "closed",
      false,
    ),
    nextRoomId: null,
    spawnX: 200,
    spawnY: 600,
    width: ROOM_W,
    height: ROOM_H,
    useCamera: true,
  };
}
