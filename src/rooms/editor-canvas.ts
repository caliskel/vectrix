/**
 * Editor canvas interaction layer.
 *
 * Owns every mouse / wheel event on the canvas while the editor is
 * in `editing` mode. Routes those into:
 *   - Drag-rect to build walls.
 *   - Click-stamp for enemies / spawn / door / key / pending.
 *   - Click-select on any entity (Selection state lives on the editor
 *     handle so both U5 and this module read from one source).
 *   - Delete / Backspace removes the selected entity.
 *   - Middle-mouse drag → camera pan (via U7 primitives).
 *   - Wheel → camera zoom, cursor-pivot anchored so the world point
 *     under the cursor stays put across zoom changes.
 *
 * Draws (called from rooms-game's render path inside the world
 * transform — see U7):
 *   - 10px snap grid (skipped at zoom < 0.5).
 *   - Spawn diamond, lazy-spawn trigger lines + markers, initial-key
 *     placeholder.
 *   - Hover highlight (cyan 1px) and selection ring (white 2px +
 *     yellow halo 4px dashed — contrasts against both red and cyan
 *     entity colours per design-lens guidance).
 *   - Drag-rect ghost during wall placement.
 *
 * Mutations route through `editor.commitRoomMutation(kind)` so the
 * caches (wallFx / arenaBg / gridNodes / archiveFx) rebuild and the
 * draft saver picks up the change via onDraftDirty.
 *
 * See `docs/plans/2026-05-12-002-feat-level-editor-plan.md` U6 +
 * Key Decision #1.
 */

import type {
  EditorHandle,
  MutationKind,
  Selection,
} from "./editor";
import type { EditorUIHandle } from "./editor-ui";
import { Hunter } from "../lib/enemies/hunter";
import { Turret } from "../lib/enemies/turret";
import { Watcher } from "../lib/enemies/watcher";
import type { Enemy } from "../lib/enemies/types";
import { makeDoor } from "../lib/door";
import {
  type Camera,
  panCamera,
  setCameraZoom,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
} from "../lib/camera";
import { PALETTE } from "../lib/palette";
import type { Room } from "../lib/room";
import type {
  EnemySpec,
  PendingEnemySpec,
  RoomJson,
  WallSpec,
} from "./room-json-types";

const SNAP_GRID_PX = 10;
const HOVER_RING_COLOR = "rgba(125, 211, 252, 0.6)";
const SELECTION_RING_COLOR = "#ffffff";
const SELECTION_HALO_COLOR = "rgba(255, 214, 10, 0.85)";
const GHOST_RECT_COLOR = "rgba(255, 255, 255, 0.7)";
const GRID_LINE_COLOR = "rgba(255, 255, 255, 0.06)";
const SPAWN_DIAMOND_COLOR = "#7dd3fc";
const TRIGGER_LINE_COLOR = "rgba(255, 255, 255, 0.3)";
const DRAG_THRESHOLD_PX = 4;
const KEY_PICKUP_RADIUS = 14;
const SPAWN_RADIUS = 22;

const PENDING_DEFAULT_HUNTER_OPTS = { startsAggressive: true, ignoresWalls: true };

export type EditorCanvasConfig = {
  editor: EditorHandle;
  ui: EditorUIHandle;
  canvas: HTMLCanvasElement;
  getCurrentRoom(): Room;
  getCamera(): Camera;
  /** Letterbox offset in CSS pixels — the room transform starts at
   *  (offsetX, offsetY) on the canvas. */
  getLetterboxOffset(): { x: number; y: number };
  /** Canvas scale factor (CSS px per world px before zoom). */
  getScale(): number;
};

export type EditorCanvasHandle = {
  /** Called from rooms-game render path INSIDE the world transform.
   *  Skips entirely when editor is not in editing mode (the playing
   *  mode runs game pipeline and the editor overlays would be wrong
   *  there). */
  draw(ctx: CanvasRenderingContext2D): void;
  destroy(): void;
};

type DragRect = { startX: number; startY: number; endX: number; endY: number };
type PanState = { lastClientX: number; lastClientY: number };
type EntityDrag = {
  sel: Selection;
  startWorldX: number;
  startWorldY: number;
  entityStartX: number;
  entityStartY: number;
  moved: boolean;
};

export function createEditorCanvas(
  config: EditorCanvasConfig,
): EditorCanvasHandle {
  const { editor, ui, canvas } = config;

  let hoverWorldX = 0;
  let hoverWorldY = 0;
  let hoverSelection: Selection = null;
  let dragRect: DragRect | null = null;
  let panning: PanState | null = null;
  let entityDrag: EntityDrag | null = null;
  /** Spacebar held → left-drag pans instead of placing. Trackpad
   *  fallback for users without a middle-mouse button. */
  let spaceHeld = false;

  // ------- screen ↔ world -------

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const offset = config.getLetterboxOffset();
    const scale = config.getScale();
    const cam = config.getCamera();
    const sx = clientX - rect.left - offset.x;
    const sy = clientY - rect.top - offset.y;
    const wx = sx / (scale * cam.zoom) + cam.x;
    const wy = sy / (scale * cam.zoom) + cam.y;
    return { x: wx, y: wy };
  }

  function snap(v: number): number {
    if (!ui.isSnapOn()) return v;
    return Math.round(v / SNAP_GRID_PX) * SNAP_GRID_PX;
  }

  // ------- hit testing -------

  function hitTest(worldX: number, worldY: number): Selection {
    const room = config.getCurrentRoom();

    // Priority: enemies > door/backDoor > key > pending > walls > spawn.

    for (let i = 0; i < room.enemies.length; i++) {
      const e = room.enemies[i];
      const dx = worldX - e.x;
      const dy = worldY - e.y;
      if (dx * dx + dy * dy <= e.hitboxRadius * e.hitboxRadius) {
        return { kind: enemyKind(e), index: i };
      }
    }
    if (room.door && pointInAabb(worldX, worldY, room.door))
      return { kind: "door" };
    if (room.backDoor && pointInAabb(worldX, worldY, room.backDoor))
      return { kind: "backDoor" };
    if (room.initialKey) {
      const dx = worldX - room.initialKey.x;
      const dy = worldY - room.initialKey.y;
      if (dx * dx + dy * dy <= KEY_PICKUP_RADIUS * KEY_PICKUP_RADIUS)
        return { kind: "key" };
    }
    if (room.pendingEnemies) {
      for (let i = 0; i < room.pendingEnemies.length; i++) {
        const pe = room.pendingEnemies[i];
        // Spec-side spawn coords aren't on the live entity; we read
        // the draft for placement so the marker tracks edits.
        const spec = editor.getDraft().pendingEnemies?.[i];
        const sx = spec?.spawn.kind === "point" ? spec.spawn.x : spec?.spawn.x ?? pe.triggerX;
        const sy = spec?.spawn.kind === "point" ? spec.spawn.y : 400;
        const dx = worldX - sx;
        const dy = worldY - sy;
        if (dx * dx + dy * dy <= 30 * 30) return { kind: "pending", index: i };
      }
    }
    for (let i = 0; i < room.walls.length; i++) {
      if (pointInAabb(worldX, worldY, room.walls[i]))
        return { kind: "wall", index: i };
    }
    const sx = worldX - room.spawnX;
    const sy = worldY - room.spawnY;
    if (sx * sx + sy * sy <= SPAWN_RADIUS * SPAWN_RADIUS)
      return { kind: "spawn" };
    return null;
  }

  // ------- mutation helpers -------

  function commit(kind: MutationKind, opts?: { pendingIndex?: number }): void {
    editor.commitRoomMutation(kind, opts);
  }

  function stampWall(rect: DragRect): void {
    const draft = editor.getDraft();
    const room = config.getCurrentRoom();
    const x = Math.min(rect.startX, rect.endX);
    const y = Math.min(rect.startY, rect.endY);
    const w = Math.abs(rect.endX - rect.startX);
    const h = Math.abs(rect.endY - rect.startY);
    if (w < 5 || h < 5) return;
    const spec: WallSpec = { x, y, w, h };
    draft.walls.push(spec);
    room.walls.push({ ...spec });
    editor.setSelection({ kind: "wall", index: draft.walls.length - 1 });
    commit("wall");
  }

  function stampEnemy(
    kind: "turret" | "watcher" | "hunter",
    worldX: number,
    worldY: number,
  ): void {
    const draft = editor.getDraft();
    const room = config.getCurrentRoom();
    let live: Enemy;
    let spec: EnemySpec;
    switch (kind) {
      case "turret":
        live = new Turret(worldX, worldY, {});
        spec = { type: "turret", x: worldX, y: worldY };
        break;
      case "watcher":
        live = new Watcher(worldX, worldY);
        spec = { type: "watcher", x: worldX, y: worldY };
        break;
      case "hunter":
        live = new Hunter(worldX, worldY, {});
        spec = { type: "hunter", x: worldX, y: worldY };
        break;
    }
    draft.enemies.push(spec);
    room.enemies.push(live);
    editor.setSelection({ kind, index: draft.enemies.length - 1 });
    commit("enemy");
  }

  function stampSpawn(worldX: number, worldY: number): void {
    const draft = editor.getDraft();
    const room = config.getCurrentRoom();
    draft.spawnX = worldX;
    draft.spawnY = worldY;
    room.spawnX = worldX;
    room.spawnY = worldY;
    editor.setSelection({ kind: "spawn" });
    commit("enemy");
  }

  function stampDoor(worldX: number, worldY: number): void {
    const draft = editor.getDraft();
    const room = config.getCurrentRoom();
    const w = 30;
    const h = 120;
    const x = worldX - w / 2;
    const y = worldY - h / 2;
    draft.door = { x, y, w, h, initial: "closed", requiresKey: false, flipped: false };
    room.door = makeDoor(x, y, w, h, "closed", false, false);
    editor.setSelection({ kind: "door" });
    commit("door");
  }

  function stampKey(worldX: number, worldY: number): void {
    const draft = editor.getDraft();
    const room = config.getCurrentRoom();
    draft.initialKey = { x: worldX, y: worldY };
    room.initialKey = { x: worldX, y: worldY };
    editor.setSelection({ kind: "key" });
    commit("key");
  }

  function stampPending(worldX: number, worldY: number): void {
    const draft = editor.getDraft();
    const room = config.getCurrentRoom();
    if (!draft.pendingEnemies) draft.pendingEnemies = [];
    if (!room.pendingEnemies) room.pendingEnemies = [];
    const spec: PendingEnemySpec = {
      type: "hunter",
      opts: PENDING_DEFAULT_HUNTER_OPTS,
      triggerX: worldX,
      spawn: { kind: "point", x: worldX, y: worldY },
    };
    draft.pendingEnemies.push(spec);
    // Live pending closure rebuilds spawn on each trigger.
    const factory = () => new Hunter(worldX, worldY, PENDING_DEFAULT_HUNTER_OPTS);
    room.pendingEnemies.push({
      triggerX: worldX,
      spawned: false,
      spawn: factory,
    });
    editor.setSelection({ kind: "pending", index: draft.pendingEnemies.length - 1 });
    commit("pending", { pendingIndex: draft.pendingEnemies.length - 1 });
  }

  // Deletion routes through editor.deleteSelection so the keyboard
  // shortcut and the properties-panel Delete button share one
  // implementation; the editor handle owns draft + currentRoom
  // mutation + selection clear in one call.

  // ------- mouse handlers -------

  function shouldHandle(): boolean {
    return editor.isPaused();
  }

  function onMouseDown(e: MouseEvent): void {
    if (!shouldHandle()) return;
    // Middle-mouse pan starts regardless of tool, OR Space-held
    // left-click for trackpad users without a middle button.
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      panning = { lastClientX: e.clientX, lastClientY: e.clientY };
      return;
    }
    if (e.button !== 0) return;

    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const tool = ui.getActiveTool();

    if (tool === "select") {
      const hit = hitTest(x, y);
      editor.setSelection(hit);
      if (hit && hit.kind !== "room") {
        const room = config.getCurrentRoom();
        const ent = entityPosFor(hit, room, editor.getDraft());
        if (ent) {
          entityDrag = {
            sel: hit,
            startWorldX: x,
            startWorldY: y,
            entityStartX: ent.x,
            entityStartY: ent.y,
            moved: false,
          };
        }
      }
      return;
    }

    if (tool === "wall") {
      const sx = snap(x);
      const sy = snap(y);
      dragRect = { startX: sx, startY: sy, endX: sx, endY: sy };
      return;
    }

    // Click-stamp tools fire on mousedown (no drag).
    const wx = snap(x);
    const wy = snap(y);
    switch (tool) {
      case "turret":
      case "watcher":
      case "hunter":
        stampEnemy(tool, wx, wy);
        break;
      case "spawn":
        stampSpawn(wx, wy);
        break;
      case "door":
        stampDoor(wx, wy);
        break;
      case "key":
        stampKey(wx, wy);
        break;
      case "pending":
        stampPending(wx, wy);
        break;
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!shouldHandle()) return;
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    hoverWorldX = x;
    hoverWorldY = y;

    if (panning) {
      const dx = e.clientX - panning.lastClientX;
      const dy = e.clientY - panning.lastClientY;
      const scale = config.getScale();
      const zoom = config.getCamera().zoom;
      // Convert screen pixel delta to world delta; pan in the
      // opposite direction so dragging the world feels natural.
      panCamera(config.getCamera(), -dx / (scale * zoom), -dy / (scale * zoom));
      panning.lastClientX = e.clientX;
      panning.lastClientY = e.clientY;
      return;
    }

    if (dragRect) {
      dragRect.endX = snap(x);
      dragRect.endY = snap(y);
    }

    if (entityDrag) {
      const dx = x - entityDrag.startWorldX;
      const dy = y - entityDrag.startWorldY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) entityDrag.moved = true;
      if (entityDrag.moved) {
        const newX = snap(entityDrag.entityStartX + dx);
        const newY = snap(entityDrag.entityStartY + dy);
        applyEntityMove(entityDrag.sel, newX, newY);
      }
    }

    // Hover highlight tracks under cursor when the user hasn't
    // started a placement / drag yet.
    if (!dragRect && !entityDrag && !panning) {
      hoverSelection = hitTest(x, y);
    }

    ui.setMouseCoords(x, y);
    ui.setZoom(config.getCamera().zoom);
  }

  function onMouseUp(e: MouseEvent): void {
    if (!shouldHandle()) return;
    if (panning && (e.button === 1 || e.button === 0)) {
      panning = null;
      if (e.button === 1) return;
      // Space+left-pan: don't fall through to wall / stamp commit.
      if (spaceHeld) return;
    }
    if (e.button !== 0) return;

    if (dragRect) {
      stampWall(dragRect);
      dragRect = null;
      return;
    }
    if (entityDrag) {
      if (entityDrag.moved) {
        commit(mutationKindFor(entityDrag.sel) ?? "wall", {
          pendingIndex:
            entityDrag.sel?.kind === "pending" ? entityDrag.sel.index : undefined,
        });
      }
      entityDrag = null;
    }
  }

  function onWheel(e: WheelEvent): void {
    if (!shouldHandle()) return;
    e.preventDefault();
    const cam = config.getCamera();
    const oldZoom = cam.zoom;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(
      CAMERA_ZOOM_MIN,
      Math.min(CAMERA_ZOOM_MAX, oldZoom * factor),
    );
    if (newZoom === oldZoom) return;
    // Cursor-pivot zoom: anchor the world point under the cursor so
    // it stays put across the zoom change. Without this the camera
    // "runs away" from where the user is looking and the editor
    // feels broken (per plan U7 polish note).
    const rect = canvas.getBoundingClientRect();
    const offset = config.getLetterboxOffset();
    const scale = config.getScale();
    const screenX = e.clientX - rect.left - offset.x;
    const screenY = e.clientY - rect.top - offset.y;
    const worldX = screenX / (scale * oldZoom) + cam.x;
    const worldY = screenY / (scale * oldZoom) + cam.y;
    setCameraZoom(cam, newZoom);
    cam.x = worldX - screenX / (scale * cam.zoom);
    cam.y = worldY - screenY / (scale * cam.zoom);
    cam.targetX = cam.x;
    cam.targetY = cam.y;
    ui.setZoom(cam.zoom);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!shouldHandle()) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "SELECT" || tgt.tagName === "TEXTAREA"))
      return;
    if (e.code === "Delete" || e.code === "Backspace") {
      e.preventDefault();
      editor.deleteSelection();
      return;
    }
    if (e.code === "Space" && !spaceHeld) {
      e.preventDefault();
      spaceHeld = true;
      canvas.style.cursor = "grab";
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space" && spaceHeld) {
      spaceHeld = false;
      canvas.style.cursor = "";
    }
  }

  function applyEntityMove(sel: Selection, x: number, y: number): void {
    if (!sel) return;
    const draft = editor.getDraft();
    const room = config.getCurrentRoom();
    switch (sel.kind) {
      case "wall": {
        // Walls drag by the top-left corner — match drag-rect semantics.
        const w = draft.walls[sel.index];
        const live = room.walls[sel.index];
        if (!w || !live) return;
        w.x = x;
        w.y = y;
        live.x = x;
        live.y = y;
        break;
      }
      case "turret":
      case "watcher":
      case "hunter": {
        const spec = draft.enemies[sel.index];
        const live = room.enemies[sel.index];
        if (!spec || !live) return;
        spec.x = x;
        spec.y = y;
        live.x = x;
        live.y = y;
        break;
      }
      case "spawn":
        draft.spawnX = x;
        draft.spawnY = y;
        room.spawnX = x;
        room.spawnY = y;
        break;
      case "door":
        if (draft.door && room.door) {
          draft.door.x = x;
          draft.door.y = y;
          room.door.x = x;
          room.door.y = y;
        }
        break;
      case "backDoor":
        if (draft.backDoor && room.backDoor) {
          draft.backDoor.x = x;
          draft.backDoor.y = y;
          room.backDoor.x = x;
          room.backDoor.y = y;
        }
        break;
      case "key":
        if (draft.initialKey && room.initialKey) {
          draft.initialKey.x = x;
          draft.initialKey.y = y;
          room.initialKey.x = x;
          room.initialKey.y = y;
        }
        break;
      case "pending": {
        const spec = draft.pendingEnemies?.[sel.index];
        const live = room.pendingEnemies?.[sel.index];
        if (!spec || !live) return;
        if (spec.spawn.kind === "point") {
          spec.spawn.x = x;
          spec.spawn.y = y;
        } else {
          spec.spawn.x = x;
          // randomY: dragging moves the column; y range stays user-set.
        }
        // triggerX defaults to spawn.x for point-mode lazy spawns.
        spec.triggerX = x;
        live.triggerX = x;
        live.spawned = false; // re-arm trigger
        break;
      }
    }
  }

  // ------- draw -------

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!editor.isPaused()) return;

    const cam = config.getCamera();
    const room = config.getCurrentRoom();
    const sel = editor.getSelection();
    const draft = editor.getDraft();

    // Grid — skip below 0.5 zoom (lines collapse) or under wall scale.
    if (cam.zoom >= 0.5) {
      ctx.save();
      ctx.strokeStyle = GRID_LINE_COLOR;
      ctx.lineWidth = 1 / cam.zoom;
      ctx.beginPath();
      const w = room.width ?? 1200;
      const h = room.height ?? 800;
      for (let x = 0; x <= w; x += SNAP_GRID_PX) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y <= h; y += SNAP_GRID_PX) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Spawn marker — green diamond + label.
    drawSpawnMarker(ctx, room.spawnX, room.spawnY, cam.zoom);

    // Lazy-spawn markers — vertical dashed line at triggerX +
    // silhouette at spawn point.
    if (draft.pendingEnemies) {
      const h = room.height ?? 800;
      for (let i = 0; i < draft.pendingEnemies.length; i++) {
        const spec = draft.pendingEnemies[i];
        drawPendingMarker(ctx, spec, h, cam.zoom);
      }
    }

    // Hover highlight (only when no drag/pan active).
    if (
      !dragRect && !entityDrag && !panning && hoverSelection &&
      !selectionEquals(hoverSelection, sel)
    ) {
      drawSelectionRing(ctx, hoverSelection, room, draft, cam.zoom, HOVER_RING_COLOR, false);
    }

    // Selection ring.
    if (sel) {
      drawSelectionRing(ctx, sel, room, draft, cam.zoom, SELECTION_RING_COLOR, true);
    }

    // Wall drag-rect ghost.
    if (dragRect) {
      ctx.save();
      ctx.strokeStyle = GHOST_RECT_COLOR;
      ctx.lineWidth = 1 / cam.zoom;
      ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
      const x = Math.min(dragRect.startX, dragRect.endX);
      const y = Math.min(dragRect.startY, dragRect.endY);
      const w = Math.abs(dragRect.endX - dragRect.startX);
      const h = Math.abs(dragRect.endY - dragRect.startY);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    // Status bar coords for the cursor — updates each draw so we
    // don't have to retain mousemove state in the UI module.
    ui.setMouseCoords(hoverWorldX, hoverWorldY);
  }

  // ------- lifecycle -------

  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("contextmenu", (e) => {
    if (editor.isPaused()) e.preventDefault();
  });

  function destroy(): void {
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  }

  return { draw, destroy };
}

// ----- helpers -----

function enemyKind(e: Enemy): "turret" | "watcher" | "hunter" {
  if (e instanceof Turret) return "turret";
  if (e instanceof Watcher) return "watcher";
  if (e instanceof Hunter) return "hunter";
  // Fallback — shouldn't happen since editor-authored enemies are
  // restricted to these three (Sentinel out of scope).
  return "turret";
}

function pointInAabb(
  x: number,
  y: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function mutationKindFor(sel: Selection): MutationKind | null {
  if (!sel) return null;
  switch (sel.kind) {
    case "wall": return "wall";
    case "room": return "size";
    case "turret":
    case "watcher":
    case "hunter":
    case "spawn": return "enemy";
    case "door":
    case "backDoor": return "door";
    case "key": return "key";
    case "pending": return "pending";
  }
}

function entityPosFor(
  sel: Selection,
  room: Room,
  draft: RoomJson,
): { x: number; y: number } | null {
  if (!sel) return null;
  switch (sel.kind) {
    case "wall": {
      const w = room.walls[sel.index];
      return w ? { x: w.x, y: w.y } : null;
    }
    case "turret":
    case "watcher":
    case "hunter": {
      const e = room.enemies[sel.index];
      return e ? { x: e.x, y: e.y } : null;
    }
    case "spawn":
      return { x: room.spawnX, y: room.spawnY };
    case "door":
      return room.door ? { x: room.door.x, y: room.door.y } : null;
    case "backDoor":
      return room.backDoor ? { x: room.backDoor.x, y: room.backDoor.y } : null;
    case "key":
      return room.initialKey
        ? { x: room.initialKey.x, y: room.initialKey.y }
        : null;
    case "pending": {
      const spec = draft.pendingEnemies?.[sel.index];
      if (!spec) return null;
      if (spec.spawn.kind === "point")
        return { x: spec.spawn.x, y: spec.spawn.y };
      return { x: spec.spawn.x, y: (spec.spawn.yRange[0] + spec.spawn.yRange[1]) / 2 };
    }
    case "room":
      return null;
  }
}

function selectionEquals(a: Selection, b: Selection): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if ("index" in a && "index" in b) return a.index === b.index;
  return true;
}

function drawSpawnMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  zoom: number,
): void {
  const s = 14;
  ctx.save();
  ctx.strokeStyle = SPAWN_DIAMOND_COLOR;
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = "rgba(125, 211, 252, 0.18)";
  ctx.fill();
  ctx.fillStyle = SPAWN_DIAMOND_COLOR;
  ctx.font = `${10 / zoom}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("SPAWN", x, y - s - 4 / zoom);
  ctx.restore();
}

function drawPendingMarker(
  ctx: CanvasRenderingContext2D,
  spec: PendingEnemySpec,
  roomH: number,
  zoom: number,
): void {
  ctx.save();
  ctx.strokeStyle = TRIGGER_LINE_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([8 / zoom, 6 / zoom]);
  ctx.beginPath();
  ctx.moveTo(spec.triggerX, 0);
  ctx.lineTo(spec.triggerX, roomH);
  ctx.stroke();
  ctx.setLineDash([]);

  const enemyColor =
    spec.type === "turret"
      ? PALETTE.player
      : spec.type === "watcher"
        ? PALETTE.bullet
        : "#fb923c";

  if (spec.spawn.kind === "point") {
    drawEnemySilhouette(ctx, spec.spawn.x, spec.spawn.y, enemyColor, zoom);
  } else {
    // randomY — show range as two short caps.
    const cx = spec.spawn.x;
    const [y1, y2] = spec.spawn.yRange;
    ctx.strokeStyle = enemyColor;
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.moveTo(cx - 14, y1);
    ctx.lineTo(cx + 14, y1);
    ctx.moveTo(cx - 14, y2);
    ctx.lineTo(cx + 14, y2);
    ctx.moveTo(cx, y1);
    ctx.lineTo(cx, y2);
    ctx.stroke();
    drawEnemySilhouette(ctx, cx, (y1 + y2) / 2, enemyColor, zoom);
  }
  ctx.restore();
}

function drawEnemySilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  zoom: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  sel: Selection,
  room: Room,
  draft: RoomJson,
  zoom: number,
  color: string,
  withHalo: boolean,
): void {
  if (!sel) return;
  ctx.save();
  ctx.lineWidth = 2 / zoom;

  function ringRect(x: number, y: number, w: number, h: number): void {
    if (withHalo) {
      ctx.strokeStyle = SELECTION_HALO_COLOR;
      ctx.lineWidth = 4 / zoom;
      ctx.setLineDash([8 / zoom, 4 / zoom]);
      ctx.strokeRect(x - 3 / zoom, y - 3 / zoom, w + 6 / zoom, h + 6 / zoom);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(x, y, w, h);
  }
  function ringCircle(x: number, y: number, r: number): void {
    if (withHalo) {
      ctx.strokeStyle = SELECTION_HALO_COLOR;
      ctx.lineWidth = 4 / zoom;
      ctx.setLineDash([8 / zoom, 4 / zoom]);
      ctx.beginPath();
      ctx.arc(x, y, r + 4 / zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  switch (sel.kind) {
    case "wall": {
      const w = room.walls[sel.index];
      if (w) ringRect(w.x, w.y, w.w, w.h);
      break;
    }
    case "turret":
    case "watcher":
    case "hunter": {
      const e = room.enemies[sel.index];
      if (e) ringCircle(e.x, e.y, e.hitboxRadius + 4);
      break;
    }
    case "spawn":
      ringCircle(room.spawnX, room.spawnY, SPAWN_RADIUS);
      break;
    case "door":
      if (room.door) ringRect(room.door.x, room.door.y, room.door.w, room.door.h);
      break;
    case "backDoor":
      if (room.backDoor)
        ringRect(room.backDoor.x, room.backDoor.y, room.backDoor.w, room.backDoor.h);
      break;
    case "key":
      if (room.initialKey) ringCircle(room.initialKey.x, room.initialKey.y, KEY_PICKUP_RADIUS);
      break;
    case "pending": {
      const spec = draft.pendingEnemies?.[sel.index];
      if (spec) {
        const cy =
          spec.spawn.kind === "point"
            ? spec.spawn.y
            : (spec.spawn.yRange[0] + spec.spawn.yRange[1]) / 2;
        ringCircle(spec.spawn.x, cy, 22);
      }
      break;
    }
    case "room":
      ringRect(0, 0, room.width ?? 1200, room.height ?? 800);
      break;
  }
  ctx.restore();
}
