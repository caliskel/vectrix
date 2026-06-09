// Keybinds used to live here (`Settings.bindings`) but moved into a
// dedicated module + storage key in v5 so the Controls overlay on
// the landing page can configure them globally for sandbox / rooms
// / tutorial. See `lib/keybinds.ts` for the new profile shape.

export type BulletsSettings = {
  spawnIntervalMs: number;
  speed: number;
  size: number;
  bounceChance: number; // 0–100
  maxBullets: number;
  color: string;
};

export type RunSettings = {
  durationSec: number; // 0 = infinite, otherwise hard time limit in seconds
};

export type AudioSettings = {
  master: number; // 0..1
  sfx: number;    // 0..1
  music: number;  // 0..1 (no music routed yet — slot for future)
};

export type ControlsSettings = {
  // When true, the player moves toward the mouse cursor (full 360°,
  // instant/precise) instead of WASD's 8-directional input. Toggled
  // live from the sandbox Settings menu. Default off — keyboard stays
  // the baseline scheme.
  mouseMove: boolean;
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
  bullets: BulletsSettings;
  run: RunSettings;
  pickups: PickupsSettings;
  audio: AudioSettings;
  controls: ControlsSettings;
};

import { PALETTE } from "./palette";
import {
  KEYBIND_STORAGE_KEY,
  profileFromLegacyBindings,
  saveKeybinds,
} from "./keybinds";
export { PALETTE };

export const STORAGE_KEY = "dash-proto:settings:v5";
const STORAGE_KEY_LEGACY_V4 = "dash-proto:settings:v4";
const STORAGE_KEY_LEGACY_V3 = "dash-proto:settings:v3";

// Player + dash physics are intentionally NOT in Settings so all
// modes (sandbox / rooms / tutorial) share the same hero. Sandbox
// used to expose these via PlayerSettings / DashSettings, which let
// rooms inherit player.size / dash.cooldownMs etc — that's the bug.
// Numbers below match the v3 PRESETS.Default at the moment of the
// move; touch them here to adjust hero feel everywhere at once.
export const PLAYER_SIZE = 32;
export const PLAYER_MAX_SPEED = 440;
export const PLAYER_WALK_FACTOR = 0.4;
// Ground-movement feel — shared by sandbox / rooms / tutorial / epilogue
// so the hero handles identically everywhere (previously duplicated as
// local ACCEL_FACTOR / FRICTION consts in each game file).
//   accel = PLAYER_MAX_SPEED * PLAYER_ACCEL_FACTOR  (px/s²)
//   per-frame friction damp = exp(-PLAYER_FRICTION * dt)
// Equilibrium speed of the accel/friction system is
//   PLAYER_MAX_SPEED * PLAYER_ACCEL_FACTOR / PLAYER_FRICTION.
// Keeping the two factors EQUAL makes that equilibrium land exactly on
// PLAYER_MAX_SPEED, so the hard velocity cap stops fighting friction and
// only acts as a safety clamp. Higher (equal) values = snappier: shorter
// coast (PLAYER_MAX_SPEED / PLAYER_FRICTION px) and faster turns
// (time constant 1 / PLAYER_FRICTION s). 14/14 ⇒ ~31 px coast, ~71 ms
// turn — the "responsive" profile tuned for precise bullet-hell dodging.
export const PLAYER_ACCEL_FACTOR = 14;
export const PLAYER_FRICTION = 14;
export const DASH_DISTANCE = 120;
export const DASH_DURATION_MS = 140;
export const DASH_IFRAMES_MS = DASH_DURATION_MS + 80;
export const DASH_COOLDOWN_MS = 800;

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
export const LEAN_MAX_HORIZONTAL_RAD = 0.32; // ~18°
export const LEAN_MAX_DIAGONAL_RAD = 0.22;   // ~13°
export const LEAN_VELOCITY_THRESHOLD = 50;
export const LEAN_LERP = 0.18; // per-frame factor at 60 fps; lib derives
// a rate (≈12 / s) from this so the lerp is frame-rate independent
export const BOB_AMPLITUDE_PX = 4;
export const BOB_FREQUENCY_FACTOR = 140;
// bob kicks in earlier than lean — even walk-speed body sways
export const BOB_VELOCITY_THRESHOLD = 30;
export const SQUASH_DURATION_MS = 180;
export const SQUASH_Y = 0.85;
export const STRETCH_X = 1.12;
// sharp-start trigger: speed jumps from below LOW to above HIGH inside
// one frame (with our high acceleration this happens on a fresh keypress)
export const START_SQUASH_PREV_MAX = 30;
export const START_SQUASH_CUR_MIN = 100;
// sharp-brake squeeze: triggered when |velocity| drops by more than
// BRAKE_VELOCITY_DROP_THRESHOLD over BRAKE_DROP_TIME_MS (a per-second
// deceleration; the lib uses (prevSpeed - speed) / dt vs the derived
// rate). Hold full squash for BRAKE_DURATION_MS, then ease back to 1.0
// over BRAKE_RECOVERY_MS.
export const BRAKE_DURATION_MS = 100;
export const BRAKE_RECOVERY_MS = 150;
export const BRAKE_STRETCH_Y = 1.22;
export const BRAKE_SQUASH_X = 0.78;
export const BRAKE_VELOCITY_DROP_THRESHOLD = 200; // px/s
export const BRAKE_DROP_TIME_MS = 100;            // ms

// Anisotropic stretch — while moving fast the body continuously stretches
// along the velocity direction (and squashes perpendicular) like a ball
// running. Strength scales with speed above the threshold and clamps at
// ANISOTROPIC_STRETCH_MAX. Skipped during dash.
export const ANISOTROPIC_STRETCH_MAX = 0.1;
export const ANISOTROPIC_STRETCH_VELOCITY_THRESHOLD = 100;
export const ANISOTROPIC_STRETCH_VELOCITY_FACTOR = 900;

// Smash on collision — when the player slams into a wall (or stationary
// enemy) the eye flattens against the surface, springs back past 1.0
// (overshoot), then settles. Trigger requires inward velocity above
// SMASH_MIN_IMPACT_VELOCITY; squash strength interpolates between
// SMASH_MIN_SQUASH (light tap) and SMASH_MAX_SQUASH (full slam).
// Cooldown gates re-trigger so a player resting against a wall with a
// noisy velocity doesn't pulse.
export const SMASH_MIN_IMPACT_VELOCITY = 200;
// Impact velocity at which the squash reaches SMASH_MAX_SQUASH; below
// SMASH_MIN_IMPACT_VELOCITY no smash fires; in between the squash
// strength linearly interpolates from SMASH_MIN_SQUASH to MAX_SQUASH.
// Bumped well above the player's max speed so normal play sits in the
// middle of the range and never reaches the heaviest deformation.
export const SMASH_FULL_IMPACT_VELOCITY = 800;
export const SMASH_MAX_SQUASH = 0.78;
export const SMASH_MIN_SQUASH = 0.85;
export const SMASH_DURATION_MS = 120;
export const SMASH_RECOVERY_MS = 200;
export const SMASH_OVERSHOOT_MS = 60;
export const SMASH_COOLDOWN_MS = 200;

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

// --- Watcher 2.0 — gaze-driven LOS sniper -----------------------------
// HP raised from 3 → 5 so the upgraded threat doesn't collapse in one
// dash combo. Cycle compressed (was 3.75 s) so dead-windows between
// firings shrink without making any single phase unreadable.
export const WATCHER_HP_MAX = 5;
export const WATCHER_IDLE_SEC = 1.0;
export const WATCHER_AIMING_SEC = 0.8;
export const WATCHER_FIRING_SEC = 0.3;
export const WATCHER_COOLDOWN_SEC = 0.5;
// Tracking aim — during `aiming` the live laser's angle lerps toward
// the player at this angular velocity. 1.5 rad/s ≈ player walking
// speed at typical engagement range (~300 px). Side-stepping no longer
// breaks lock; only a committed perpendicular dash exceeds the cap.
export const WATCHER_AIM_TRACKING_RAD_PER_SEC = 1.5;
// Gaze stack — fills while there's clear LOS from Watcher to player,
// decays asymmetrically faster so breaking LOS feels like real
// counter-play. At 1.0 the next fired laser pierces dash i-frames.
export const WATCHER_GAZE_FILL_TIME_SEC = 2.0;
export const WATCHER_GAZE_DECAY_TIME_SEC = 1.0;

// Watcher idle behavior — slow horizontal drift around its home spot
// + pupil that wanders rather than tracking nothing. Active only
// while awarenessState === "idle".
export const WATCHER_IDLE_DRIFT_AMPLITUDE_X = 30;
export const WATCHER_IDLE_DRIFT_AMPLITUDE_Y = 8;
// Phase advance per millisecond — applied as `dt * 1000 * SPEED` so a
// dt-in-seconds loop matches the user-facing "0.0008" rate (period
// ≈ 7.8 s on the X axis).
export const WATCHER_IDLE_DRIFT_SPEED = 0.0008;
export const WATCHER_IDLE_DRIFT_LERP = 0.05;
export const WATCHER_IDLE_PUPIL_LERP = 0.08;
export const WATCHER_IDLE_PUPIL_INTERVAL_MIN_MS = 1000;
export const WATCHER_IDLE_PUPIL_INTERVAL_MAX_MS = 2000;

// Enemy awareness — sleeping detection radius + alert ramp before
// combat kicks in. Each archetype has its own radius reflecting role
// (Watcher sees furthest as a sniper; Hunter shortest, since it gets
// in close fast). Player entering the radius transitions idle → alerting,
// alerting holds for ALERT_DURATION_MS, then flips to aggro.
// Detection is fixed per archetype — same value everywhere in the
// game, no per-instance overrides. Players learn the "wake distance"
// once and it carries across rooms. Tuned against the longest-range
// rooms (corridor) so corner turrets still wake before the player is
// on top of them.
export const ENEMY_TURRET_DETECTION = 600;
export const ENEMY_WATCHER_DETECTION = 700;
export const ENEMY_HUNTER_DETECTION = 350;
export const ALERT_DURATION_MS = 500;
// De-aggro: Turret + Watcher (not Hunter) drop back to idle when the
// player has been outside `detectionRadius * MULTIPLIER` for at least
// COOLDOWN_MS. Hunter ignores both — once it sees the player it stays
// aggro for the rest of the run.
export const ENEMY_DEAGGRO_RADIUS_MULTIPLIER = 1.3;
export const ENEMY_DEAGGRO_COOLDOWN_MS = 2000;
// Alerting visual — jitter through the whole window + a single
// ring-burst on transition. Old squash/glow/exclamation were removed
// in favor of these two combined.
export const ALERT_JITTER_INTENSITY_PEAK = 4; // px peak amplitude
export const ALERT_JITTER_PEAK_TIME = 0.6;    // when the peak hits, 0..1 of phase
export const ALERT_JITTER_END_INTENSITY = 0.5;
export const ALERT_RING_DURATION_MS = 400;
export const ALERT_RING_END_RADIUS_OFFSET = 50;
export const ALERT_RING_START_LINEWIDTH = 4;
export const ALERT_BURST_PARTICLE_COUNT = 6;
export const ALERT_BURST_PARTICLE_SPEED_MIN = 200;
export const ALERT_BURST_PARTICLE_SPEED_MAX = 350;
export const ALERT_BURST_PARTICLE_LIFETIME_MS = 300;

// Hunter idle behavior — slow parametric trajectory around its home
// position. Each Hunter picks a path type + size + rotation at
// construction so a roomful reads as a flock of fish swimming in
// lazy circles, figure-8s, and ovals rather than identical orbits.
// Trail is intentionally KEPT visible in idle (softer params below)
// so the trajectory itself reads as a hypnotic motion ghost.
export const HUNTER_IDLE_PATH_SPEED = 0.4;     // radians/sec along the curve
export const HUNTER_IDLE_PATH_SIZE_MIN = 50;
export const HUNTER_IDLE_PATH_SIZE_MAX = 90;
export const HUNTER_IDLE_LERP_FACTOR = 0.08;   // body trails the curve point
export const HUNTER_IDLE_ANGLE_LERP = 0.15;
export const HUNTER_IDLE_TRAIL_INTERVAL_MS = 50;
export const HUNTER_IDLE_TRAIL_MAX_ALPHA = 0.4;
export const HUNTER_IDLE_TRAIL_GLOW_BLUR = 6;
export const HUNTER_IDLE_GLOW_BLUR = 10;       // softer outline glow than aggro

// Hunter motion trail — shrunk + faded copies of the body left
// behind every TRAIL_INTERVAL_MS while moving. Samples age out so a
// stopped Hunter's trail fades naturally instead of lingering.
export const HUNTER_TRAIL_BUFFER_SIZE = 12;
export const HUNTER_TRAIL_INTERVAL_MS = 25;
export const HUNTER_TRAIL_MIN_VELOCITY = 50;
export const HUNTER_TRAIL_MAX_ALPHA = 0.6;
export const HUNTER_TRAIL_MIN_SCALE = 0.3;
export const HUNTER_TRAIL_MAX_SCALE = 0.8;
export const HUNTER_TRAIL_GLOW_BLUR = 8;

// Impact feedback — three intensity tiers for "successful hit" cues.
// Bullet hit (light) is silent on shake / screen flash so it stays
// pleasant under heavy fire. Enemy damage (medium) and enemy kill
// (heavy) layer in screen shake, knockback, and on the kill, a brief
// global white flash.
export const IMPACT_BULLET_FLASH_MS = 80;
export const IMPACT_BULLET_FLASH_RADIUS = 16;
export const IMPACT_BULLET_PARTICLE_COUNT = 6;

export const IMPACT_ENEMY_DAMAGE_FLASH_MS = 80;
export const IMPACT_ENEMY_DAMAGE_KNOCKBACK_PX = 7;
export const IMPACT_ENEMY_DAMAGE_KNOCKBACK_MS = 200;
export const IMPACT_ENEMY_DAMAGE_RING_DURATION_MS = 200;
export const IMPACT_ENEMY_DAMAGE_RING_START_R = 30;
export const IMPACT_ENEMY_DAMAGE_RING_END_R = 70;
export const IMPACT_ENEMY_DAMAGE_PARTICLE_COUNT = 8;
export const IMPACT_ENEMY_DAMAGE_SHAKE_AMOUNT = 4;
export const IMPACT_ENEMY_DAMAGE_SHAKE_DURATION_MS = 100;

export const IMPACT_ENEMY_KILL_FLASH_MS = 100;
export const IMPACT_ENEMY_KILL_RING_INNER_START_R = 40;
export const IMPACT_ENEMY_KILL_RING_INNER_END_R = 100;
export const IMPACT_ENEMY_KILL_RING_INNER_DURATION_MS = 250;
export const IMPACT_ENEMY_KILL_RING_OUTER_START_R = 30;
export const IMPACT_ENEMY_KILL_RING_OUTER_END_R = 160;
export const IMPACT_ENEMY_KILL_RING_OUTER_DURATION_MS = 400;
export const IMPACT_ENEMY_KILL_PARTICLE_COUNT = 16;
export const IMPACT_ENEMY_KILL_WHITE_PARTICLE_COUNT = 8;
export const IMPACT_ENEMY_KILL_FLASH_OPACITY = 0.15;
export const IMPACT_ENEMY_KILL_SCREEN_FLASH_MS = 60;
export const IMPACT_ENEMY_KILL_SHAKE_AMOUNT = 7;
export const IMPACT_ENEMY_KILL_SHAKE_DURATION_MS = 180;

export const DEFAULT_SETTINGS: Settings = {
  bullets: {
    spawnIntervalMs: 1200,
    speed: 250,
    size: 9,
    bounceChance: 100,
    maxBullets: 30,
    color: PALETTE.bullet,
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
  controls: {
    mouseMove: false,
  },
};

export type Preset = {
  bullets?: Partial<BulletsSettings>;
  run?: Partial<RunSettings>;
  pickups?: Partial<PickupsSettings>;
  audio?: Partial<AudioSettings>;
  controls?: Partial<ControlsSettings>;
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

function migrate(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const p = parsed as Record<string, any>;
  // v3 → v4: player + dash physics moved to file-level constants in
  // config.ts so sandbox tweaks can't leak into the campaign. Strip
  // the keys so the saved blob never carries stale physics.
  delete p.player;
  delete p.dash;
  // v4 → v5: keybinds extracted to their own storage key + module.
  // Lift the player's existing rebinds into the new profile (if no
  // profile has been saved yet) so they don't lose their setup.
  if (p.bindings && typeof p.bindings === "object") {
    try {
      const alreadyHasNew = localStorage.getItem(KEYBIND_STORAGE_KEY) !== null;
      if (!alreadyHasNew) {
        saveKeybinds(profileFromLegacyBindings(p.bindings));
      }
    } catch {
      // quota / privacy-mode — the player keeps defaults until they
      // open the Controls overlay and resave
    }
    delete p.bindings;
  }
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
    if (raw) {
      deepAssign(base, migrate(JSON.parse(raw)));
      return base;
    }
    // First boot under v5 — try v4 then v3, in order. Each migrate()
    // pass strips the now-irrelevant fields and lifts bindings into
    // the dedicated keybinds module. After a successful migration we
    // write the cleaned blob under v5 and drop the legacy keys so
    // future loads skip the chain entirely.
    const legacyV4 = localStorage.getItem(STORAGE_KEY_LEGACY_V4);
    if (legacyV4) {
      deepAssign(base, migrate(JSON.parse(legacyV4)));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
        localStorage.removeItem(STORAGE_KEY_LEGACY_V4);
        localStorage.removeItem(STORAGE_KEY_LEGACY_V3);
      } catch {
        // quota / privacy-mode — fall back to in-memory only
      }
      return base;
    }
    const legacyV3 = localStorage.getItem(STORAGE_KEY_LEGACY_V3);
    if (legacyV3) {
      deepAssign(base, migrate(JSON.parse(legacyV3)));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
        localStorage.removeItem(STORAGE_KEY_LEGACY_V3);
      } catch {
        // quota / privacy-mode — fall back to in-memory only
      }
    }
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

// Floating background text — cyberpunk-terminal phrases that type
// themselves out in the canvas margins outside the playfield. See
// lib/background-text.ts for the runtime; constants here so tuning
// the cadence doesn't require touching the module.
export const FLOATING_TEXT_SPAWN_INTERVAL_MIN_MS = 3000;
export const FLOATING_TEXT_SPAWN_INTERVAL_MAX_MS = 7000;
export const FLOATING_TEXT_MAX_CONCURRENT = 4;
export const FLOATING_TEXT_TYPING_SPEED_MS = 50;
export const FLOATING_TEXT_STABLE_DURATION_MIN_MS = 3000;
export const FLOATING_TEXT_STABLE_DURATION_MAX_MS = 5000;
// Reverse-type speed for the disappear phase. A touch faster than
// typing so the erase feels like a decisive backspace pass rather
// than a slow tail.
export const FLOATING_TEXT_ERASING_SPEED_MS = 35;
export const FLOATING_TEXT_FONT_SIZE_MIN = 11;
export const FLOATING_TEXT_FONT_SIZE_MAX = 16;
export const FLOATING_TEXT_CURSOR_BLINK_MS = 400;
export const FLOATING_TEXT_SPAWN_RETRY_LIMIT = 5;
