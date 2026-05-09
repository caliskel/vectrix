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

export type RunSettings = {
  durationSec: number; // 0 = infinite, otherwise hard time limit in seconds
};

export type PickupsSettings = {
  dropChance: number;        // probability 0..1 of a dash-through bullet dropping a pickup
  lifetime: number;          // seconds before pickup expires
  blinkDuration: number;     // seconds at the tail of life when pickup blinks
  pickupRadiusMul: number;   // pickup hitbox radius multiplier vs visual half-size
  passiveInterval: number;   // seconds between passive arena drops; 0 disables
  weights: {
    hp: number;
    shield: number;
    scoreBoost: number;
    breaker: number;
  };
  heal: {
    scoreOnFull: number;     // score given if HP already at max
  };
  shield: {
    duration: number;        // seconds
    charges: number;         // hits absorbed
    hitboxMul: number;       // player hitbox multiplier while shield is active
    scoreOnBlock: number;    // flat score per absorbed bullet
  };
  scoreBoost: {
    duration: number;        // seconds
    bonus: number;           // added to current multiplier when activated
  };
  breaker: {
    duration: number;        // seconds the bullet-breaker effect lasts
    scoreBase: number;       // base score per broken bullet (chained ×2 per kill in one dash)
    particleCount: number;   // particles spawned when a bullet breaks
    glowBlur: number;        // shadowBlur on the player while active
  };
};

export type Settings = {
  bindings: Bindings;
  bullets: BulletsSettings;
  player: PlayerSettings;
  dash: DashSettings;
  run: RunSettings;
  pickups: PickupsSettings;
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
  run: {
    durationSec: 0,
  },
  pickups: {
    dropChance: 0.18,
    lifetime: 5,
    blinkDuration: 1.5,
    pickupRadiusMul: 1.5,
    passiveInterval: 20,
    weights: { hp: 25, shield: 25, scoreBoost: 25, breaker: 25 },
    heal: { scoreOnFull: 500 },
    shield: { duration: 8, charges: 2, hitboxMul: 1.5, scoreOnBlock: 200 },
    scoreBoost: { duration: 6, bonus: 1.0 },
    breaker: { duration: 5, scoreBase: 150, particleCount: 8, glowBlur: 15 },
  },
};

export type Preset = {
  bullets?: Partial<BulletsSettings>;
  player?: Partial<PlayerSettings>;
  dash?: Partial<DashSettings>;
  bindings?: Partial<Bindings>;
  run?: Partial<RunSettings>;
  pickups?: Partial<PickupsSettings>;
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
    player: { size: 16 },
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

function migrate(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const p = parsed as Record<string, any>;
  // dashRush → breaker (effect was replaced with Bullet Breaker; keep
  // weights mapping but drop the old effect block so new defaults apply)
  if (p.pickups && typeof p.pickups === "object") {
    if (p.pickups.weights && typeof p.pickups.weights === "object") {
      const w = p.pickups.weights;
      if (w.dashRush !== undefined && w.breaker === undefined) {
        w.breaker = w.dashRush;
      }
      delete w.dashRush;
    }
    delete p.pickups.dashRush;
  }
  return p;
}

export function loadSettings(): Settings {
  const base = clone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) deepAssign(base, migrate(JSON.parse(raw)));
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
