// Global keybind profile — shared across sandbox / rooms / tutorial.
// Lives in its own localStorage key (`dash-proto:keybinds:v1`)
// independent of sandbox Settings so rebinding on the landing page
// applies to every mode. Configured via the Controls overlay on
// `index.html`.
//
// Bindings store `KeyboardEvent.code` values (e.g. `"KeyW"`,
// `"ArrowUp"`, `"Space"`, `"ShiftLeft"`) so layout swaps (RU/EN,
// QWERTY/AZERTY) don't break the player's setup — codes describe
// the physical key, not the produced character.
//
// `Escape`, `Tab` and `F1` are RESERVED system keys (settings menu /
// dev menu) and intentionally NOT rebindable.

export type KeybindAction =
  | "moveUp"
  | "moveDown"
  | "moveLeft"
  | "moveRight"
  | "dash"
  | "walk";

export type Keybind = string;

export type KeybindSlot = {
  primary: Keybind;
  /** Optional second key for the same action. Cleared (null) means
   *  no secondary; only the primary triggers the action. */
  secondary: Keybind | null;
};

export type KeybindProfile = Record<KeybindAction, KeybindSlot>;

export const KEYBIND_ACTIONS: KeybindAction[] = [
  "moveUp",
  "moveDown",
  "moveLeft",
  "moveRight",
  "dash",
  "walk",
];

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
  moveUp: "MOVE UP",
  moveDown: "MOVE DOWN",
  moveLeft: "MOVE LEFT",
  moveRight: "MOVE RIGHT",
  dash: "DASH",
  walk: "WALK (SLOW)",
};

export const DEFAULT_KEYBINDS: KeybindProfile = {
  moveUp: { primary: "KeyW", secondary: "ArrowUp" },
  moveDown: { primary: "KeyS", secondary: "ArrowDown" },
  moveLeft: { primary: "KeyA", secondary: "ArrowLeft" },
  moveRight: { primary: "KeyD", secondary: "ArrowRight" },
  dash: { primary: "Space", secondary: "KeyX" },
  walk: { primary: "ShiftLeft", secondary: "ShiftRight" },
};

export const KEYBIND_STORAGE_KEY = "dash-proto:keybinds:v1";

/** Reserved keys — not bindable. Capture mode rejects these so the
 *  player can't override the system shortcuts (settings menu / dev
 *  menu). */
export const RESERVED_CODES: Readonly<Set<string>> = new Set([
  "Escape",
  "Tab",
  "F1",
]);

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.has(code);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isSlot(v: unknown): v is KeybindSlot {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    isString(r.primary) &&
    (r.secondary === null || isString(r.secondary))
  );
}

export function loadKeybinds(): KeybindProfile {
  const base: KeybindProfile = JSON.parse(JSON.stringify(DEFAULT_KEYBINDS));
  try {
    const raw = localStorage.getItem(KEYBIND_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return base;
    const p = parsed as Record<string, unknown>;
    for (const action of KEYBIND_ACTIONS) {
      const slot = p[action];
      if (isSlot(slot)) {
        base[action] = {
          primary: slot.primary,
          secondary: slot.secondary,
        };
      }
    }
  } catch {
    // fall back to defaults on parse / quota errors
  }
  return base;
}

export function saveKeybinds(profile: KeybindProfile): void {
  try {
    localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // swallow quota / privacy-mode errors — keybinds persist in
    // memory but not across reloads in that case
  }
}

/** True if either the primary or (when set) secondary code for this
 *  action is in the pressed-codes set. The Set is populated from
 *  `keydown` / `keyup` listeners with raw `e.code` values. */
export function isActionPressed(
  action: KeybindAction,
  pressedCodes: Set<string>,
  profile: KeybindProfile,
): boolean {
  const slot = profile[action];
  if (pressedCodes.has(slot.primary)) return true;
  if (slot.secondary !== null && pressedCodes.has(slot.secondary)) return true;
  return false;
}

/** True if `code` is bound to ANY action in this profile (either
 *  slot). Used by game keydown handlers to call `e.preventDefault()`
 *  on bound keys so the browser doesn't scroll on Space / arrow
 *  keys, etc. */
export function isAnyBoundCode(
  code: string,
  profile: KeybindProfile,
): boolean {
  for (const action of KEYBIND_ACTIONS) {
    const slot = profile[action];
    if (slot.primary === code) return true;
    if (slot.secondary === code) return true;
  }
  return false;
}

/** Remove BOTH binding codes for an action from the pressed-set.
 *  Used to "consume" the dash key after firing so the player has
 *  to re-press to dash again (instead of dashing every frame the
 *  key is held). Handles dual bindings — both primary and
 *  secondary clear so a still-held secondary doesn't re-trigger. */
export function consumeAction(
  action: KeybindAction,
  pressedCodes: Set<string>,
  profile: KeybindProfile,
): void {
  const slot = profile[action];
  pressedCodes.delete(slot.primary);
  if (slot.secondary !== null) pressedCodes.delete(slot.secondary);
}

const ARROW_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const SIDED_LABELS: Record<string, string> = {
  ShiftLeft: "L SHIFT",
  ShiftRight: "R SHIFT",
  ControlLeft: "L CTRL",
  ControlRight: "R CTRL",
  AltLeft: "L ALT",
  AltRight: "R ALT",
  MetaLeft: "L META",
  MetaRight: "R META",
};

const NAMED_LABELS: Record<string, string> = {
  Space: "SPACE",
  Enter: "ENTER",
  Tab: "TAB",
  Escape: "ESC",
  Backspace: "BACKSPACE",
  CapsLock: "CAPS",
  ContextMenu: "MENU",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/** Human-readable label for a KeyboardEvent.code. Used both by the
 *  Controls overlay (keycap text) and the tutorial hint banners
 *  (so `[W][A][S][D]` updates when the player rebinds). */
export function formatKeybindLabel(code: Keybind | null): string {
  if (code === null) return "—";
  if (ARROW_LABELS[code]) return ARROW_LABELS[code];
  if (SIDED_LABELS[code]) return SIDED_LABELS[code];
  if (NAMED_LABELS[code]) return NAMED_LABELS[code];
  // KeyA..KeyZ → A..Z
  if (code.length === 4 && code.startsWith("Key")) {
    return code.slice(3);
  }
  // Digit0..Digit9 → 0..9
  if (code.startsWith("Digit") && code.length === 6) {
    return code.slice(5);
  }
  // Numpad keys keep an "NUM" prefix for clarity.
  if (code.startsWith("Numpad")) {
    const tail = code.slice(6);
    return `NUM ${tail}`;
  }
  // Function keys F1..F12 render as-is.
  return code;
}

/** One-shot migration from the legacy sandbox `Settings.bindings`
 *  shape (single string per action) into the new profile (primary
 *  + secondary). Used by `loadSettings` during the v4 → v5 bump so
 *  existing players don't lose their rebinds. */
export function profileFromLegacyBindings(legacy: {
  up?: string;
  down?: string;
  left?: string;
  right?: string;
  walk?: string;
  dash?: string;
}): KeybindProfile {
  const out: KeybindProfile = JSON.parse(JSON.stringify(DEFAULT_KEYBINDS));
  function migrate(action: KeybindAction, legacyValue: string | undefined) {
    if (!legacyValue) return;
    out[action].primary = legacyValue;
    if (out[action].secondary === legacyValue) {
      // Old binding happened to match our default secondary — drop
      // the duplicate so the slot reads `—` instead of showing the
      // same key twice.
      out[action].secondary = null;
    }
  }
  migrate("moveUp", legacy.up);
  migrate("moveDown", legacy.down);
  migrate("moveLeft", legacy.left);
  migrate("moveRight", legacy.right);
  migrate("walk", legacy.walk);
  migrate("dash", legacy.dash);
  return out;
}
