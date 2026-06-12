/**
 * Node-safe structural validation for editor-authored JSON rooms.
 *
 * Lives separately from `build-room-from-json.ts` because that module
 * transitively imports browser-only code (Canvas sprite caches, Tone
 * audio) which can't load under Node — so the Vite dev-server plugin
 * imports this validator instead of the full loader. The loader itself
 * also uses this validator, so the two paths share one source of truth
 * for "what does a well-formed RoomJson look like".
 *
 * Plan note (U3): the spec says "run buildRoomFromJson to validate
 * before write." Same intent, but pure-data validation only — anything
 * the runtime constructor would catch (unknown enemy type, bad
 * pendingEnemy kind, missing required fields) is also caught here, and
 * any browser-API errors that would occur during enemy instantiation
 * are irrelevant for "is this JSON safe to persist".
 *
 * See `docs/plans/2026-05-12-002-feat-level-editor-plan.md` U1 + U3.
 */

import { isKnownZoneThemeId, listZoneThemeIds } from "../lib/zone-theme";
import type { EnemySpec, PendingEnemySpec, RoomJson } from "./room-json-types";

const ENEMY_TYPES = new Set<EnemySpec["type"]>(["turret", "watcher", "hunter"]);

/** Outer wall band thickness — every room's perimeter walls are 30 px
 *  thick by convention (see room1.ts and friends). Kept local instead
 *  of imported from `lib/walls.ts` because that module is browser-only
 *  (canvas bakes) and this validator must stay Node-safe. */
const OUTER_WALL_BAND_PX = 30;
/** Mirrors DEFAULT_WIDTH / DEFAULT_HEIGHT in build-room-from-json.ts
 *  (not imported — that module transitively pulls browser-only code). */
const DEFAULT_ROOM_WIDTH = 1200;
const DEFAULT_ROOM_HEIGHT = 800;

/** Throws on any structural problem. Error messages name the offending
 *  field for surfacing in the editor UI.
 *
 *  Emits non-fatal console warnings (authoring-rule violations that
 *  shouldn't block a save / load — e.g. an ambient spawn area leaking
 *  outside the wall-enclosed interior). Each warning is also emitted
 *  via `console.warn` so existing callers that ignore the return value
 *  (Vite save endpoint, JSON room loader) still surface it. */
export function validateRoomJson(json: unknown, idHint?: string): void {
  if (typeof json !== "object" || json === null) {
    throw new Error(`validateRoomJson(${idHint ?? "?"}): payload must be an object`);
  }
  const j = json as RoomJson;
  const id = idHint ?? j.id;
  const need = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(`validateRoomJson(${id ?? "?"}): ${msg}`);
  };
  const warn = (msg: string): void => {
    const full = `validateRoomJson(${id ?? "?"}): WARNING: ${msg}`;
    console.warn(full);
  };

  need(typeof j.id === "string" && j.id.length > 0, "missing id");
  need(typeof j.spawnX === "number" && Number.isFinite(j.spawnX), "missing spawnX");
  need(typeof j.spawnY === "number" && Number.isFinite(j.spawnY), "missing spawnY");
  need(Array.isArray(j.walls), "walls must be an array");
  need(Array.isArray(j.enemies), "enemies must be an array");

  if (j.width !== undefined) {
    need(typeof j.width === "number" && j.width > 0, "width must be a positive number");
  }
  if (j.height !== undefined) {
    need(typeof j.height === "number" && j.height > 0, "height must be a positive number");
  }

  if (j.theme !== undefined) {
    need(typeof j.theme === "string", "theme must be a string");
    need(
      isKnownZoneThemeId(j.theme),
      `unknown theme id ${JSON.stringify(j.theme)} — valid ids: ${listZoneThemeIds().join(", ")} (or omit the field for the default theme)`,
    );
  }

  for (const w of j.walls) {
    need(
      typeof w.x === "number" && typeof w.y === "number" &&
        typeof w.w === "number" && typeof w.h === "number",
      "wall has non-numeric coords",
    );
    need(w.w > 0 && w.h > 0, `wall at (${w.x}, ${w.y}) has non-positive size`);
  }

  for (const e of j.enemies) {
    need(
      typeof e === "object" && e !== null && typeof (e as EnemySpec).type === "string",
      "enemy entry malformed",
    );
    const t = (e as EnemySpec).type;
    need(ENEMY_TYPES.has(t), `unknown enemy type: ${JSON.stringify(t)}`);
    need(
      typeof (e as EnemySpec).x === "number" && typeof (e as EnemySpec).y === "number",
      `enemy type=${t} has non-numeric coords`,
    );
  }

  if (j.pendingEnemies) {
    for (const p of j.pendingEnemies as PendingEnemySpec[]) {
      need(ENEMY_TYPES.has(p.type), `pendingEnemy: unknown type ${JSON.stringify(p.type)}`);
      need(typeof p.triggerX === "number", `pendingEnemy: triggerX must be a number`);
      need(
        typeof p.spawn === "object" && p.spawn !== null,
        `pendingEnemy at triggerX=${p.triggerX} missing spawn`,
      );
      const kind = (p.spawn as { kind?: unknown }).kind;
      need(
        kind === "point" || kind === "randomY",
        `pendingEnemy.spawn.kind must be 'point' or 'randomY', got ${JSON.stringify(kind)}`,
      );
      if (kind === "point") {
        const sp = p.spawn as { kind: "point"; x: number; y: number };
        need(
          typeof sp.x === "number" && typeof sp.y === "number",
          `pendingEnemy point spawn needs numeric x, y`,
        );
      } else {
        const sp = p.spawn as { kind: "randomY"; x: number; yRange: [number, number] };
        need(
          typeof sp.x === "number" && Array.isArray(sp.yRange) && sp.yRange.length === 2,
          `pendingEnemy randomY spawn needs x and yRange [number, number]`,
        );
        const [a, b] = sp.yRange;
        need(
          typeof a === "number" && typeof b === "number" && a !== b,
          `pendingEnemy at triggerX=${p.triggerX} has invalid yRange`,
        );
      }
    }
  }

  if (j.backDoor) {
    need(
      typeof j.prevRoomId === "string" || j.prevRoomId === null,
      "backDoor requires prevRoomId (string or null)",
    );
  }

  // Ambient spawn-area sanity (U7) — the U6 authoring rule, automated:
  // the spawn rectangle must lie fully inside the wall-enclosed
  // interior and not overlap any declared wall, or bullets spawn
  // inside walls / outside the silhouette. Non-fatal: warn, don't
  // reject — an in-progress editor draft may legitimately pass
  // through this state.
  if (j.ambientBullets) {
    const sa = j.ambientBullets.spawnArea;
    need(
      typeof sa === "object" && sa !== null &&
        typeof sa.x === "number" && typeof sa.y === "number" &&
        typeof sa.w === "number" && typeof sa.h === "number",
      "ambientBullets.spawnArea must be a rect with numeric x, y, w, h",
    );
    const roomW = typeof j.width === "number" ? j.width : DEFAULT_ROOM_WIDTH;
    const roomH = typeof j.height === "number" ? j.height : DEFAULT_ROOM_HEIGHT;
    const minX = OUTER_WALL_BAND_PX;
    const minY = OUTER_WALL_BAND_PX;
    const maxX = roomW - OUTER_WALL_BAND_PX;
    const maxY = roomH - OUTER_WALL_BAND_PX;
    const saStr = `(x=${sa.x}, y=${sa.y}, w=${sa.w}, h=${sa.h})`;
    if (sa.x < minX || sa.y < minY || sa.x + sa.w > maxX || sa.y + sa.h > maxY) {
      warn(
        `ambientBullets.spawnArea ${saStr} extends outside the room interior ` +
          `x ${minX}..${maxX} / y ${minY}..${maxY} ` +
          `(${roomW}x${roomH} room minus the ${OUTER_WALL_BAND_PX}px outer wall band)`,
      );
    }
    for (const w of j.walls) {
      const overlaps =
        sa.x < w.x + w.w && sa.x + sa.w > w.x &&
        sa.y < w.y + w.h && sa.y + sa.h > w.y;
      if (overlaps) {
        warn(
          `ambientBullets.spawnArea ${saStr} intersects wall at ` +
            `(x=${w.x}, y=${w.y}, w=${w.w}, h=${w.h})`,
        );
      }
    }
  }

}
