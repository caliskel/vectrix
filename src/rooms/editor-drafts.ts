/**
 * Editor draft persistence + conflict detection.
 *
 * Drafts live under `dash-proto:editor-drafts:v1` as a single
 * `{ version, drafts: { [roomId]: DraftEntry } }` object so the
 * editor can keep several rooms in flight at once. Each entry holds
 * the live RoomJson, a `savedAt` timestamp, and the sha256 hex of
 * the JSON as it was the last time the user exported (or `null` if
 * they never have). Conflict detection compares the stored
 * `exportedHash` against the hash of whatever code currently holds
 * for that room — hash, not mtime, per Key Decision #9 (mtime lies
 * after `touch`, IDE rewrites, git checkout).
 *
 * Save path is synchronous + tolerant of `QuotaExceededError`. Hash
 * is SHA-256 via `crypto.subtle.digest` and only runs at Export and
 * conflict-check time — never on every mutation.
 *
 * Wired into `editor.ts` through the optional `onDraftDirty` hook on
 * EditorConfig; consumers thread `createDebouncedDraftSaver(...)` so
 * a burst of mutations turns into one localStorage write per quiet
 * 250 ms window.
 *
 * See `docs/plans/2026-05-12-002-feat-level-editor-plan.md` U8 +
 * Key Decisions #9, #10.
 */

import type { RoomJson } from "./room-json-types";

const DRAFTS_STORAGE_KEY = "dash-proto:editor-drafts:v1";
const CURRENT_VERSION = 1;
const DEBOUNCE_MS_DEFAULT = 250;

export type DraftEntry = {
  json: RoomJson;
  savedAt: number;
  exportedHash: string | null;
};

type DraftsStore = {
  version: number;
  drafts: Record<string, DraftEntry>;
};

export type ConflictStatus = "none" | "conflict" | "no-export-yet";

function emptyStore(): DraftsStore {
  return { version: CURRENT_VERSION, drafts: {} };
}

function isDraftEntry(v: unknown): v is DraftEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.json === "object" &&
    e.json !== null &&
    typeof e.savedAt === "number" &&
    (e.exportedHash === null || typeof e.exportedHash === "string")
  );
}

/** Reads, parses, and migrates the localStorage store. Any
 *  parse/shape error falls back to a fresh empty store instead of
 *  throwing — corrupt storage shouldn't take the editor down. */
function loadStore(): DraftsStore {
  try {
    const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return emptyStore();
    const o = parsed as Record<string, unknown>;
    const version = typeof o.version === "number" ? o.version : 0;
    const draftsRaw = (o.drafts ?? {}) as Record<string, unknown>;
    const drafts: Record<string, DraftEntry> = {};
    for (const [id, entry] of Object.entries(draftsRaw)) {
      if (isDraftEntry(entry)) drafts[id] = entry;
    }
    // Migrate inline. v1 → v1 is a no-op; future v2 would patch the
    // shape here before returning. Keeping the framework live from
    // day one matches the CLAUDE.md storage rule.
    return migrate({ version, drafts });
  } catch {
    return emptyStore();
  }
}

function migrate(store: DraftsStore): DraftsStore {
  // Future bumps wedge here; for now any unknown version (0, or one
  // newer than CURRENT_VERSION) is normalised to v1 — the editor
  // never reads version-specific fields.
  if (store.version !== CURRENT_VERSION) {
    return { version: CURRENT_VERSION, drafts: store.drafts };
  }
  return store;
}

function writeStore(store: DraftsStore): void {
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    // QuotaExceededError + private-mode SecurityError. Log so the
    // editor UI can surface a toast; don't throw so a single
    // mutation doesn't tank the run.
    console.warn("[editor-drafts] localStorage write failed:", e);
  }
}

export function loadDraft(roomId: string): DraftEntry | null {
  const store = loadStore();
  return store.drafts[roomId] ?? null;
}

export function listDrafts(): string[] {
  return Object.keys(loadStore().drafts);
}

/** Synchronous save. Preserves the existing `exportedHash` so a
 *  mutation between Exports doesn't lose the "last exported"
 *  fingerprint that conflict detection compares against. */
export function saveDraft(roomId: string, json: RoomJson): void {
  const store = loadStore();
  const existing = store.drafts[roomId];
  store.drafts[roomId] = {
    json,
    savedAt: Date.now(),
    exportedHash: existing?.exportedHash ?? null,
  };
  writeStore(store);
}

export function discardDraft(roomId: string): void {
  const store = loadStore();
  if (!(roomId in store.drafts)) return;
  delete store.drafts[roomId];
  writeStore(store);
}

/** Called from `editor.ts` after a successful POST /__editor/save —
 *  stamps the exportedHash so the next conflict-check has a baseline.
 *  Async because the sha256 path is async. */
export async function markExported(
  roomId: string,
  json: RoomJson,
): Promise<void> {
  const hash = await sha256Hex(stableStringify(json));
  const store = loadStore();
  store.drafts[roomId] = {
    json,
    savedAt: Date.now(),
    exportedHash: hash,
  };
  writeStore(store);
}

/** Async comparison between the editor's last-exported hash and the
 *  hash of whatever the code currently holds for that room (the
 *  consumer fetches the code JSON from the runtime registry or the
 *  filesystem). 'no-export-yet' is the green light — there's nothing
 *  to conflict with. */
export async function checkConflict(
  roomId: string,
  currentCodeJson: RoomJson,
): Promise<ConflictStatus> {
  const entry = loadDraft(roomId);
  if (!entry) return "none";
  if (entry.exportedHash === null) return "no-export-yet";
  const currentHash = await sha256Hex(stableStringify(currentCodeJson));
  return currentHash === entry.exportedHash ? "none" : "conflict";
}

/** SHA-256 of a UTF-8 string, lowercase hex. SubtleCrypto only.
 *  Drafts are <20 KB so latency is negligible. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Stable JSON serialiser for hashing — sorts object keys so two
 *  semantically-identical drafts produce the same hash regardless
 *  of property insertion order. (Plain JSON.stringify produces
 *  different output for `{ a: 1, b: 2 }` vs `{ b: 2, a: 1 }`.) */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/** Creates a per-roomId debounced saver. Calling the returned
 *  function during a burst of edits queues exactly one localStorage
 *  write after `intervalMs` of quiet — matches the U8 spec
 *  (250ms). The returned `flush()` forces an immediate write
 *  (used at editor close / page unload). */
export type DebouncedDraftSaver = {
  schedule(json: RoomJson): void;
  flush(): void;
  cancel(): void;
};

export function createDebouncedDraftSaver(
  roomId: string,
  intervalMs: number = DEBOUNCE_MS_DEFAULT,
): DebouncedDraftSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: RoomJson | null = null;

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      saveDraft(roomId, pending);
      pending = null;
    }
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }

  function schedule(json: RoomJson): void {
    pending = json;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        saveDraft(roomId, pending);
        pending = null;
      }
    }, intervalMs);
  }

  return { schedule, flush, cancel };
}
