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

export type AudioSettings = {
  master: number; // 0..1
  sfx: number;    // 0..1
  music: number;  // 0..1 (no music routed yet — slot for future)
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
  audio: AudioSettings;
};

import { PALETTE } from "./palette";
export { PALETTE };

export const STORAGE_KEY = "dash-proto:settings:v3";

// Player particle trail tuning. Plain constants (not in Settings) — these
// are feel parameters that don't need a menu surface yet.
export const PARTICLE_SPAWN_INTERVAL_MS = 40;
export const PARTICLE_DASH_SPAWN_INTERVAL_MS = 15;
export const PARTICLE_LIFETIME_MS = 600;
export const PARTICLE_BASE_SPEED_MIN = 30;
export const PARTICLE_BASE_SPEED_MAX = 80;
export const PARTICLE_SIZE_MIN_FACTOR = 0.25;
export const PARTICLE_SIZE_MAX_FACTOR = 0.4;
export const PARTICLE_DASH_SPEED_MULTIPLIER = 2.0;
export const PARTICLE_TRAIL_MIN_SPEED = 80;
export const PARTICLE_LATERAL_JITTER = 60;
export const PARTICLE_DRAG = 0.95;

// Dash visual tuning. Stretch puts the outer ring into a teardrop along
// the dash direction; ghosts stamp the silhouette behind the player so
// the streak reads as a real teleport rather than a smear.
export const DASH_STRETCH_X = 1.4;
export const DASH_STRETCH_Y = 0.7;
export const DASH_STRETCH_PEAK_X = 1.6;
export const DASH_STRETCH_END_X = 1.1;
export const DASH_STRETCH_PEAK_PHASE_MS = 80;
export const DASH_STRETCH_END_PHASE_MS = 40;
export const DASH_GHOST_INTERVAL_MS = 25;
export const DASH_GHOST_LIFETIME_MS = 250;
export const DASH_GHOST_INITIAL_ALPHA = 0.5;

// Eyelid blink — covers the eye with same-colored top + bottom lids
// instead of squeezing the whole orb.
export const BLINK_INTERVAL_MIN_MS = 4000;
export const BLINK_INTERVAL_MAX_MS = 7000;
export const BLINK_CLOSE_DURATION_MS = 70;
export const BLINK_OPEN_DURATION_MS = 130;

// Idle-look — when there's no threat to track, the pupil periodically
// "glances around". Tier ratios pick the new offset distance with a
// 60/30/10 weighting (near / mid / far), within the iris's available
// travel.
export const IDLE_LOOK_CALM_DOWN_MS = 800;
export const IDLE_LOOK_INTERVAL_MIN_MS = 800;
export const IDLE_LOOK_INTERVAL_MAX_MS = 2400;
export const IDLE_LOOK_QUICK_DART_CHANCE = 0.1;
export const IDLE_LOOK_CENTER_CHANCE = 0.15;
export const IDLE_LOOK_NEAR_DIST_RATIO = 0.3;
export const IDLE_LOOK_MID_DIST_RATIO = 0.6;
export const IDLE_LOOK_FAR_DIST_RATIO = 0.9;
export const IDLE_JITTER_AMPLITUDE = 0.5;

// Movement animations for the player eye — lean (tilt into wind), bob
// (vertical sway scaled by speed), a squash + stretch "pop" on a sharp
// start, and a reverse squeeze on a sharp brake. Knobs are deliberately
// generous so the deformation reads in motion.
export const LEAN_MAX_HORIZONTAL_RAD = 0.35; // ~20°
export const LEAN_MAX_DIAGONAL_RAD = 0.25;   // ~14°
export const LEAN_VELOCITY_THRESHOLD = 50;
export const LEAN_LERP = 0.12; // per-frame factor at 60 fps; lib derives
// a rate (≈8 / s) from this so the lerp is frame-rate independent
export const BOB_AMPLITUDE_PX = 5;
export const BOB_FREQUENCY_FACTOR = 200;
// bob kicks in earlier than lean — even walk-speed body sways
export const BOB_VELOCITY_THRESHOLD = 30;
export const SQUASH_DURATION_MS = 120;
export const SQUASH_Y = 0.82;
export const STRETCH_X = 1.15;
// sharp-start trigger: speed jumps from below LOW to above HIGH inside
// one frame (with our high acceleration this happens on a fresh keypress)
export const START_SQUASH_PREV_MAX = 30;
export const START_SQUASH_CUR_MIN = 100;
// sharp-brake squeeze: opposite of start, plays when speed plummets from
// above HIGH to below LOW in a single frame (active counter-input)
export const BRAKE_DURATION_MS = 100;
export const BRAKE_STRETCH_Y = 1.1;
export const BRAKE_SQUASH_X = 0.9;
export const BRAKE_PREV_MIN = 100;
export const BRAKE_CUR_MAX = 60;

// Player micro-animations: breathing, threat-driven pupil dilation,
// occasional double blink, and flinch on near-misses. These run on top
// of the existing lean/bob/dash deformations and are applied in
// lib/player.ts so all three modes (sandbox, rooms, landing preview)
// share the behavior.
export const BREATH_PERIOD_MS = 3200;
export const BREATH_AMPLITUDE = 0.04;
// Inhale phase fraction (the rest is exhale). Real breathing is
// asymmetric — quick intake, slower release.
export const BREATH_INHALE_FRACTION = 0.4;
export const PUPIL_DILATION_MIN = 0.6;
export const PUPIL_DILATION_MAX = 1.3;
export const PUPIL_DILATION_LERP = 0.04;
export const PUPIL_THREAT_RADIUS = 250;
export const PUPIL_ENEMY_THREAT_RADIUS = 300;
export const DOUBLE_BLINK_CHANCE = 0.25;
export const DOUBLE_BLINK_DELAY_MS = 150;
export const FLINCH_RADIUS_EXTRA = 30;
export const FLINCH_OFFSET_PX = 2.5;
export const FLINCH_DURATION_MS = 80;
export const FLINCH_COOLDOWN_MS = 250;
export const FLINCH_PUPIL_SHRINK = 0.7;
export const FLINCH_PUPIL_RECOVER_MS = 200;

// Watcher pacing — fraction of player.maxSpeed used for chase. 0.28
// lets the player walk away if they keep moving but punishes ignoring
// the eye while reading laser telegraphs.
export const WATCHER_SPEED_FACTOR = 0.28;
// Brake-and-aim feel: instead of a hard stop on entering aiming,
// velocity decays each frame (DECEL_FACTOR is the per-60fps-frame
// multiplier; converted to a frame-rate-independent factor in the sim).
// On exit (cooldown) velocity ramps back up toward chase via a lerp.
// The squash deformation sells the brake — 150 ms of held squash, then
// 200 ms recovery to 1.0.
export const WATCHER_DECEL_FACTOR = 0.88;
export const WATCHER_ACCEL_LERP = 0.06;
export const WATCHER_BRAKE_SQUASH_X = 0.88;
export const WATCHER_BRAKE_STRETCH_Y = 1.12;
export const WATCHER_BRAKE_SQUASH_DURATION_MS = 150;
export const WATCHER_BRAKE_RECOVERY_MS = 200;

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
    color: PALETTE.bullet,
  },
  player: {
    size: 32,
    maxSpeed: 440,
    colorIdle: PALETTE.player,
    colorWalk: PALETTE.playerWalk,
    colorDash: PALETTE.playerDash,
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
  audio: {
    master: 0.8,
    sfx: 0.6,
    music: 0.8,
  },
};

export type Preset = {
  bullets?: Partial<BulletsSettings>;
  player?: Partial<PlayerSettings>;
  dash?: Partial<DashSettings>;
  bindings?: Partial<Bindings>;
  run?: Partial<RunSettings>;
  pickups?: Partial<PickupsSettings>;
  audio?: Partial<AudioSettings>;
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
