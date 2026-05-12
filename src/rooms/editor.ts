/**
 * Editor state machine + frame-loop integration.
 *
 * Owns the (closed | editing | playing) tri-state. Editing freezes the
 * frame loop (caller checks `isPaused()` and short-circuits to render
 * only); Playing runs the standard pipeline against a draft-built
 * temp room and restores the editor's room on exit.
 *
 * UI surfaces (toolbar, properties panel, canvas interaction) live in
 * U5 / U6 and call into this handle. localStorage persistence lives in
 * U8 and supplies the draft via `getDraft`. For sessions before U8,
 * `createEditor` accepts an in-memory `initialDraft` and the consumer
 * is expected to swap it out by passing a real persistence layer in.
 *
 * Wrapped behind `import.meta.env.DEV` at the call site so the prod
 * bundle drops the module entirely.
 *
 * See `docs/plans/2026-05-12-002-feat-level-editor-plan.md` U4 +
 * Key Decisions #1, #2, #5, #8.
 */

import type { Bullet } from "../lib/bullets";
import { compactBullets } from "../lib/bullets";
import type { Camera } from "../lib/camera";
import { setCameraMode } from "../lib/camera";
import type { FloatingText, Particle, Ring } from "../lib/particles";
import {
  compactFloatingTexts,
  compactParticles,
  compactRings,
} from "../lib/particles";
import type { Laser } from "../lib/enemies/types";
import type { Room } from "../lib/room";
import { buildRoomFromJson } from "./build-room-from-json";
import type { RoomJson } from "./room-json-types";

export type EditorMode = "closed" | "editing" | "playing";

/** Names what kind of room state changed so the helper can do the
 *  right cache-invalidation + side-effects. The mutation itself
 *  is performed by the caller before the helper runs (the helper
 *  trusts `currentRoom` is already in the desired post-mutation
 *  state). */
export type MutationKind =
  | "wall"
  | "size"
  | "enemy"
  | "door"
  | "key"
  | "pending";

/** What the user currently has selected in the canvas. Owned by the
 *  editor handle so both the DOM UI (properties panel) and the
 *  canvas layer (selection ring) read from one source of truth. */
export type Selection =
  | null
  | { kind: "room" }
  | { kind: "wall"; index: number }
  | { kind: "turret"; index: number }
  | { kind: "watcher"; index: number }
  | { kind: "hunter"; index: number }
  | { kind: "door" }
  | { kind: "backDoor" }
  | { kind: "key" }
  | { kind: "spawn" }
  | { kind: "pending"; index: number };

/** Live references the editor needs from `rooms-game.ts`. Read-only
 *  fields are exposed via getters so the caller can keep `let`
 *  bindings and rebind freely; mutable collections (pools) and
 *  callbacks for engine-level reset hooks round it out. */
export type EditorConfig = {
  /** Returns the live `currentRoom` reference. */
  getCurrentRoom(): Room;
  /** Swaps the live `currentRoom` (used at edit ↔ play boundary). */
  setCurrentRoom(room: Room): void;
  /** Returns the live `camera` reference (editor sets mode = 'edit'
   *  while open and restores 'follow' on close). */
  getCamera(): Camera;
  /** Returns the live projectile pools. Editor calls compactBullets /
   *  compactParticles / compactRings / compactFloatingTexts in place
   *  on these arrays so Float32Array trail buffers return to their
   *  pools — never reassigns. Lasers have no pool API, so we mutate
   *  the array in place via `splice(0)`. */
  getPools(): {
    bullets: Bullet[];
    particles: Particle[];
    rings: Ring[];
    floatingTexts: FloatingText[];
    lasers: Laser[];
  };
  /** Engine hooks. */
  triggerSyncRoomFx(): void;
  triggerSnapCamera(): void;
  /** Re-runs `player.x/y = currentRoom.spawnX/Y` + resets velocity /
   *  dash. Editor calls this on Play start and Restart-from-spawn. */
  triggerSpawnPlayerInCurrentRoom(): void;
  /** Resets the frame-loop's `lastTime` to `performance.now()` so the
   *  next `dt` doesn't include the time spent paused / playing. */
  resetLastTime(): void;
  /** Resets the minimal run-state needed for a fresh test-play:
   *  hp = max, hitIframe = 0, runState = "playing", any per-run
   *  counters the caller cares about. Editor calls this on Play
   *  start and Restart-from-spawn — without it, a player who died
   *  in test-play would press Play again with hp=0 and runState
   *  stuck on "failed". */
  resetRunStateForPlay(): void;
  /** Optional: editor pings this whenever a mutation lands so U8 can
   *  schedule a debounced save. Pre-U8 this can be undefined. */
  onDraftDirty?(): void;
  /** Optional starting draft. Defaults to a blank 1200x800 room with
   *  the player spawn in the centre. */
  initialDraft?: RoomJson;
};

export type EditorHandle = {
  isOpen(): boolean;
  isPaused(): boolean;
  isPlaying(): boolean;
  getMode(): EditorMode;
  getDraft(): RoomJson;
  setDraft(json: RoomJson): void;
  /** Hotkey toggle: closed ↔ editing. While playing, this acts as
   *  "pause back to editing" (per AE3 / R7). */
  toggle(): void;
  openEditing(): void;
  closeEditor(): void;
  /** Editing → playing: snapshot currentRoom, swap in a fresh build
   *  of the draft, clear pools, respawn player. */
  startPlay(): void;
  /** Playing → editing: restore the snapshot, clear pools, sync FX. */
  exitToEditing(): void;
  /** Playing → playing: rebuild a fresh tempRoom from the draft and
   *  respawn (useful for "retry without re-pressing Play"). */
  restartFromSpawn(): void;
  /** Mutation entry point — caller has already updated `currentRoom`,
   *  this fans out side-effects: syncRoomFx, optional `spawned: false`
   *  reset on pending-enemy moves, mark draft dirty. */
  commitRoomMutation(
    kind: MutationKind,
    opts?: { pendingIndex?: number },
  ): void;
  /** Delete whatever is currently selected. Mutates both draft and
   *  currentRoom and clears selection. Spawn and the room
   *  pseudo-entity are not deletable. */
  deleteSelection(): void;
  /** Subscribe to mode transitions. Fires after the state machine
   *  has settled (the side-effects for the new mode have all run).
   *  Returns an unsubscribe function. */
  onModeChange(cb: (next: EditorMode, prev: EditorMode) => void): () => void;
  /** Current selection — null when nothing is highlighted. */
  getSelection(): Selection;
  /** Set selection. Pass `null` to clear. Fires `onSelectionChange`
   *  to anyone subscribed. */
  setSelection(sel: Selection): void;
  onSelectionChange(cb: (sel: Selection) => void): () => void;
  destroy(): void;
};

const DEFAULT_DRAFT: RoomJson = {
  id: "untitled",
  width: 1200,
  height: 800,
  spawnX: 600,
  spawnY: 400,
  walls: [],
  enemies: [],
};

function cloneDraft(json: RoomJson): RoomJson {
  // structuredClone handles nested arrays / unions cleanly; falls back
  // to JSON round-trip if the environment is somehow without it.
  if (typeof structuredClone === "function") return structuredClone(json);
  return JSON.parse(JSON.stringify(json)) as RoomJson;
}

export function createEditor(config: EditorConfig): EditorHandle {
  let mode: EditorMode = "closed";
  /** Snapshot of whatever campaign room was current when the editor
   *  first opened. Restored on close so the live game world isn't
   *  collaterally mutated by editor mutations — F3 from inside any
   *  campaign room (room1..room5) now swaps to a draft tempRoom
   *  instead of letting the user paint on top of the live room. */
  let campaignRoomSnapshot: Room | null = null;
  let draft: RoomJson = cloneDraft(config.initialDraft ?? DEFAULT_DRAFT);
  let selection: Selection = null;
  const modeListeners = new Set<(n: EditorMode, p: EditorMode) => void>();
  const selectionListeners = new Set<(s: Selection) => void>();

  function setMode(next: EditorMode): void {
    const prev = mode;
    if (prev === next) return;
    mode = next;
    for (const cb of modeListeners) {
      try {
        cb(next, prev);
      } catch (e) {
        console.error("[editor] onModeChange listener threw:", e);
      }
    }
  }

  function clearPools(): void {
    const p = config.getPools();
    // Pool-aware: returns Float32Array trail buffers to the bullet
    // pool, particle/ring/floating-text instances to their object
    // pools. Reassigning `let bullets = []` would leak those buffers
    // (paid-in-iterations lesson — see HANDOVER.md, Key Decision #5).
    compactBullets(p.bullets, () => false);
    compactParticles(p.particles, () => false);
    compactRings(p.rings, () => false);
    compactFloatingTexts(p.floatingTexts, () => false);
    // Lasers — no pool API exists; mutate the same array in place so
    // the caller's `let lasers` binding stays valid. `splice(0)` does
    // the equivalent of `length = 0` and returns the dropped items
    // (ignored). This is the explicit exception per Key Decision #5;
    // if a laser pool ever lands, switch this to compactLasers.
    p.lasers.splice(0);
  }

  function openEditing(): void {
    if (mode === "editing") return;
    // Swap to a fresh draft tempRoom so mutations land in the
    // editor's working copy, never the live campaign room the user
    // happened to be in. The campaign room is snapshotted for
    // restore on close.
    let temp: Room;
    try {
      temp = buildTempRoomFromDraft();
    } catch (e) {
      console.error("[editor] cannot open — draft invalid:", e);
      return;
    }
    campaignRoomSnapshot = config.getCurrentRoom();
    config.setCurrentRoom(temp);
    clearPools();
    config.triggerSyncRoomFx();
    config.triggerSpawnPlayerInCurrentRoom();
    setCameraMode(config.getCamera(), "edit");
    config.triggerSnapCamera();
    setMode("editing");
  }

  function closeEditor(): void {
    if (mode === "closed") return;
    if (mode === "playing") exitToEditing();
    // Restore the live campaign room so any in-memory mutations to
    // the tempRoom drop here, not on room1..room5.
    if (campaignRoomSnapshot) {
      config.setCurrentRoom(campaignRoomSnapshot);
      campaignRoomSnapshot = null;
      clearPools();
      config.triggerSyncRoomFx();
      config.triggerSpawnPlayerInCurrentRoom();
      config.triggerSnapCamera();
    }
    setCameraMode(config.getCamera(), "follow");
    // dt would otherwise include the editor session — reset so the
    // next frame's dt is just the rAF interval.
    config.resetLastTime();
    setMode("closed");
  }

  function exitToEditing(): void {
    if (mode !== "playing") return;
    // Rebuild tempRoom fresh from the current draft so test-play
    // mutations (enemy positions, HP, awareness) reset cleanly.
    let temp: Room;
    try {
      temp = buildTempRoomFromDraft();
    } catch (e) {
      console.error("[editor] cannot exit to editing — draft invalid:", e);
      return;
    }
    config.setCurrentRoom(temp);
    clearPools();
    config.triggerSyncRoomFx();
    config.triggerSpawnPlayerInCurrentRoom();
    setCameraMode(config.getCamera(), "edit");
    config.triggerSnapCamera();
    config.resetLastTime();
    setMode("editing");
  }

  function buildTempRoomFromDraft(): Room {
    return buildRoomFromJson(draft, draft.id);
  }

  function startPlay(): void {
    if (mode === "playing") return;
    // Rebuild tempRoom fresh from draft so each Play press starts
    // with pristine enemy state (HP, awareness, pendingEnemies.spawned).
    // campaignRoomSnapshot stays — close-from-playing still needs it.
    let temp: Room;
    try {
      temp = buildTempRoomFromDraft();
    } catch (e) {
      console.error("[editor] cannot start play — draft invalid:", e);
      return;
    }
    config.setCurrentRoom(temp);
    clearPools();
    config.resetRunStateForPlay();
    config.triggerSyncRoomFx();
    config.triggerSpawnPlayerInCurrentRoom();
    setCameraMode(config.getCamera(), "follow");
    config.triggerSnapCamera();
    config.resetLastTime();
    setMode("playing");
  }

  function restartFromSpawn(): void {
    if (mode !== "playing") return;
    let temp: Room;
    try {
      temp = buildTempRoomFromDraft();
    } catch (e) {
      console.error("[editor] cannot restart — draft invalid:", e);
      return;
    }
    // savedRoomBeforePlay stays — only the tempRoom is rebuilt fresh.
    config.setCurrentRoom(temp);
    clearPools();
    config.resetRunStateForPlay();
    config.triggerSyncRoomFx();
    config.triggerSpawnPlayerInCurrentRoom();
    config.triggerSnapCamera();
    config.resetLastTime();
  }

  function toggle(): void {
    if (mode === "closed") {
      openEditing();
    } else if (mode === "editing") {
      closeEditor();
    } else {
      // playing → editing — same effect as the "Pause" button.
      exitToEditing();
    }
  }

  function deleteSelection(): void {
    if (mode === "closed") return;
    const sel = selection;
    if (!sel) return;
    const room = config.getCurrentRoom();
    switch (sel.kind) {
      case "wall":
        draft.walls.splice(sel.index, 1);
        room.walls.splice(sel.index, 1);
        config.triggerSyncRoomFx();
        break;
      case "turret":
      case "watcher":
      case "hunter":
        draft.enemies.splice(sel.index, 1);
        room.enemies.splice(sel.index, 1);
        break;
      case "door":
        draft.door = null;
        room.door = null;
        break;
      case "backDoor":
        draft.backDoor = null;
        room.backDoor = null;
        break;
      case "key":
        delete draft.initialKey;
        room.initialKey = undefined;
        break;
      case "pending":
        if (draft.pendingEnemies) draft.pendingEnemies.splice(sel.index, 1);
        if (room.pendingEnemies) room.pendingEnemies.splice(sel.index, 1);
        break;
      case "spawn":
      case "room":
        // Spawn + room pseudo-entity intentionally not deletable —
        // every room needs a spawn point, and the room itself is the
        // canvas.
        return;
    }
    selection = null;
    for (const cb of selectionListeners) {
      try { cb(null); } catch (e) { console.error(e); }
    }
    config.onDraftDirty?.();
  }

  function commitRoomMutation(
    kind: MutationKind,
    opts?: { pendingIndex?: number },
  ): void {
    if (kind === "wall" || kind === "size") {
      config.triggerSyncRoomFx();
    }
    if (kind === "pending" && opts?.pendingIndex !== undefined) {
      // Re-positioned trigger — a fired-once pending enemy must be
      // re-armed so the next tick re-evaluates it (Key Decision #1).
      const room = config.getCurrentRoom();
      const pe = room.pendingEnemies?.[opts.pendingIndex];
      if (pe) pe.spawned = false;
    }
    config.onDraftDirty?.();
  }

  function destroy(): void {
    if (mode !== "closed") closeEditor();
  }

  return {
    isOpen: () => mode !== "closed",
    isPaused: () => mode === "editing",
    isPlaying: () => mode === "playing",
    getMode: () => mode,
    getDraft: () => draft,
    setDraft: (json) => {
      draft = cloneDraft(json);
      config.onDraftDirty?.();
    },
    toggle,
    openEditing,
    closeEditor,
    startPlay,
    exitToEditing,
    restartFromSpawn,
    commitRoomMutation,
    deleteSelection,
    onModeChange: (cb) => {
      modeListeners.add(cb);
      return () => modeListeners.delete(cb);
    },
    getSelection: () => selection,
    setSelection: (sel) => {
      // Reference-equal selections still fire — callers may want to
      // re-render properties after an external mutation. Cheap.
      selection = sel;
      for (const cb of selectionListeners) {
        try {
          cb(sel);
        } catch (e) {
          console.error("[editor] onSelectionChange listener threw:", e);
        }
      }
    },
    onSelectionChange: (cb) => {
      selectionListeners.add(cb);
      return () => selectionListeners.delete(cb);
    },
    destroy,
  };
}
