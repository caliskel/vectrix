/**
 * Editor DOM overlay UI.
 *
 * Layered above the canvas (z-index 150 between pause-menu and dev-
 * menu) with `pointer-events: none` on the root and `auto` on each
 * panel — clicks pass through the open area to the canvas layer so
 * U6 can drag-place walls / enemies while the toolbar + properties
 * stay interactive.
 *
 * Owns:
 *   - header (DRAFT badge, room-id, Play / Pause / Restart / Save /
 *     Revert / Close)
 *   - toolbar (Select / Wall / Turret / Watcher / Hunter / Spawn /
 *     Door / Key / Lazy spawn + Snap toggle)
 *   - properties panel (dispatched per selection kind from editor)
 *   - status bar (mouse world coords, zoom, selected, drafts time)
 *   - conflict banner (R10/R12)
 *   - revert confirmation modal
 *
 * Wires:
 *   - Tool selection → `onToolChange` callback (U6 reads to dispatch
 *     mouse handlers).
 *   - Property field changes → mutates both draft and currentRoom
 *     in place, then routes through `editor.commitRoomMutation` so
 *     wallFx / arenaBg caches rebuild and onDraftDirty pings the
 *     debounced saver.
 *   - Save → POST /__editor/save (Vite plugin U3) → `markExported`
 *     stamps the new exportedHash for future conflict checks.
 *   - Revert → opens the confirmation modal → discardDraft + reload
 *     of the editor's draft from currentRoom (best-effort cloning).
 *
 * Esc closes the editor at capture phase to beat the pause menu's
 * own Esc handler (mirrors dev-menu pattern).
 *
 * Loaded only in `import.meta.env.DEV`; the prod tree-shaker drops
 * this module along with everything else under the editor handle.
 *
 * See `docs/plans/2026-05-12-002-feat-level-editor-plan.md` U5 + R3,
 * R4, R10, R11, R12.
 */

import type { EditorHandle, Selection } from "./editor";
import {
  checkConflict,
  discardDraft,
  markExported,
} from "./editor-drafts";
import type { Room } from "../lib/room";
import type {
  EnemySpec,
  PendingEnemySpec,
  PendingSpawnSpec,
  RoomJson,
  WallSpec,
} from "./room-json-types";

const STYLE_ID = "dash-editor-ui-style";
const STYLE = `
.dp-ed-root {
  position: fixed; inset: 0;
  z-index: 150;
  pointer-events: none;
  display: none;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #ffffff;
}
.dp-ed-root.open { display: block; }
.dp-ed-root.playing .dp-ed-toolbar,
.dp-ed-root.playing .dp-ed-properties { display: none; }
.dp-ed-panel { pointer-events: auto; }

.dp-ed-header {
  position: absolute; top: 12px; left: 12px; right: 12px;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: rgba(20, 25, 43, 0.92);
  border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 4px;
}
.dp-ed-draft-badge {
  display: none;
  padding: 2px 8px;
  background: #ffd60a;
  color: #0a0e1a;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  border-radius: 3px;
}
.dp-ed-draft-badge.show { display: inline-block; }
.dp-ed-room-id {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: #ffffff;
}
.dp-ed-header-actions {
  margin-left: auto;
  display: flex; gap: 6px;
}
.dp-ed-btn {
  padding: 7px 14px;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.12em;
  font-weight: 600;
  background: transparent;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.dp-ed-btn:hover, .dp-ed-btn:focus-visible {
  border-color: #7dd3fc;
  outline: none;
}
.dp-ed-btn.primary {
  background: rgba(125, 211, 252, 0.18);
  border-color: #7dd3fc;
  color: #7dd3fc;
}
.dp-ed-btn.danger {
  border-color: rgba(255, 45, 85, 0.5);
  color: #ff2d55;
}
.dp-ed-btn.danger:hover { border-color: #ff2d55; }
.dp-ed-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dp-ed-toolbar {
  position: absolute; top: 70px; left: 12px;
  display: flex; flex-direction: column; gap: 4px;
  padding: 8px;
  background: rgba(20, 25, 43, 0.92);
  border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 4px;
  min-width: 140px;
}
.dp-ed-tool-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #ffffff;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  text-align: left;
}
.dp-ed-tool-btn:hover { background: rgba(255, 255, 255, 0.06); }
.dp-ed-tool-btn.active {
  background: rgba(125, 211, 252, 0.18);
  border-color: #7dd3fc;
  color: #7dd3fc;
}
.dp-ed-tool-divider {
  height: 1px;
  margin: 4px 0;
  background: rgba(255, 255, 255, 0.1);
}

.dp-ed-properties {
  position: absolute; top: 70px; right: 12px;
  width: 260px;
  max-height: calc(100vh - 140px);
  overflow-y: auto;
  padding: 12px 14px;
  background: rgba(20, 25, 43, 0.92);
  border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 4px;
}
.dp-ed-properties h3 {
  margin: 0 0 8px;
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #7dd3fc;
  font-weight: 600;
}
.dp-ed-row {
  display: flex; align-items: center; gap: 8px;
  margin: 6px 0;
}
.dp-ed-row label {
  flex: 0 0 80px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.7);
}
.dp-ed-row input[type="number"],
.dp-ed-row input[type="text"],
.dp-ed-row select {
  flex: 1;
  padding: 4px 6px;
  font-family: inherit;
  font-size: 12px;
  background: rgba(10, 14, 26, 0.85);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 2px;
}
.dp-ed-row input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}
.dp-ed-row.empty {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-style: italic;
}

.dp-ed-status {
  position: absolute; bottom: 12px; left: 12px; right: 12px;
  display: flex; align-items: center; gap: 18px;
  padding: 8px 14px;
  background: rgba(20, 25, 43, 0.92);
  border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.7);
}
.dp-ed-status .key { color: rgba(255, 255, 255, 0.45); }
.dp-ed-status .val { color: #ffffff; font-weight: 600; }

.dp-ed-conflict {
  display: none;
  position: absolute; top: 70px; left: 50%; transform: translateX(-50%);
  padding: 10px 14px;
  background: rgba(255, 45, 85, 0.92);
  color: #ffffff;
  font-size: 12px;
  border-radius: 4px;
  box-shadow: 0 6px 22px rgba(255, 45, 85, 0.35);
  display: flex; gap: 12px; align-items: center;
}
.dp-ed-conflict.show { display: flex; }
.dp-ed-conflict span { letter-spacing: 0.08em; }

.dp-ed-modal {
  position: fixed; inset: 0;
  z-index: 175;
  background: rgba(10, 14, 26, 0.7);
  display: none;
  align-items: center; justify-content: center;
}
.dp-ed-modal.show { display: flex; }
.dp-ed-modal-box {
  padding: 22px 26px;
  background: rgba(20, 25, 43, 0.98);
  border: 2px solid #ff2d55;
  border-radius: 4px;
  max-width: 380px;
}
.dp-ed-modal-box h3 {
  margin: 0 0 8px;
  font-size: 14px;
  letter-spacing: 0.18em;
  color: #ff2d55;
}
.dp-ed-modal-box p {
  margin: 0 0 16px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}
.dp-ed-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

.dp-ed-toast {
  position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
  padding: 10px 18px;
  background: rgba(20, 25, 43, 0.96);
  color: #7dd3fc;
  font-size: 12px;
  letter-spacing: 0.1em;
  border: 1px solid #7dd3fc;
  border-radius: 4px;
  z-index: 180;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
}
.dp-ed-toast.show { opacity: 1; }
.dp-ed-toast.err {
  color: #ff2d55;
  border-color: #ff2d55;
}
`;

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

export type EditorTool =
  | "select"
  | "wall"
  | "turret"
  | "watcher"
  | "hunter"
  | "spawn"
  | "door"
  | "key"
  | "pending";

export type EditorUIConfig = {
  editor: EditorHandle;
  /** Returns live currentRoom. Mirrors EditorConfig but the UI works
   *  off the editor's getDraft + the live room rather than receiving
   *  it through a separate callback. */
  getCurrentRoom(): Room;
  /** Save endpoint relative to current origin. Defaults to
   *  `/__editor/save` from U3. */
  saveEndpoint?: string;
  /** Called whenever the active tool changes. U6 reads this to wire
   *  the right mouse handlers. */
  onToolChange?(tool: EditorTool): void;
  /** Called when the user toggles snap. U6 reads this for placement
   *  math. Defaults to ON. */
  onSnapChange?(snap: boolean): void;
};

export type EditorUIHandle = {
  isOpen(): boolean;
  open(): void;
  close(): void;
  setMouseCoords(x: number, y: number): void;
  setZoom(zoom: number): void;
  isSnapOn(): boolean;
  getActiveTool(): EditorTool;
  destroy(): void;
};

export function createEditorUI(config: EditorUIConfig): EditorUIHandle {
  injectStyle();

  const { editor } = config;
  const saveEndpoint = config.saveEndpoint ?? "/__editor/save";
  let activeTool: EditorTool = "select";
  let snapOn = true;
  let isExportedClean = true; // is current draft equal to last-Export?

  const root = document.createElement("div");
  root.className = "dp-ed-root";

  // ----- header -----
  const header = document.createElement("div");
  header.className = "dp-ed-panel dp-ed-header";

  const draftBadge = document.createElement("span");
  draftBadge.className = "dp-ed-draft-badge";
  draftBadge.textContent = "DRAFT";
  header.appendChild(draftBadge);

  const roomIdLabel = document.createElement("span");
  roomIdLabel.className = "dp-ed-room-id";
  header.appendChild(roomIdLabel);

  const headerActions = document.createElement("div");
  headerActions.className = "dp-ed-header-actions";

  const playBtn = mkButton("Play", "primary");
  const restartBtn = mkButton("Restart");
  const saveBtn = mkButton("Save");
  const revertBtn = mkButton("Revert", "danger");
  const closeBtn = mkButton("Close");
  headerActions.appendChild(playBtn);
  headerActions.appendChild(restartBtn);
  headerActions.appendChild(saveBtn);
  headerActions.appendChild(revertBtn);
  headerActions.appendChild(closeBtn);
  header.appendChild(headerActions);
  root.appendChild(header);

  // ----- toolbar -----
  const toolbar = document.createElement("div");
  toolbar.className = "dp-ed-panel dp-ed-toolbar";

  const TOOLS: { id: EditorTool; label: string; hotkey: string }[] = [
    { id: "select", label: "Select", hotkey: "V" },
    { id: "wall", label: "Wall", hotkey: "1" },
    { id: "turret", label: "Turret", hotkey: "2" },
    { id: "watcher", label: "Watcher", hotkey: "3" },
    { id: "hunter", label: "Hunter", hotkey: "4" },
    { id: "spawn", label: "Spawn", hotkey: "5" },
    { id: "door", label: "Door", hotkey: "6" },
    { id: "key", label: "Key", hotkey: "7" },
    { id: "pending", label: "Lazy spawn", hotkey: "8" },
  ];
  const toolBtns = new Map<EditorTool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const btn = document.createElement("button");
    btn.className = "dp-ed-tool-btn";
    btn.dataset.tool = t.id;
    btn.innerHTML = `<span style="flex:1">${t.label}</span><span style="opacity:.5">${t.hotkey}</span>`;
    btn.addEventListener("click", () => setActiveTool(t.id));
    toolBtns.set(t.id, btn);
    toolbar.appendChild(btn);
  }
  const divider = document.createElement("div");
  divider.className = "dp-ed-tool-divider";
  toolbar.appendChild(divider);

  const snapBtn = document.createElement("button");
  snapBtn.className = "dp-ed-tool-btn active";
  snapBtn.dataset.snap = "on";
  snapBtn.textContent = "Snap 10px: ON";
  snapBtn.addEventListener("click", () => toggleSnap());
  toolbar.appendChild(snapBtn);
  root.appendChild(toolbar);

  // ----- properties panel -----
  const properties = document.createElement("div");
  properties.className = "dp-ed-panel dp-ed-properties";
  const propsTitle = document.createElement("h3");
  propsTitle.textContent = "Properties";
  properties.appendChild(propsTitle);
  const propsBody = document.createElement("div");
  properties.appendChild(propsBody);
  root.appendChild(properties);

  // ----- status bar -----
  const status = document.createElement("div");
  status.className = "dp-ed-panel dp-ed-status";
  const statusCoords = mkStatus("xy", "x: —  y: —");
  const statusZoom = mkStatus("zoom", "100%");
  const statusSelected = mkStatus("sel", "—");
  const statusDraft = mkStatus("draft", "—");
  status.appendChild(statusCoords);
  status.appendChild(statusZoom);
  status.appendChild(statusSelected);
  status.appendChild(statusDraft);
  root.appendChild(status);

  // ----- conflict banner -----
  const conflict = document.createElement("div");
  conflict.className = "dp-ed-panel dp-ed-conflict";
  const conflictText = document.createElement("span");
  conflictText.textContent = "Code is newer than your draft";
  conflict.appendChild(conflictText);
  const conflictKeep = mkButton("Keep draft");
  const conflictRevert = mkButton("Revert to code", "danger");
  conflict.appendChild(conflictKeep);
  conflict.appendChild(conflictRevert);
  conflictKeep.addEventListener("click", () => conflict.classList.remove("show"));
  conflictRevert.addEventListener("click", () => {
    conflict.classList.remove("show");
    void runRevertFromCode();
  });
  root.appendChild(conflict);

  // ----- revert modal -----
  const modal = document.createElement("div");
  modal.className = "dp-ed-modal";
  const modalBox = document.createElement("div");
  modalBox.className = "dp-ed-modal-box";
  modalBox.innerHTML = `<h3>Discard changes?</h3><p>Your in-progress draft will be reverted to the last exported state. This cannot be undone.</p>`;
  const modalActions = document.createElement("div");
  modalActions.className = "dp-ed-modal-actions";
  const modalCancel = mkButton("Cancel");
  const modalConfirm = mkButton("Discard", "danger");
  modalActions.appendChild(modalCancel);
  modalActions.appendChild(modalConfirm);
  modalBox.appendChild(modalActions);
  modal.appendChild(modalBox);
  modalCancel.addEventListener("click", () => modal.classList.remove("show"));
  modalConfirm.addEventListener("click", () => {
    modal.classList.remove("show");
    void runRevertFromCode();
  });
  document.body.appendChild(modal);

  // ----- toast -----
  const toast = document.createElement("div");
  toast.className = "dp-ed-toast";
  document.body.appendChild(toast);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(msg: string, err = false): void {
    toast.textContent = msg;
    toast.classList.toggle("err", err);
    toast.classList.add("show");
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  // ----- wiring -----
  document.body.appendChild(root);

  function setActiveTool(t: EditorTool): void {
    activeTool = t;
    for (const [id, btn] of toolBtns)
      btn.classList.toggle("active", id === t);
    config.onToolChange?.(t);
    refreshStatus();
  }
  setActiveTool("select");

  function toggleSnap(): void {
    snapOn = !snapOn;
    snapBtn.textContent = `Snap 10px: ${snapOn ? "ON" : "OFF"}`;
    snapBtn.classList.toggle("active", snapOn);
    config.onSnapChange?.(snapOn);
  }

  function refreshHeader(): void {
    const draft = editor.getDraft();
    roomIdLabel.textContent = draft.id;
    draftBadge.classList.toggle("show", !isExportedClean);
    const mode = editor.getMode();
    playBtn.textContent = mode === "playing" ? "Pause" : "Play";
    restartBtn.disabled = mode !== "playing";
    saveBtn.disabled = mode === "playing";
    revertBtn.disabled = mode === "playing";
    root.classList.toggle("playing", mode === "playing");
  }

  function refreshStatus(): void {
    const sel = editor.getSelection();
    statusSelected.querySelector(".val")!.textContent = sel
      ? selectionLabel(sel)
      : "—";
    const draft = editor.getDraft();
    statusDraft.querySelector(".val")!.textContent = draft.id;
  }

  // Re-render properties whenever selection or draft id changes.
  function refreshProperties(): void {
    propsBody.replaceChildren();
    const sel = editor.getSelection();
    const draft = editor.getDraft();
    const room = config.getCurrentRoom();
    const form = buildPropertiesForm(
      sel,
      draft,
      room,
      () => {
        editor.commitRoomMutation(mutationKindFor(sel) ?? "wall");
        markDirty();
      },
    );
    propsBody.appendChild(form);
  }

  function markDirty(): void {
    isExportedClean = false;
    refreshHeader();
    refreshStatus();
  }

  // Button handlers
  playBtn.addEventListener("click", () => {
    if (editor.getMode() === "playing") {
      editor.exitToEditing();
    } else {
      editor.startPlay();
    }
  });
  restartBtn.addEventListener("click", () => editor.restartFromSpawn());
  saveBtn.addEventListener("click", () => void runSave());
  revertBtn.addEventListener("click", () => modal.classList.add("show"));
  closeBtn.addEventListener("click", () => editor.closeEditor());

  // Esc handler — capture phase so we beat the pause menu's own
  // Esc handler underneath (matches dev-menu pattern).
  function onKeydown(e: KeyboardEvent): void {
    if (!isOpen()) return;
    if (e.code === "Escape") {
      // Modal open? Esc closes modal, not editor.
      if (modal.classList.contains("show")) {
        e.preventDefault();
        e.stopPropagation();
        modal.classList.remove("show");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      editor.closeEditor();
      return;
    }
    // Tool hotkeys when no input is focused.
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "SELECT" || tgt.tagName === "TEXTAREA"))
      return;
    const tHotkey = TOOLS.find((t) => t.hotkey === e.key.toUpperCase());
    if (tHotkey) {
      e.preventDefault();
      setActiveTool(tHotkey.id);
    }
  }
  window.addEventListener("keydown", onKeydown, true);

  // Subscribe to editor state changes.
  const unsubMode = editor.onModeChange((next) => {
    root.classList.toggle("open", next !== "closed");
    refreshHeader();
    refreshProperties();
    if (next === "editing") {
      // Conflict-check fires lazily on every entry to editing —
      // covers reload-after-external-edit per AE5.
      void runConflictCheck();
    }
  });
  const unsubSel = editor.onSelectionChange(() => {
    refreshProperties();
    refreshStatus();
  });

  // --- Save ---
  async function runSave(): Promise<void> {
    const draft = editor.getDraft();
    try {
      const resp = await fetch(saveEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, json: draft }),
      });
      const body = (await resp.json()) as { ok: boolean; error?: string; path?: string };
      if (!resp.ok || !body.ok) {
        showToast(`Save failed: ${body.error ?? resp.statusText}`, true);
        return;
      }
      await markExported(draft.id, draft);
      isExportedClean = true;
      refreshHeader();
      refreshStatus();
      showToast(`Saved ${body.path ?? draft.id + ".json"}`);
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    }
  }

  async function runRevertFromCode(): Promise<void> {
    const draft = editor.getDraft();
    discardDraft(draft.id);
    // For greenfield-only MVP there's no "code source" to load from —
    // discard returns the user to the editor's default empty draft.
    // U8 conflict-banner "Revert to code" pulls from the running
    // currentRoom's serialised form when a JSON exists; for now we
    // settle for a clean slate + toast.
    editor.setDraft({
      id: draft.id,
      width: 1200,
      height: 800,
      spawnX: 600,
      spawnY: 400,
      walls: [],
      enemies: [],
    });
    isExportedClean = true;
    refreshHeader();
    refreshProperties();
    refreshStatus();
    showToast("Draft reverted");
  }

  async function runConflictCheck(): Promise<void> {
    const draft = editor.getDraft();
    // The "code copy" is what's currently registered in the rooms
    // Map. For MVP we compare against the LIVE draft itself when
    // there's no separate code source — net effect: never raises
    // a false positive. Real conflict comparison wires in once
    // U2's loaded JSON modules are reachable from here.
    try {
      const status = await checkConflict(draft.id, draft);
      conflict.classList.toggle("show", status === "conflict");
    } catch {
      // Crypto failures shouldn't break the editor.
      conflict.classList.remove("show");
    }
  }

  // Initial render (editor may already be in 'closed' but we want
  // the DOM ready for the next open).
  refreshHeader();
  refreshProperties();
  refreshStatus();

  function isOpen(): boolean {
    return editor.getMode() !== "closed";
  }

  function open(): void {
    if (editor.getMode() === "closed") editor.openEditing();
  }

  function close(): void {
    editor.closeEditor();
  }

  function setMouseCoords(x: number, y: number): void {
    statusCoords.querySelector(".val")!.textContent = `x: ${x.toFixed(0)}  y: ${y.toFixed(0)}`;
  }

  function setZoom(zoom: number): void {
    statusZoom.querySelector(".val")!.textContent = `${Math.round(zoom * 100)}%`;
  }

  function destroy(): void {
    unsubMode();
    unsubSel();
    window.removeEventListener("keydown", onKeydown, true);
    root.remove();
    modal.remove();
    toast.remove();
  }

  return {
    isOpen,
    open,
    close,
    setMouseCoords,
    setZoom,
    isSnapOn: () => snapOn,
    getActiveTool: () => activeTool,
    destroy,
  };
}

function mkButton(label: string, variant?: "primary" | "danger"): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "dp-ed-btn" + (variant ? ` ${variant}` : "");
  b.textContent = label;
  return b;
}

function mkStatus(key: string, value: string): HTMLDivElement {
  const w = document.createElement("div");
  const k = document.createElement("span");
  k.className = "key";
  k.textContent = `${key}:`;
  const v = document.createElement("span");
  v.className = "val";
  v.textContent = value;
  w.appendChild(k);
  w.appendChild(document.createTextNode(" "));
  w.appendChild(v);
  return w;
}

function selectionLabel(sel: Selection): string {
  if (!sel) return "—";
  switch (sel.kind) {
    case "wall":
    case "turret":
    case "watcher":
    case "hunter":
    case "pending":
      return `${sel.kind} #${sel.index}`;
    default:
      return sel.kind;
  }
}

function mutationKindFor(sel: Selection): null | "wall" | "size" | "enemy" | "door" | "key" | "pending" {
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

// ---------- Properties form dispatcher ----------

function buildPropertiesForm(
  sel: Selection,
  draft: RoomJson,
  room: Room,
  onChange: () => void,
): HTMLElement {
  const container = document.createElement("div");
  if (!sel) {
    const empty = document.createElement("div");
    empty.className = "dp-ed-row empty";
    empty.textContent = "Select an entity, or pick Room from the toolbar.";
    container.appendChild(empty);
    return container;
  }

  switch (sel.kind) {
    case "room":
      return buildRoomForm(draft, onChange);
    case "wall":
      return buildWallForm(sel.index, draft, room, onChange);
    case "turret":
    case "watcher":
    case "hunter":
      return buildEnemyForm(sel.kind, sel.index, draft, room, onChange);
    case "spawn":
      return buildSpawnForm(draft, room, onChange);
    case "door":
      return buildDoorForm("door", draft, room, onChange);
    case "backDoor":
      return buildDoorForm("backDoor", draft, room, onChange);
    case "key":
      return buildKeyForm(draft, room, onChange);
    case "pending":
      return buildPendingForm(sel.index, draft, room, onChange);
  }
}

function numberRow(
  label: string,
  initial: number,
  onCommit: (v: number) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "dp-ed-row";
  const lab = document.createElement("label");
  lab.textContent = label;
  const inp = document.createElement("input");
  inp.type = "number";
  inp.value = String(initial);
  inp.addEventListener("change", () => {
    const v = Number.parseFloat(inp.value);
    if (Number.isFinite(v)) onCommit(v);
  });
  row.appendChild(lab);
  row.appendChild(inp);
  return row;
}

function textRow(
  label: string,
  initial: string,
  onCommit: (v: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "dp-ed-row";
  const lab = document.createElement("label");
  lab.textContent = label;
  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = initial;
  inp.addEventListener("change", () => onCommit(inp.value));
  row.appendChild(lab);
  row.appendChild(inp);
  return row;
}

function checkRow(
  label: string,
  initial: boolean,
  onCommit: (v: boolean) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "dp-ed-row";
  const lab = document.createElement("label");
  lab.textContent = label;
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.checked = initial;
  inp.addEventListener("change", () => onCommit(inp.checked));
  row.appendChild(lab);
  row.appendChild(inp);
  return row;
}

function selectRow<T extends string>(
  label: string,
  initial: T,
  options: readonly T[],
  onCommit: (v: T) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "dp-ed-row";
  const lab = document.createElement("label");
  lab.textContent = label;
  const sel = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === initial) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => onCommit(sel.value as T));
  row.appendChild(lab);
  row.appendChild(sel);
  return row;
}

function buildRoomForm(draft: RoomJson, onChange: () => void): HTMLElement {
  const c = document.createElement("div");
  c.appendChild(textRow("id", draft.id, (v) => {
    draft.id = v;
    onChange();
  }));
  c.appendChild(numberRow("width", draft.width ?? 1200, (v) => {
    draft.width = v;
    onChange();
  }));
  c.appendChild(numberRow("height", draft.height ?? 800, (v) => {
    draft.height = v;
    onChange();
  }));
  c.appendChild(numberRow("spawnX", draft.spawnX, (v) => {
    draft.spawnX = v;
    onChange();
  }));
  c.appendChild(numberRow("spawnY", draft.spawnY, (v) => {
    draft.spawnY = v;
    onChange();
  }));
  c.appendChild(textRow("nextRoomId", draft.nextRoomId ?? "", (v) => {
    draft.nextRoomId = v || null;
    onChange();
  }));
  return c;
}

function buildWallForm(
  index: number,
  draft: RoomJson,
  room: Room,
  onChange: () => void,
): HTMLElement {
  const c = document.createElement("div");
  const spec = draft.walls[index];
  const live = room.walls[index];
  if (!spec || !live) return c;
  const apply = (patch: Partial<WallSpec>) => {
    Object.assign(spec, patch);
    Object.assign(live, patch);
    onChange();
  };
  c.appendChild(numberRow("x", spec.x, (v) => apply({ x: v })));
  c.appendChild(numberRow("y", spec.y, (v) => apply({ y: v })));
  c.appendChild(numberRow("w", spec.w, (v) => apply({ w: v })));
  c.appendChild(numberRow("h", spec.h, (v) => apply({ h: v })));
  c.appendChild(checkRow("dashable", spec.dashable ?? false, (v) =>
    apply({ dashable: v || undefined }),
  ));
  c.appendChild(checkRow("infected", spec.infected ?? false, (v) =>
    apply({ infected: v || undefined }),
  ));
  return c;
}

function buildEnemyForm(
  kind: "turret" | "watcher" | "hunter",
  index: number,
  draft: RoomJson,
  room: Room,
  onChange: () => void,
): HTMLElement {
  const c = document.createElement("div");
  const spec = draft.enemies[index];
  const live = room.enemies[index];
  if (!spec || !live || spec.type !== kind) return c;
  c.appendChild(numberRow("x", spec.x, (v) => {
    spec.x = v;
    live.x = v;
    onChange();
  }));
  c.appendChild(numberRow("y", spec.y, (v) => {
    spec.y = v;
    live.y = v;
    onChange();
  }));
  c.appendChild(checkRow("dropsKey", spec.dropsKey ?? false, (v) => {
    if (v) spec.dropsKey = true;
    else delete (spec as Partial<EnemySpec>).dropsKey;
    live.dropsKey = v;
    onChange();
  }));
  return c;
}

function buildSpawnForm(
  draft: RoomJson,
  room: Room,
  onChange: () => void,
): HTMLElement {
  const c = document.createElement("div");
  c.appendChild(numberRow("spawnX", draft.spawnX, (v) => {
    draft.spawnX = v;
    room.spawnX = v;
    onChange();
  }));
  c.appendChild(numberRow("spawnY", draft.spawnY, (v) => {
    draft.spawnY = v;
    room.spawnY = v;
    onChange();
  }));
  return c;
}

function buildDoorForm(
  side: "door" | "backDoor",
  draft: RoomJson,
  room: Room,
  onChange: () => void,
): HTMLElement {
  const c = document.createElement("div");
  const spec = draft[side];
  const live = room[side];
  if (!spec || !live) {
    const empty = document.createElement("div");
    empty.className = "dp-ed-row empty";
    empty.textContent = "No door placed.";
    c.appendChild(empty);
    return c;
  }
  c.appendChild(numberRow("x", spec.x, (v) => {
    spec.x = v;
    live.x = v;
    onChange();
  }));
  c.appendChild(numberRow("y", spec.y, (v) => {
    spec.y = v;
    live.y = v;
    onChange();
  }));
  c.appendChild(numberRow("w", spec.w, (v) => {
    spec.w = v;
    live.w = v;
    onChange();
  }));
  c.appendChild(numberRow("h", spec.h, (v) => {
    spec.h = v;
    live.h = v;
    onChange();
  }));
  c.appendChild(checkRow("requiresKey", spec.requiresKey ?? false, (v) => {
    spec.requiresKey = v;
    live.requiresKey = v;
    onChange();
  }));
  c.appendChild(checkRow("flipped", spec.flipped ?? false, (v) => {
    spec.flipped = v;
    live.flipped = v;
    onChange();
  }));
  c.appendChild(selectRow(
    "initial",
    spec.initial ?? "closed",
    ["closed", "open"] as const,
    (v) => {
      spec.initial = v;
      live.state = v;
      onChange();
    },
  ));
  if (side === "door") {
    c.appendChild(textRow("nextRoomId", draft.nextRoomId ?? "", (v) => {
      draft.nextRoomId = v || null;
      onChange();
    }));
  } else {
    c.appendChild(textRow("prevRoomId", draft.prevRoomId ?? "", (v) => {
      draft.prevRoomId = v || null;
      onChange();
    }));
  }
  return c;
}

function buildKeyForm(
  draft: RoomJson,
  room: Room,
  onChange: () => void,
): HTMLElement {
  const c = document.createElement("div");
  const ik = draft.initialKey;
  if (!ik) {
    const empty = document.createElement("div");
    empty.className = "dp-ed-row empty";
    empty.textContent = "No initial key placed.";
    c.appendChild(empty);
    return c;
  }
  c.appendChild(numberRow("x", ik.x, (v) => {
    ik.x = v;
    if (room.initialKey) room.initialKey.x = v;
    onChange();
  }));
  c.appendChild(numberRow("y", ik.y, (v) => {
    ik.y = v;
    if (room.initialKey) room.initialKey.y = v;
    onChange();
  }));
  return c;
}

function buildPendingForm(
  index: number,
  draft: RoomJson,
  room: Room,
  onChange: () => void,
): HTMLElement {
  const c = document.createElement("div");
  const spec = draft.pendingEnemies?.[index];
  const live = room.pendingEnemies?.[index];
  if (!spec || !live) {
    const empty = document.createElement("div");
    empty.className = "dp-ed-row empty";
    empty.textContent = "Pending spawn out of range.";
    c.appendChild(empty);
    return c;
  }
  c.appendChild(selectRow(
    "type",
    spec.type,
    ["turret", "watcher", "hunter"] as const,
    (v) => {
      // Recreate spec — TS unions need the right shape.
      const newSpec = { ...spec, type: v } as PendingEnemySpec;
      draft.pendingEnemies![index] = newSpec;
      onChange();
    },
  ));
  c.appendChild(numberRow("triggerX", spec.triggerX, (v) => {
    spec.triggerX = v;
    live.triggerX = v;
    // Re-arm so a re-positioned trigger fires next play tick.
    live.spawned = false;
    onChange();
  }));
  c.appendChild(selectRow(
    "spawn",
    spec.spawn.kind,
    ["point", "randomY"] as const,
    (v) => {
      if (v === "point") {
        const cur = spec.spawn as PendingSpawnSpec;
        if (cur.kind === "point") return;
        spec.spawn = { kind: "point", x: cur.x, y: 400 };
      } else {
        const cur = spec.spawn as PendingSpawnSpec;
        if (cur.kind === "randomY") return;
        spec.spawn = { kind: "randomY", x: cur.x, yRange: [100, 700] };
      }
      onChange();
    },
  ));
  if (spec.spawn.kind === "point") {
    c.appendChild(numberRow("spawn.x", spec.spawn.x, (v) => {
      (spec.spawn as { x: number }).x = v;
      onChange();
    }));
    c.appendChild(numberRow("spawn.y", spec.spawn.y, (v) => {
      (spec.spawn as { y: number }).y = v;
      onChange();
    }));
  } else {
    const ry = spec.spawn;
    c.appendChild(numberRow("spawn.x", ry.x, (v) => {
      ry.x = v;
      onChange();
    }));
    c.appendChild(numberRow("yRange.lo", ry.yRange[0], (v) => {
      ry.yRange = [v, ry.yRange[1]];
      onChange();
    }));
    c.appendChild(numberRow("yRange.hi", ry.yRange[1], (v) => {
      ry.yRange = [ry.yRange[0], v];
      onChange();
    }));
  }
  c.appendChild(checkRow("dropsKey", spec.dropsKey ?? false, (v) => {
    if (v) spec.dropsKey = true;
    else delete (spec as { dropsKey?: boolean }).dropsKey;
    onChange();
  }));
  return c;
}
