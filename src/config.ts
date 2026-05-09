export type Bindings = {
  up: string;
  down: string;
  left: string;
  right: string;
  walk: string;
  dash: string;
  menu1: string;
  menu2: string;
};

export type BulletsSettings = {
  spawnIntervalMs: number;
  speed: number;
  size: number;
  bounceChance: number; // 0–100
  maxBullets: number;
  color: string;
};

export type PlayerSettings = {
  size: number;
  maxSpeed: number;
  colorIdle: string;
  colorWalk: string;
  colorDash: string;
  walkFactor: number; // 0.2–0.8
};

export type DashSettings = {
  distance: number;
  durationMs: number;
  iframesMs: number;
  cooldownMs: number;
};

export type Settings = {
  bindings: Bindings;
  bullets: BulletsSettings;
  player: PlayerSettings;
  dash: DashSettings;
};

export const STORAGE_KEY = "dash-proto:settings:v3";

// Bindings store KeyboardEvent.code values (layout-independent). Modifier
// codes are normalized to drop the Left/Right side suffix (see normalizeCode
// in main.ts) so either Shift key counts as "Shift", etc.
export const DEFAULT_SETTINGS: Settings = {
  bindings: {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    walk: "Shift",
    dash: "KeyX",
    menu1: "Escape",
    menu2: "Tab",
  },
  bullets: {
    spawnIntervalMs: 1200,
    speed: 250,
    size: 9,
    bounceChance: 100,
    maxBullets: 30,
    color: "#ff3030",
  },
  player: {
    size: 32,
    maxSpeed: 440,
    colorIdle: "#ffffff",
    colorWalk: "#b0b0b0",
    colorDash: "#888888",
    walkFactor: 0.4,
  },
  dash: {
    distance: 120,
    durationMs: 120,
    iframesMs: 150,
    cooldownMs: 400,
  },
};

export type Preset = {
  bullets?: Partial<BulletsSettings>;
  player?: Partial<PlayerSettings>;
  dash?: Partial<DashSettings>;
  bindings?: Partial<Bindings>;
};

export const PRESETS: Record<"Easy" | "Normal" | "Hard", Preset> = {
  Easy: {
    bullets: { spawnIntervalMs: 1800, speed: 180, bounceChance: 50, maxBullets: 15 },
  },
  Normal: {
    bullets: { spawnIntervalMs: 1000, speed: 280, bounceChance: 100, maxBullets: 40 },
  },
  Hard: {
    bullets: { spawnIntervalMs: 500, speed: 380, bounceChance: 100, maxBullets: 80, size: 7 },
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function deepAssign<T>(target: T, source: unknown): T {
  if (!isPlainObject(source)) return target;
  for (const key of Object.keys(source)) {
    const sv = (source as Record<string, unknown>)[key];
    const tv = (target as Record<string, unknown>)[key];
    if (isPlainObject(sv) && isPlainObject(tv)) {
      deepAssign(tv, sv);
    } else if (sv !== undefined) {
      (target as Record<string, unknown>)[key] = sv;
    }
  }
  return target;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function loadSettings(): Settings {
  const base = clone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) deepAssign(base, JSON.parse(raw));
  } catch {
    // fall back to defaults
  }
  return base;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // swallow quota / privacy-mode errors
  }
}
