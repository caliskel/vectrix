import { audio } from "../audio";
import { makeBullet } from "../bullets";
import { drawNeon } from "../neon";
import { initAwareness } from "./awareness";
import { Hunter } from "./hunter";
import type {
  AwarenessState,
  Enemy,
  EnemyContext,
  EnemyType,
} from "./types";

// === Sentinel — campaign boss ===
//
// Self-contained state machine: intro → idle/attacking → dying →
// defeated. The boss owns its own intro materialization, attack
// cycle, dying choreography (slow-mo, layered ring fragments,
// weakpoint grow, white flash, VICTORY text). rooms-game only
// queries `state`, `timeScale`, and the public draw / overlay hooks
// — it doesn't drive the boss timing itself.

const SENTINEL_COLOR = "#ff3344";
const VICTORY_COLOR = "#22ff88";
const FADE_OVERLAY_COLOR = "rgba(0, 0, 0, ALPHA)"; // ALPHA replaced at use
// HP doubled (was 30) to extend the fight to 2–4 minutes once the
// body became invulnerable outside Ring Burst — eye-hit is now the
// only damage path, and HP=60 / 3-per-eye-hit lands at ~10–20
// successful hits (one or two per RB) for a kill.
const SENTINEL_HP_MAX = 60;
const SENTINEL_HITBOX_RADIUS = 110;
// Contact-damage radius lines up with the outermost shell so the
// "you're inside the boss" cue is visually consistent. Same value
// as the dash hitbox today; kept as a separate constant in case
// the two ever need to drift apart.
const SENTINEL_CONTACT_RADIUS = SENTINEL_HITBOX_RADIUS;

// Intro timeline (ms, all relative to state entry).
const INTRO_FADE_END_MS = 800;
const INTRO_MATERIALIZE_END_MS = 1600;
const INTRO_SHAKE_END_MS = 1700;
const INTRO_TEXT_START_MS = 1700;
const INTRO_TEXT_FADE_IN_END_MS = 1900;
const INTRO_TEXT_HOLD_END_MS = 3000;
const INTRO_TEXT_END_MS = 3300;
const INTRO_TOTAL_MS = 3300;

// Materialization particle burst (16 radial particles spawned once at 800ms).
const MATERIALIZE_PARTICLE_COUNT = 16;
const MATERIALIZE_PARTICLE_LIFETIME_MS = 800;

// Idle anim
const ROTATION_RATE = 0.25; // rad/s
const FRAGMENT_ROTATION_RATE = -0.4; // rad/s — counter-rotates
const PULSE_PERIOD_SEC = 2.0;
const PULSE_AMPLITUDE = 0.05;
const EYE_PULSE_PERIOD_SEC = 1.5;

// After a Ring Burst the boss has been frozen in place for ~7.6 s
// while figurePhase kept ticking — resuming straight to the live
// lemniscate point would teleport-feel. The post-RB transition
// blends the *target* from the boss's frozen position to the live
// curve point over MOVEMENT_TRANSITION_SEC with easeInOutCubic so
// the boss "wakes up" smoothly.
const MOVEMENT_TRANSITION_SEC = 1.5;

// Movement — lazy figure-8 (lemniscate) around the arena centre.
// Independent of the player so the boss doesn't drift through walls
// chasing them; the path stays bounded by amplitudes that already
// pad off the room edges. dt-normalised lerp keeps the first
// post-intro frame from teleporting onto the curve.
const FIGURE_EIGHT_PERIOD_SEC = 12;
const FIGURE_EIGHT_EDGE_PAD_PX = 60; // amplitude inset from each wall
const POSITION_LERP_PER_FRAME = 0.04; // applied at 60 fps via realDt * 60
const DEFAULT_ARENA_W = 1600;
const DEFAULT_ARENA_H = 1200;

// Attack 1 — radial burst (kept readable, idle gap shrunk so the
// total cycle = 0.65 + 0.4 + 0.05 + 0.3 = 1.4 s).
const RADIAL_IDLE_GAP_SEC = 0.65;
const RADIAL_TELEGRAPH_SEC = 0.4;
const RADIAL_FIRING_SEC = 0.05;
const RADIAL_RECOVERY_SEC = 0.3;
const RADIAL_BURST_COUNT = 12;
const RADIAL_BURST_SPEED = 350;

// Attack 2 — Aimed Shot Trio. Lock target on telegraph entry, fire
// 3 fast bullets along the locked angle 150 ms apart, recover. Total
// cycle: 0.6 + 0.45 + 0.3 + 3.0 = 4.35 s.
const AIMED_TELEGRAPH_SEC = 0.6;
const AIMED_FIRING_SEC = 0.45;
const AIMED_RECOVERY_SEC = 0.3;
const AIMED_COOLDOWN_SEC = 3.0;
const AIMED_BULLET_COUNT = 3;
const AIMED_BULLET_INTERVAL_SEC = 0.15;
const AIMED_BULLET_SPEED = 450;
// Aim-line dashed pattern + crawl rate (px/s) — draws as a "live"
// threat instead of a static red line.
const AIMED_DASH_PATTERN: [number, number] = [10, 8];
const AIMED_DASH_RATE = 60;
const AIMED_LINE_GLOW = 12;
const AIMED_DIAMOND_SIZE = 14;
const AIMED_MUZZLE_PARTICLE_COUNT = 8;
const AIMED_MUZZLE_PARTICLE_LIFETIME_SEC = 0.2;
// Tracking — line follows the live player position throughout
// telegraph; angle is locked only at the firing transition.
// 3 rad/s lets a normal walk be tracked but a sideways dash escape.
const AIMED_MAX_ANGULAR_VEL = 3.0;
// Confirmation flash on telegraph → firing — line goes solid +
// fully opaque for SNAP_SEC, then fades to nothing.
const AIMED_SNAP_DURATION_SEC = 0.08;

// Dying timeline (ms, all relative to dying-state entry).
const DYING_SLOWMO_RAMP_MS = 200;
const DYING_SLOWMO_HOLD_END_MS = 1000;
const DYING_OUTER_EXPLODE_MS = 1000;
const DYING_MIDDLE_EXPLODE_MS = 1500;
const DYING_INNER_EXPLODE_MS = 2000;
const DYING_WEAKPOINT_START_MS = 2500;
const DYING_WEAKPOINT_END_MS = 3000;
const DYING_FLASH_START_MS = 3000;
const DYING_FLASH_PEAK_MS = 3050;
const DYING_FLASH_END_MS = 3300;
const DYING_VICTORY_START_MS = 3050;
const DYING_VICTORY_FADE_IN_END_MS = 3350;
const DYING_TOTAL_MS = 6050; // 3050 + 3000 ms hold

const FRAGMENT_LIFETIME_MS = 1500;
const FRAGMENT_FADE_OUT_MS = 500;
const FRAGMENT_SPEED = 250;
const FRAGMENT_LENGTH = 20;
const FRAGMENT_THICKNESS = 4;
const FRAGMENT_ANGULAR_VEL_RANGE = 4; // ±rad/s

// Hexagon vertex sets — used both for shell outlines and fragment
// spawn directions (one per outer-shell vertex).
const OUTER_VERTS = hexVerts(110);
const MIDDLE_VERTS = hexVerts(85);
const INNER_VERTS = hexVerts(60);

// === Visual polish constants ===
//
// Eye — multi-layer iris drawn outermost-first so brighter inner
// circles paint on top of softer outer glow. Radii match the spec
// in lib/enemies/sentinel.ts comments and are NOT scaled by the
// boss's own pulse — the eye has its own breath cycle.
const EYE_LAYERS: ReadonlyArray<{
  r: number;
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  alpha?: number;
}> = [
  { r: 32, stroke: "#ffaa22", lineWidth: 8, alpha: 0.15 }, // ext glow (alpha overridden by breath)
  { r: 24, stroke: "#ffaa22", lineWidth: 2, alpha: 0.9 }, // amber rim
  { r: 22, fill: "#2a0612" }, // wine fill
  { r: 18, stroke: "#ff3344", lineWidth: 1.5 }, // red iris
  { r: 12, stroke: "#ff5577", lineWidth: 1, alpha: 0.6 }, // inner ring
  { r: 8, stroke: "#ffffff", lineWidth: 5, alpha: 0.2 }, // hot core soft
  { r: 7, stroke: "#ffffff", lineWidth: 2.5, alpha: 0.5 }, // hot core sharp
  { r: 5, fill: "#fff8e0" }, // warm white pupil
];
const EYE_BREATH_PERIOD_SEC = 1.4;
const EYE_SCALE_MIN = 0.94;
const EYE_SCALE_MAX = 1.06;
const EYE_EXT_GLOW_ALPHA_MIN = 0.1;
const EYE_EXT_GLOW_ALPHA_MAX = 0.25;
const EYE_SPOKE_COUNT = 8;
const EYE_SPOKE_INNER_R = 11;
const EYE_SPOKE_OUTER_R = 18;
const EYE_SPOKE_COLOR = "#ff5577";
const EYE_SPOKE_LINE_WIDTH = 0.8;
const EYE_SPOKE_ALPHA = 0.7;

// Rings — each shell now renders as shadow + bright stroke for depth,
// plus three vertex-aligned 30° markers that rotate independently per
// ring so the rotation is actually readable.
type RingDepth = {
  shadowColor: string;
  shadowLineWidth: number;
  shadowAlpha: number;
  brightColor: string;
  brightLineWidth: number;
  brightAlpha: number;
  markerColor: string;
  markerLineWidth: number;
  /** Optional alpha multiplier on the markers (used to dim mid /
   *  inner ring markers during vulnerable). 1 if omitted. */
  markerAlpha?: number;
  /** Optional outermost bloom layer drawn first — wider line, low
   *  alpha. Currently used by the outer ring during Ring Burst to
   *  read as the only damaging shell. */
  bloomColor?: string;
  bloomLineWidth?: number;
  bloomAlpha?: number;
  /** Marker arc width in radians. Defaults to RING_MARKER_ARC_RAD
   *  (30°). Outer ring during RB widens to 40° for emphasis. */
  markerArcRad?: number;
  maxAngularVel: number; // rad/s — the random target sample range
};
const OUTER_RING_DEPTH: RingDepth = {
  shadowColor: "#660022",
  shadowLineWidth: 6,
  shadowAlpha: 0.4,
  brightColor: "#ff3344",
  brightLineWidth: 3,
  brightAlpha: 1.0,
  markerColor: "#ff7788",
  markerLineWidth: 4,
  maxAngularVel: 0.8,
};
// Outer ring during Ring Burst — triple-stack with an outermost
// bloom + brighter `#ff4455` core + bigger `#ffffff` markers so the
// only damaging shell visually shouts "danger here."
const OUTER_RING_DEPTH_RB: RingDepth = {
  shadowColor: "#660022",
  shadowLineWidth: 10,
  shadowAlpha: 0.3,
  brightColor: "#ff4455",
  brightLineWidth: 5,
  brightAlpha: 1.0,
  markerColor: "#ffffff",
  markerLineWidth: 6,
  markerArcRad: (Math.PI * 40) / 180,
  bloomColor: "#ff3344",
  bloomLineWidth: 14,
  bloomAlpha: 0.12,
  maxAngularVel: 0.8,
};
// Mid + inner during vulnerable / reassemble — desaturated and
// faded so they read as visual decoration, not threats. Body of
// rendering uses these instead of the default depth configs while
// `dimMidInner` is true.
const MID_RING_DEPTH_DIM: RingDepth = {
  shadowColor: "#1a0810",
  shadowLineWidth: 4,
  shadowAlpha: 0.6,
  brightColor: "#8a2030",
  brightLineWidth: 2,
  brightAlpha: 0.4,
  markerColor: "#8a2030",
  markerLineWidth: 2.5,
  markerAlpha: 0.5,
  maxAngularVel: 1.2,
};
const INNER_RING_DEPTH_DIM: RingDepth = {
  shadowColor: "#100008",
  shadowLineWidth: 3,
  shadowAlpha: 0.5,
  brightColor: "#5a1020",
  brightLineWidth: 1.5,
  brightAlpha: 0.3,
  markerColor: "#5a1020",
  markerLineWidth: 1.5,
  markerAlpha: 0.4,
  maxAngularVel: 1.6,
};
const MID_RING_DEPTH: RingDepth = {
  shadowColor: "#4a0319",
  shadowLineWidth: 5,
  shadowAlpha: 1.0,
  brightColor: "#ff5577",
  brightLineWidth: 2.5,
  brightAlpha: 1.0,
  markerColor: "#ff99aa",
  markerLineWidth: 3.5,
  maxAngularVel: 1.2,
};
const INNER_RING_DEPTH: RingDepth = {
  shadowColor: "#330011",
  shadowLineWidth: 4,
  shadowAlpha: 0.7,
  brightColor: "#ff3344",
  brightLineWidth: 1.5,
  brightAlpha: 0.8,
  markerColor: "#ff7788",
  markerLineWidth: 2.5,
  maxAngularVel: 1.6,
};
const RING_ANGULAR_VEL_LERP = 0.02;
const RING_RETARGET_MIN_MS = 2000;
const RING_RETARGET_MAX_MS = 5000;
const RING_MARKER_COUNT = 3;
const RING_MARKER_ARC_RAD = (Math.PI * 30) / 180; // 30°

// Body — slow breath rescales the whole shell stack and ramps the
// outer-ring glow alpha. Kept on a different period from the eye so
// the silhouette breathes "out of sync with itself."
const BODY_BREATH_PERIOD_SEC = 2.2;
const BODY_SCALE_MIN = 0.98;
const BODY_SCALE_MAX = 1.02;
const BODY_GLOW_ALPHA_MIN = 0.2;
const BODY_GLOW_ALPHA_MAX = 0.35;

// Attack 3 — Ring Burst. Phase 1's defining mechanic. Three shells
// detach + expand, the body goes ghosted, and the eye becomes the
// only damage path (with 3× damage). Cooldown gates it to roughly
// once every 8 seconds plus a 6 s grace at fight start so the
// player learns radial / aimed first.
const RB_FIRST_GRACE_SEC = 6.0;
const RB_TELEGRAPH_SEC = 0.5;
// Detach + reassemble pacing reads as a slow inhale + slow exhale
// after the bumpy initial draft — easeInOutCubic on both ends, 800
// ms each. vulnerable holds 5 s so the player has time for a clean
// double-dash through the rings to the eye.
const RB_DETACH_SEC = 0.8;
const RB_VULNERABLE_SEC = 5.0;
const RB_REASSEMBLE_SEC = 0.8;
const RB_RECOVERY_SEC = 0.5;
// Cooldown shortened from 8 s now that the active window is longer
// — between successive Ring Bursts the player gets ~4–5 radial
// volleys and 1–2 aimed shots.
const RB_COOLDOWN_SEC = 6.0;

// Default + expanded ring radii. Detach lerps the live radii from
// the default values to the expanded ones; reassemble lerps back.
const RB_RING_DEFAULT_OUTER = 110;
const RB_RING_DEFAULT_MID = 85;
const RB_RING_DEFAULT_INNER = 60;
const RB_RING_EXPANDED_OUTER = 180;
const RB_RING_EXPANDED_MID = 130;
const RB_RING_EXPANDED_INNER = 95;

// Body almost vanishes in the vulnerable window so it can't compete
// with the eye for attention — the silhouette is still readable
// for orientation but barely.
const RB_BODY_OPACITY_GHOSTED = 0.12;
const RB_TELEGRAPH_JITTER_PX = 3;
const RB_TELEGRAPH_GLOW_BOOST = 1.6;

// Eye behaviour during vulnerable.
const RB_EYE_HITBOX_RADIUS = 20;
const RB_EYE_HIT_DAMAGE = 3;
// Body whiff — short grey FX spawned when the player dashes through
// the body hitbox while the body is invulnerable (i.e., outside
// Ring Burst's vulnerable window). Pure visual cue: "this is not a
// damage path; wait for the eye." rgba color carries 0.6 starting
// alpha so the ring's natural age-fade lands at 0.6 → 0.
const BODY_WHIFF_RING_COLOR = "rgba(138, 138, 138, 0.6)";
const BODY_WHIFF_RING_LIFETIME_SEC = 0.2;
const BODY_WHIFF_RING_R_START = 8;
const BODY_WHIFF_RING_R_END = 24;
const BODY_WHIFF_RING_LW_START = 2;
const BODY_WHIFF_RING_LW_END = 0.5;
const BODY_WHIFF_PARTICLE_COLOR = "#aaaaaa";
const BODY_WHIFF_PARTICLE_COUNT = 4;
const BODY_WHIFF_PARTICLE_SPEED = 150;
const BODY_WHIFF_PARTICLE_LIFETIME_SEC = 0.25;
// Eye breath in vulnerable: scale 0.90 ↔ 1.18 (±0.14 around 1.04).
// Bigger amplitude than the idle eye breath so the open eye reads
// as actively pulsing.
const RB_EYE_VULNERABLE_SCALE_MID = 1.04;
const RB_EYE_VULNERABLE_SCALE_AMPLITUDE = 0.14;
const RB_EYE_VULNERABLE_SCALE_PERIOD_SEC = 0.7;
// Outer halo painted around the eye in vulnerable — a third bloom
// layer over the existing ext-glow stack, pulsing alpha so the
// eye reads as a beacon.
const RB_EYE_HALO_R = 44;
const RB_EYE_HALO_LW = 14;
const RB_EYE_HALO_ALPHA_MIN = 0.2;
const RB_EYE_HALO_ALPHA_MAX = 0.45;
// Pupil core soft glow drawn just behind the white core dots so the
// pupil reads as a fuzzy hot point.
const RB_EYE_PUPIL_GLOW_R = 14;
const RB_EYE_PUPIL_GLOW_LW = 8;
const RB_EYE_PUPIL_GLOW_ALPHA = 0.12;
// Attention pulse — single ring spawned on detach → vulnerable so
// the player's eye snaps to the boss centre at the moment the eye
// opens.
const RB_ATTENTION_PULSE_R0 = 24;
const RB_ATTENTION_PULSE_R1 = 110;
const RB_ATTENTION_PULSE_LW0 = 6;
const RB_ATTENTION_PULSE_LW1 = 1;
const RB_ATTENTION_PULSE_LIFETIME_SEC = 0.6;
const RB_ATTENTION_PULSE_COLOR = "#ffaa22";
// Slow alpha sub-pulse on the outer ring's bright stroke — different
// period from the eye so the two don't beat in sync.
const RB_OUTER_PULSE_PERIOD_SEC = 1.1;
const RB_OUTER_PULSE_ALPHA_MIN = 0.85;
const RB_OUTER_PULSE_ALPHA_MAX = 1.0;
// Reticle: 4 triangles N/E/S/W around the eye. Always visible, but
// idle (red, dim, small) vs vulnerable (gold, bright, +40% scale).
const RETICLE_BASE_RADIUS = 30; // distance from eye centre to triangle base
const RETICLE_HEIGHT = 8; // triangle height
const RETICLE_HALF_WIDTH = 5; // base half-width
const RETICLE_IDLE_COLOR = "#ff3344";
const RETICLE_IDLE_ALPHA = 0.4;
const RETICLE_VULNERABLE_COLOR = "#ffaa22";
const RETICLE_VULNERABLE_ALPHA = 1.0;
const RETICLE_VULNERABLE_SCALE = 1.4;
const RB_EYE_HITSTOP_SEC = 0.08;
const RB_EYE_HITSTOP_TIMESCALE = 0.15;

// Detach burst — central white particle radial spray + a single
// expanding ring. Telegraph audio is reused alert at -8 semitones;
// the eye-hit cue layers hitHeavy + alert at +5 for shimmer.
const RB_DETACH_PARTICLE_COUNT = 18;
const RB_DETACH_PARTICLE_SPEED_MIN = 300;
const RB_DETACH_PARTICLE_SPEED_MAX = 450;
const RB_DETACH_PARTICLE_LIFETIME_SEC = 0.4;
const RB_DETACH_RING_LIFETIME_SEC = 0.3;
const RB_DETACH_RING_START_R = 60;
const RB_DETACH_RING_END_R = 200;

// Ring contact hit zone padding — line strokes are thin, so we
// pad the test against the player's half-size for forgiveness.
const RB_RING_STROKE_HIT_HALFWIDTH = 4;

// Eye-hit reward feedback — heavier than the standard medium
// impact; this is the focal moment of phase 1.
const RB_EYE_HIT_INNER_RING_R0 = 20;
const RB_EYE_HIT_INNER_RING_R1 = 80;
const RB_EYE_HIT_INNER_RING_LIFETIME_SEC = 0.25;
const RB_EYE_HIT_OUTER_RING_R0 = 30;
const RB_EYE_HIT_OUTER_RING_R1 = 140;
const RB_EYE_HIT_OUTER_RING_LIFETIME_SEC = 0.35;
const RB_EYE_HIT_OUTER_RING_COLOR = "#ffaa22";
const RB_EYE_HIT_PARTICLE_COUNT_WHITE = 12;
const RB_EYE_HIT_PARTICLE_COUNT_GOLD = 12;
const RB_EYE_HIT_PARTICLE_SPEED_MIN = 350;
const RB_EYE_HIT_PARTICLE_SPEED_MAX = 500;
const RB_EYE_HIT_PARTICLE_LIFETIME_SEC = 0.5;
const RB_EYE_HIT_SHAKE_PX = 8;
const RB_EYE_HIT_SHAKE_SEC = 0.2;

// === Phase 1 / 2 / 3 framework ===
//
// Phase tracks the active "act" of the fight; HP boundaries 20 + 10
// drive transitions. Each phase scales every attack cooldown by
// PHASE_CADENCE so the rotation tightens as the fight escalates,
// without touching the inner telegraph / fire / recovery beats
// (those stay readable). New attacks unlock per phase: sweep laser
// in phase 2, charge + minion spawns in phase 3 (placeholder for
// the next iteration).
// Phase boundaries scale with the bumped HP — phase 1 is HP 60→40,
// phase 2 is HP 40→20, phase 3 is HP 20→0. Same 1/3-of-HP-per-phase
// proportion as the old 30 → 20 → 10 → 0 split.
const PHASE_HP_BOUNDARY_1_TO_2 = 40;
const PHASE_HP_BOUNDARY_2_TO_3 = 20;
const PHASE_CADENCE: Record<1 | 2 | 3, number> = {
  1: 1.0, // baseline
  2: 0.8,
  3: 0.65,
};
// Accent shifts. The eye keeps `#ffaa22` in every phase (the
// "opportunity" cue), only the body / ring / bullet hue moves.
const ACCENT_PER_PHASE: Record<1 | 2 | 3, string> = {
  1: "#ff3344",
  2: "#ff5511",
  3: "#ff2266",
};
const MID_RING_COLOR_PER_PHASE: Record<1 | 2 | 3, string> = {
  1: "#ff5577",
  2: "#ff7733",
  3: "#ff5588",
};

// Phase transition cinematic — a single 2000 ms window broken into
// four sub-beats (hitstop / build / climax / settle). Sentinel goes
// invulnerable + frozen for the whole window. Timestamps in ms,
// resolved against `phaseTransition.elapsed`.
const PHASE_TRANSITION_TOTAL_MS = 2000;
const PHASE_TRANSITION_HITSTOP_END_MS = 300;
const PHASE_TRANSITION_BUILD_END_MS = 1200;
const PHASE_TRANSITION_CLIMAX_END_MS = 1500;
const PHASE_TRANSITION_SETTLE_END_MS = 2000;
const PHASE_TRANSITION_HITSTOP_TIMESCALE = 0.15;
const PHASE_TRANSITION_BUILD_TIMESCALE = 0.4;
const PHASE_TRANSITION_RING_INTERVAL_MS = 100;
const PHASE_TRANSITION_RING_LIFETIME_SEC = 0.6;
const PHASE_TRANSITION_RING_R0 = 30;
const PHASE_TRANSITION_RING_R1 = 200;
const PHASE_TRANSITION_BUILD_SHAKE_MIN_PX = 2;
const PHASE_TRANSITION_BUILD_SHAKE_MAX_PX = 8;
const PHASE_TRANSITION_CLIMAX_SHAKE_PX = 12;
const PHASE_TRANSITION_CLIMAX_SHAKE_SEC = 0.2;
const PHASE_TRANSITION_CLIMAX_PARTICLE_COUNT = 32;
const PHASE_TRANSITION_CLIMAX_PARTICLE_SPEED_MIN = 300;
const PHASE_TRANSITION_CLIMAX_PARTICLE_SPEED_MAX = 500;
const PHASE_TRANSITION_CLIMAX_PARTICLE_LIFETIME_SEC = 0.6;
const PHASE_TRANSITION_HITSTOP_SHAKE_PX = 6;
const PHASE_TRANSITION_HITSTOP_SHAKE_SEC = 0.1;
const PHASE_TRANSITION_HP_MARKER_FLASH_SEC = 0.3;

// Sweep Laser — phase 2+ attack. Double-pass beam: a 180° forward
// sweep, a brief mid-pause where the beam hangs at the end-angle
// and visually "telegraphs the reverse," then a 180° return sweep
// back to the starting angle. The player has to dodge twice per
// attack — and the mid-pause itself still deals damage so the
// end-angle isn't a free safe-zone. Total damaging window:
// firing-1 + mid-pause + firing-2 = 1.95 s.
const SWEEP_LASER_TELEGRAPH_SEC = 0.8;
// Forward pass is fast — meant to feel sudden. Return pass is
// 33% slower so the player can read the trajectory and burn the
// second dash; the asymmetry between the two passes is the whole
// rhythm of the attack. Mid-pause is now long enough that the
// player's dash cooldown (~640 ms after the ×1.6 boost) fully
// recharges — guaranteed two-dash window.
const SWEEP_LASER_FIRING_1_SEC = 0.9;
const SWEEP_LASER_MID_PAUSE_SEC = 0.8;
const SWEEP_LASER_FIRING_2_SEC = 1.2;
const SWEEP_LASER_RECOVERY_SEC = 0.5;
const SWEEP_LASER_BASE_COOLDOWN_SEC = 5.0;
const SWEEP_LASER_BEAM_HIT_HALF_ANGLE = 0.04; // ~2.3° each side
const SWEEP_LASER_TELEGRAPH_DASH_PATTERN: [number, number] = [10, 8];
const SWEEP_LASER_TELEGRAPH_DASH_RATE = 80;
const SWEEP_LASER_ARC_ALPHA_MIN = 0.1;
const SWEEP_LASER_ARC_ALPHA_MAX = 0.2;
const SWEEP_LASER_ARC_PULSE_PERIOD_SEC = 0.4;
const SWEEP_LASER_DIR_TRIANGLE_OFFSET = 100;
const SWEEP_LASER_DIR_TRIANGLE_SIZE = 10;
// Recovery staged fade — bloom dissipates last, so the residual
// glow reads like a hot wire cooling instead of a flat cut. Each
// layer uses its own duration + easing curve.
const SWEEP_LASER_RECOVERY_CORE_FADE_SEC = 0.25;
const SWEEP_LASER_RECOVERY_MID_FADE_SEC = 0.4;
const SWEEP_LASER_RECOVERY_OUTER_FADE_SEC = 0.5;
// Release ring — single bloom at firing-2 → recovery as visual
// punctuation that the attack ended.
const SWEEP_LASER_RELEASE_RING_R_START = 24;
const SWEEP_LASER_RELEASE_RING_R_END = 180;
const SWEEP_LASER_RELEASE_RING_LIFETIME_SEC = 0.5;
const SWEEP_LASER_RELEASE_RING_LW_START = 6;
const SWEEP_LASER_RELEASE_RING_LW_END = 0.5;
const SWEEP_LASER_RELEASE_RING_COLOR = "#ff5577";
// Light trail — pink residue painted along every recent beam
// position during firing. Visual only; collision / particle
// emission keep using `currentSweepBeamAngle()`.
const SWEEP_TRAIL_MAX_AGE_SEC = 0.4;
const SWEEP_TRAIL_MAX_ENTRIES = 30;
const SWEEP_TRAIL_BASE_OPACITY = 0.22;
const SWEEP_TRAIL_BASE_LINEWIDTH = 8;
const SWEEP_TRAIL_OUTER_COLOR = "#ff5577";
const SWEEP_TRAIL_INNER_COLOR = "#ffaaaa";
const SWEEP_LASER_BEAM_PARTICLE_INTERVAL_SEC = 0.05;
const SWEEP_LASER_BEAM_PARTICLE_SPEED = 600;
const SWEEP_LASER_BEAM_PARTICLE_LIFETIME_SEC = 0.2;
// Mid-pause visuals — at 800 ms the beam can't just be still;
// it breathes (slow easeInOutSine thickness pulse + wiggle), the
// arrow pulses, and the last 100 ms add a final-flash + audio chirp
// so the firing-2 entry doesn't catch the player flat-footed.
const SWEEP_LASER_MID_PAUSE_CORE_LW_BASE = 6;
const SWEEP_LASER_MID_PAUSE_CORE_LW_PEAK = 14;
const SWEEP_LASER_MID_PAUSE_GLOW_ALPHA_BASE = 0.15;
const SWEEP_LASER_MID_PAUSE_GLOW_ALPHA_PEAK = 0.45;
const SWEEP_LASER_MID_PAUSE_WIGGLE_AMP_RAD = 0.05;
const SWEEP_LASER_MID_PAUSE_WIGGLE_PERIOD_SEC = 0.2;
const SWEEP_LASER_MID_PAUSE_ARROW_OFFSET = 80;
const SWEEP_LASER_MID_PAUSE_ARROW_SIZE = 14;
const SWEEP_LASER_MID_PAUSE_ARROW_SCALE_MIN = 0.8;
const SWEEP_LASER_MID_PAUSE_ARROW_SCALE_MAX = 1.4;
const SWEEP_LASER_MID_PAUSE_ARROW_PULSE_PERIOD_SEC = 0.25;
const SWEEP_LASER_MID_PAUSE_ARROW_FADE_IN_SEC = 0.1;
const SWEEP_LASER_MID_PAUSE_ARROW_FINAL_SEC = 0.1;
const SWEEP_LASER_MID_PAUSE_ARROW_FINAL_SCALE = 1.6;
const SWEEP_LASER_MID_PAUSE_SHAKE_PX = 2;
const SWEEP_LASER_MID_PAUSE_SHAKE_SEC = 0.1;
// Subtle white-to-cyan core shift so the return pass reads
// differently from the forward pass at a glance.
const SWEEP_LASER_RETURN_CORE_COLOR = "#aaeeff";

// === Charge attack — phase 3 only ===
// vanish: boss fades out at current position, implosion particles
// telegraph: appears at the arena edge, draws a fixed warning line
// rushing: linear dash across the arena along the line (2 HP on hit)
// recovery: body settles, glow ramps down to baseline
const CHARGE_VANISH_SEC = 0.35;
const CHARGE_TELEGRAPH_SEC = 0.9;
const CHARGE_RUSHING_SEC = 0.4;
const CHARGE_RECOVERY_SEC = 0.6;
const CHARGE_BASE_COOLDOWN_SEC = 9.0;
const CHARGE_HIT_RADIUS = 50;
const CHARGE_DAMAGE = 2;
// Player-position prediction window — at telegraph entry the boss
// captures `(player.vx, player.vy) * CHARGE_PLAYER_PREDICT_SEC` so
// the line aims at where the player WILL be by the time the dash
// lands. Player can outrun the prediction with a sideways dash.
const CHARGE_PLAYER_PREDICT_SEC = 0.6;
const CHARGE_VANISH_FADE_OUT_SEC = 0.25;
const CHARGE_TELEGRAPH_FADE_IN_SEC = 0.4;
const CHARGE_VANISH_PARTICLE_COUNT = 24;
const CHARGE_VANISH_PARTICLE_RADIUS = 80;
const CHARGE_VANISH_PARTICLE_SPEED_MIN = 200;
const CHARGE_VANISH_PARTICLE_SPEED_MAX = 300;
const CHARGE_VANISH_PARTICLE_LIFETIME_SEC = 0.25;
const CHARGE_VANISH_COLOR = "#ff2266";
const CHARGE_TELEGRAPH_OUTER_LW = 32;
const CHARGE_TELEGRAPH_OUTER_OPACITY = 0.1;
const CHARGE_TELEGRAPH_MID_LW = 18;
const CHARGE_TELEGRAPH_MID_OPACITY = 0.3;
const CHARGE_TELEGRAPH_CORE_LW = 6;
const CHARGE_TELEGRAPH_CORE_OPACITY = 0.7;
const CHARGE_TELEGRAPH_DASH_PATTERN: [number, number] = [12, 12];
const CHARGE_TELEGRAPH_DASH_RATE = 100;
const CHARGE_TELEGRAPH_OUTER_COLOR = "#ff2266";
const CHARGE_TELEGRAPH_CORE_COLOR = "#ff5577";
const CHARGE_TELEGRAPH_END_MARKER_PERIOD_SEC = 0.3;
const CHARGE_TELEGRAPH_END_MARKER_SCALE_MIN = 0.9;
const CHARGE_TELEGRAPH_END_MARKER_SCALE_MAX = 1.3;
const CHARGE_TELEGRAPH_END_MARKER_SIZE = 18;
const CHARGE_TELEGRAPH_ARROW_SIZE = 24;
// Final-flash window — last 200 ms of telegraph the line opacity
// strobes 5 times so the player can't miss the rushing entry.
const CHARGE_TELEGRAPH_FINAL_FLASH_SEC = 0.2;
const CHARGE_TELEGRAPH_FINAL_FLASH_PULSES = 5;
// Edge inset so chargeStart sits inside the arena (boss visible)
// rather than spawning behind the wall.
const CHARGE_EDGE_INSET = 10;
const CHARGE_TARGET_INSET = 30;
// Rushing visuals
const CHARGE_RUSHING_GHOST_LIFETIME_SEC = 0.3;
const CHARGE_RUSHING_GLOW_MUL = 1.4;
const CHARGE_RUSHING_WAKE_RATE_PER_SEC = 16;
const CHARGE_RUSHING_WAKE_LIFETIME_SEC = 0.4;
const CHARGE_RUSHING_WAKE_SPEED = 140;
const CHARGE_RUSHING_SHAKE_PX = 4;
const CHARGE_RUSHING_SHAKE_SEC = 0.1;
// Recovery flash ring spawned at rushing → recovery transition.
const CHARGE_RECOVERY_FLASH_R0 = 30;
const CHARGE_RECOVERY_FLASH_R1 = 200;
const CHARGE_RECOVERY_FLASH_LW0 = 5;
const CHARGE_RECOVERY_FLASH_LW1 = 0.5;
const CHARGE_RECOVERY_FLASH_LIFETIME_SEC = 0.5;

// === Mob spawn — phase 3 only ===
// Hunter spawn timer ticks in parallel with attacks (NOT subject to
// `isAnyAttackActive()` mutual exclusion). First spawn happens
// 4 s after phase-3 entry; subsequent spawns every 10 s, capped at
// 2 alive at once.
const MOB_SPAWN_FIRST_DELAY_SEC = 4.0;
const MOB_SPAWN_INTERVAL_SEC = 10.0;
const MOB_MAX_ALIVE = 2;
const MOB_SPAWN_RING_COLOR = "#cc4488";
const MOB_SPAWN_PARTICLE_COLOR = "#cc4488";
// Standard edge spawn (700 ms ring + 12 particles).
const MOB_SPAWN_DURATION_SEC = 0.7;
const MOB_SPAWN_RING_R0 = 10;
const MOB_SPAWN_RING_R1 = 80;
const MOB_SPAWN_RING_LW0 = 3;
const MOB_SPAWN_RING_LW1 = 0.5;
const MOB_SPAWN_PARTICLE_COUNT = 12;
const MOB_SPAWN_PARTICLE_LIFETIME_SEC = 0.5;
const MOB_SPAWN_PARTICLE_SPEED_MIN = 150;
const MOB_SPAWN_PARTICLE_SPEED_MAX = 250;
const MOB_SPAWN_INSET_PX = 30;
// Dramatic phase-3-entry spawn — Hunter spat out of the boss centre
// with initial velocity, larger ring, more particles.
const MOB_DRAMATIC_DURATION_SEC = 0.9;
const MOB_DRAMATIC_RING_R1 = 140;
const MOB_DRAMATIC_RING_LW0 = 8;
const MOB_DRAMATIC_PARTICLE_COUNT = 24;
const MOB_DRAMATIC_PARTICLE_SPEED_MIN = 300;
const MOB_DRAMATIC_PARTICLE_SPEED_MAX = 450;
const MOB_DRAMATIC_INITIAL_SPEED = 300;

// Energy burst — fired on the radial-burst telegraph → firing
// transition. Two shockwave rings, a brief boss flash, and a
// streamer puff out the boss centre.
const BURST_FLASH_DURATION_SEC = 0.08;
const BURST_FLASH_PEAK_ALPHA = 0.4;
const BURST_SW1_LIFETIME_SEC = 0.35;
const BURST_SW1_R_START = 120;
const BURST_SW1_R_END = 220;
const BURST_SW1_LW_START = 8;
const BURST_SW1_LW_END = 1;
const BURST_SW1_COLOR = "#ff3344";
const BURST_SW2_DELAY_SEC = 0.05;
const BURST_SW2_LIFETIME_SEC = 0.5;
const BURST_SW2_R_START = 140;
const BURST_SW2_R_END = 260;
const BURST_SW2_LW_START = 4;
const BURST_SW2_LW_END = 0.5;
const BURST_SW2_COLOR = "#ffaa22";
const BURST_STREAMER_COUNT = 24;
const BURST_STREAMER_SPEED_MIN = 400;
const BURST_STREAMER_SPEED_MAX = 550;
const BURST_STREAMER_LIFETIME_SEC = 0.25;
const BURST_STREAMER_FADE_OUT_SEC = 0.1;
const BURST_STREAMER_LENGTH_PX = 18;
const BURST_STREAMER_LINE_WIDTH = 2.5;

function hexVerts(r: number): { x: number; y: number }[] {
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * (Math.PI / 3);
    verts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return verts;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Smooth start AND smooth end — used by the Ring Burst detach +
 *  reassemble lerps so the rings ease both into and out of motion
 *  instead of the easeOut/easeIn snap the first draft had. */
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function randomAngularVel(max: number): number {
  return (Math.random() * 2 - 1) * max;
}

function nextRingRetargetMs(): number {
  return (
    RING_RETARGET_MIN_MS +
    Math.random() * (RING_RETARGET_MAX_MS - RING_RETARGET_MIN_MS)
  );
}

/** Shortest signed angular difference (target − current) in
 *  [-π, π]. Used by the aimed-shot tracker so a chase across the
 *  ±π discontinuity goes the short way around (across the seam)
 *  instead of unwinding 2π through the far side. */
/** Draws a small filled isoceles triangle whose apex points at the
 *  eye centre. Used for the four reticle markers; `pointing`
 *  describes which direction the apex faces. */
function drawReticleTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  height: number,
  halfBase: number,
  pointing: "up" | "down" | "left" | "right",
): void {
  ctx.beginPath();
  switch (pointing) {
    case "down":
      ctx.moveTo(cx, cy + height);
      ctx.lineTo(cx - halfBase, cy);
      ctx.lineTo(cx + halfBase, cy);
      break;
    case "up":
      ctx.moveTo(cx, cy - height);
      ctx.lineTo(cx - halfBase, cy);
      ctx.lineTo(cx + halfBase, cy);
      break;
    case "left":
      ctx.moveTo(cx - height, cy);
      ctx.lineTo(cx, cy - halfBase);
      ctx.lineTo(cx, cy + halfBase);
      break;
    case "right":
      ctx.moveTo(cx + height, cy);
      ctx.lineTo(cx, cy - halfBase);
      ctx.lineTo(cx, cy + halfBase);
      break;
  }
  ctx.closePath();
  ctx.fill();
}

/** Linearly interpolate between two `#rrggbb` colours. Used by the
 *  phase-transition settle window so the boss's accent shifts
 *  rather than snapping. Falls back to `target` if either string
 *  doesn't parse. */
function lerpHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return to;
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return {
    r: (v >> 16) & 0xff,
    g: (v >> 8) & 0xff,
    b: v & 0xff,
  };
}

function shortestAngleDiff(target: number, current: number): number {
  const TWO_PI = Math.PI * 2;
  let d = (target - current) % TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  else if (d > Math.PI) d -= TWO_PI;
  return d;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Shortest distance from point (px, py) to the line segment
 *  (ax, ay) → (bx, by). Used by the Charge attack damage check —
 *  the segment is the boss's full dash path, hit radius is
 *  CHARGE_HIT_RADIUS. */
function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = ax + dx * t;
  const projY = ay + dy * t;
  return Math.hypot(px - projX, py - projY);
}

// Reusable empty-list sentinel for consumeSpawnedMobs() so the
// happy path (no mobs ready this frame) doesn't allocate.
const EMPTY_HUNTER_LIST: Hunter[] = [];

export type SentinelState =
  | "intro"
  | "idle"
  | "attacking"
  | "dying"
  | "defeated";

type AttackPhase = "idle" | "telegraph" | "firing" | "recovery";

// Sweep Laser carries extra sub-phases for the double-pass cycle:
// firing-1 (forward) → mid-pause (held at end-angle, still damaging)
// → firing-2 (return). Telegraph + recovery bookend the cycle.
type SweepPhase =
  | "idle"
  | "telegraph"
  | "firing-1"
  | "mid-pause"
  | "firing-2"
  | "recovery";

// Pink residue painted behind the moving beam — captured each frame
// of the firing window, ages out over `SWEEP_TRAIL_MAX_AGE_SEC`.
type SweepTrailEntry = { angle: number; age: number };

// Charge attack — phase 3 signature. vanish + telegraph are the
// "wind-up", rushing is the actual dash, recovery is the
// "follow-through" before the boss can act again.
type ChargePhase =
  | "idle"
  | "vanish"
  | "telegraph"
  | "rushing"
  | "recovery";

// Boss-spawned Hunter request. Created via spawnHunter() with the
// timer ticking up to `duration`; once it expires the Hunter is
// instantiated at (x, y) (with optional initial velocity for the
// dramatic phase-3-entry spawn) and pushed into pendingSpawnedMobs
// for rooms-game to consume.
type PendingSpawnRequest = {
  x: number;
  y: number;
  timer: number;
  duration: number;
  initialVx: number;
  initialVy: number;
};

// Ghost silhouette painted along the dash path during rushing —
// fading afterimage of the boss body.
type ChargeGhostFrame = { x: number; y: number; age: number };

type RingBurstPhase =
  | "idle"
  | "telegraph"
  | "detach"
  | "vulnerable"
  | "reassemble"
  | "recovery";

type DyingFragment = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVel: number;
  age: number; // ms
};

export class Sentinel implements Enemy {
  readonly type: EnemyType = "sentinel";
  readonly color = SENTINEL_COLOR;
  x: number;
  y: number;
  hp: number;
  hitFlashTime = 0;
  knockbackTime = 0;
  knockbackDuration = 0;
  knockbackPeakX = 0;
  knockbackPeakY = 0;
  dropsKey = false;
  hitboxRadius = SENTINEL_HITBOX_RADIUS;
  hitByLaserId = 0;
  awarenessState: AwarenessState = "idle";
  detectionRadius = 0;
  alertTimer = 0;
  deAggroCooldownTimer = 0;
  vx = 0;
  vy = 0;

  // Boss state machine — public so rooms-game can read transitions.
  state: SentinelState = "intro";
  // ms since entry into the current state
  stateTimer = 0;
  /** Multiplier rooms-game applies to its dt. Sentinel drives this
   *  during dying so the world slows around the death cinematic. */
  timeScale = 1;
  /** Set by Sentinel each frame when it wants a one-shot screen
   *  shake; rooms-game polls + clears after applying. amount in px,
   *  duration in seconds. */
  pendingShakePx = 0;
  pendingShakeSec = 0;
  /** Set true on any frame the player's body overlaps the Sentinel's
   *  contact radius during combat states. rooms-game polls + clears
   *  it and dispatches a single `takeHit()`. Gated internally by
   *  `state in {idle, attacking}` and the player's dash-iframe so the
   *  flag only fires when the hit should actually count. */
  requestPlayerHit = false;
  /** Damage amount routed alongside `requestPlayerHit`. Defaults to
   *  1 HP for normal contact / RB ring / sweep beam; the Charge
   *  attack bumps it to 2 HP for the rushing impact. rooms-game
   *  reads this in `consumeSentinelEffects` and resets it back to 1. */
  requestedPlayerHitDamage = 1;

  // anim
  private rotation = 0;
  private fragmentRotation = 0;
  private pulsePhase = Math.random() * Math.PI * 2;
  private eyePulsePhase = Math.random() * Math.PI * 2;
  // Independent breath phases for the eye stack and the body shell —
  // different periods on purpose so the silhouette doesn't pulse "in
  // sync with itself."
  private eyeBreathPhase = Math.random() * Math.PI * 2;
  private bodyBreathPhase = Math.random() * Math.PI * 2;
  // Per-ring rotation state. angle accumulates current rotation,
  // angularVel lerps toward targetAngularVel until nextChangeAtMs
  // is hit, at which point a fresh target is sampled.
  private ringStates: {
    angle: number;
    angularVel: number;
    targetAngularVel: number;
    nextChangeAtMs: number;
  }[] = [
    { angle: 0, angularVel: 0, targetAngularVel: 0, nextChangeAtMs: 0 },
    { angle: 0, angularVel: 0, targetAngularVel: 0, nextChangeAtMs: 0 },
    { angle: 0, angularVel: 0, targetAngularVel: 0, nextChangeAtMs: 0 },
  ];
  private ringElapsedMs = 0;
  // Energy-burst transient state — boss flash overlay timer, the
  // delayed-spawn bookkeeping for the second shockwave, and the
  // local streamer list. Streamers live as line segments in world
  // space rather than in the global Particle pipeline so we can
  // honour the spec'd shape.
  private bossFlashTimer = 0;
  private pendingShockwave2DelayTimer = -1;
  private streamers: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    age: number;
    color: string;
  }[] = [];

  // movement — figure-8 around the arena centre
  private figurePhase = 0;
  private readonly arenaW: number;
  private readonly arenaH: number;
  // Active during the 1.5 s ease-in after Ring Burst recovery —
  // blends the lemniscate target from the frozen position to the
  // live curve point so the boss doesn't snap.
  private movementTransition: {
    fromX: number;
    fromY: number;
    elapsedSec: number;
  } | null = null;

  // Attack 1 — radial burst sub-state machine. radialIdleTimer
  // counts up only while no attack is active and only during
  // radialPhase === "idle"; reaching RADIAL_IDLE_GAP_SEC means the
  // attack is "ready". radialTimer is time in the current phase.
  private radialPhase: AttackPhase = "idle";
  private radialTimer = 0;
  private radialIdleTimer = 0;

  // Attack 2 — Aimed Shot Trio sub-state machine. Same shape as the
  // radial machine; lockX/Y/angle are captured at telegraph entry
  // and the line + bullets stay fixed (player must side-step off
  // the line).
  private aimedPhase: AttackPhase = "idle";
  private aimedTimer = 0;
  private aimedIdleTimer = 0;
  /** Live aim angle while telegraphing — chases the player at up
   *  to AIMED_MAX_ANGULAR_VEL each frame. Promoted to the firing
   *  angle the instant we transition out of telegraph. */
  private aimedTrackedAngle = 0;
  /** Frozen at telegraph → firing transition; bullets all fire
   *  along this angle. Set once and never updated during firing. */
  private aimedAngle = 0;
  private aimedShotsFired = 0;
  private aimedDashOffset = 0; // crawl offset for the dashed telegraph line
  /** Counts down through the post-telegraph "snap" confirm flash.
   *  While > 0, the aim line redraws solid + opaque so the player
   *  reads "the angle just locked, bullets coming." */
  private aimedSnapTimer = 0;
  /** Cached player position from the last update tick — used by
   *  renderAimedTelegraph to place the diamond on the player's
   *  current distance projected along the tracked angle. draw()
   *  doesn't get a player handle; we stash it instead. */
  private lastPlayerX = 0;
  private lastPlayerY = 0;

  // Attack 3 — Ring Burst sub-machine. Has the highest priority of
  // the three: when ringBurstPhase !== "idle", radial / aimed
  // timers freeze and don't tick. combatElapsedSec ticks across
  // every "idle" / "attacking" frame so the first RB has a 6 s
  // grace from fight start.
  private ringBurstPhase: RingBurstPhase = "idle";
  private rbTimer = 0;
  private rbCooldownTimer = 0;
  private combatElapsedSec = 0;
  // Live ring radii — match RB_RING_DEFAULT_* outside the burst,
  // lerp out during detach, hold expanded across vulnerable, lerp
  // back during reassemble.
  private ringRadiusOuter = RB_RING_DEFAULT_OUTER;
  private ringRadiusMid = RB_RING_DEFAULT_MID;
  private ringRadiusInner = RB_RING_DEFAULT_INNER;
  // Body opacity — full 1 outside the burst; ramps to 0.25 across
  // detach + holds through reassemble. Eye stack is drawn outside
  // this gate so the eye stays fully visible.
  private bodyOpacity = 1;
  // Eye visual amplification while vulnerable — gold rim alpha
  // multiplier and a faster pulse on top of the breath cycle.
  private eyeVulnerablePulsePhase = 0;
  // Hitstop on a successful eye hit — sets sentinel.timeScale low
  // for RB_EYE_HITSTOP_SEC so the impact reads as a single beat.
  private eyeHitstopTimer = 0;

  // === Phase / transition state ===
  bossPhase: 1 | 2 | 3 = 1;
  /** Active when a 1→2 or 2→3 cinematic is playing. While set,
   *  the boss is invulnerable, frozen, every attack timer is
   *  paused, and rooms-game's HP bar gets its phase marker flash
   *  via `phaseMarkerFlashTimer`. */
  phaseTransition: {
    elapsedMs: number;
    fromPhase: 1 | 2;
    toPhase: 2 | 3;
    /** True after the climax beat fires bossPhase++ + the boss
     *  roar so the cinematic ticker doesn't double-pop them. */
    climaxFired: boolean;
    /** Spawn-pacing accumulator so we drop one ring every
     *  PHASE_TRANSITION_RING_INTERVAL_MS through the build window. */
    ringEmitTimer: number;
  } | null = null;
  /** Counts down through PHASE_TRANSITION_HP_MARKER_FLASH_SEC after
   *  the climax beat fires. rooms-game polls + clears each frame
   *  to flash the corresponding HP-bar tick. -1 means the threshold
   *  hasn't fired yet, otherwise the seconds remaining. */
  phaseMarkerFlashTimer1to2 = -1;
  phaseMarkerFlashTimer2to3 = -1;

  // === Sweep Laser sub-state machine (phase 2+) ===
  private sweepLaserPhase: SweepPhase = "idle";
  private sweepLaserTimer = 0;
  private sweepLaserIdleTimer = 0;
  private sweepLaserStartAngle = 0;
  private sweepLaserDirection: 1 | -1 = 1;
  private sweepLaserDashOffset = 0;
  private sweepLaserBeamParticleTimer = 0;
  private sweepTrail: SweepTrailEntry[] = [];

  // === Charge attack (phase 3) ===
  private chargePhase: ChargePhase = "idle";
  private chargeTimer = 0;
  private chargeIdleTimer = 0;
  private chargeStartX = 0;
  private chargeStartY = 0;
  private chargeEndX = 0;
  private chargeEndY = 0;
  private chargeAngle = 0;
  // Crossing-detection latch for the once-per-vanish implosion.
  private chargeImplosionFired = false;
  private chargeGhostFrames: ChargeGhostFrame[] = [];
  private chargeWakeTimer = 0;
  // Fire-once flag for the rushing-entry shake (separate from the
  // wake timer so a slow first-frame dt can't double-trigger).
  private chargeRushingShakeFired = false;
  // Dedup the contact-damage flag so a single rushing pass deals
  // 2 HP exactly once even if the player overlaps the segment for
  // several frames before i-frames latch.
  private chargeHitLanded = false;

  // === Mob spawn (phase 3) ===
  private mobSpawnTimer = 0;
  private spawnedMobs: Hunter[] = [];
  private pendingSpawnedMobs: Hunter[] = [];
  private pendingSpawnRequests: PendingSpawnRequest[] = [];
  /** Set by tickPhaseTransitionCinematic on the climax fire of a
   *  2 → 3 transition. Drained at the next safe frame (post
   *  cinematic) so the dramatic spawn fires just as combat resumes
   *  rather than being absorbed by the frozen window. */
  private pendingDramaticMobSpawn = false;
  // Set true on a successful eye dash-through; tickRingBurst drains
  // it next frame so triggerEyeHitFeedback can fire with ctxRoom in
  // hand (tryDashDamage doesn't get ctxRoom in its signature).
  private pendingEyeHit = false;

  // Set when the player dashes through the (solid) body without
  // a valid eye hit — we owe them a whiff effect to telegraph
  // "body is invulnerable, wait for the eye." Same deferral
  // pattern as pendingEyeHit so the FX have ctxRoom.
  private pendingBodyWhiff: { x: number; y: number } | null = null;

  // damage / death
  private dashIdAlreadyDamaged = -1;
  // Whiffs dedupe per dash too; using a separate id keeps the
  // damage / whiff dedups independent (a dash that whiffs early
  // shouldn't lock out a later eye-hit if vulnerable opens, and
  // vice versa).
  private dashIdAlreadyWhiffed = -1;

  // intro one-shots
  private materializationSpawned = false;
  private introShakeFired = false;

  // dying state — fragments + which rings have exploded yet
  private fragments: DyingFragment[] = [];
  private outerExploded = false;
  private middleExploded = false;
  private innerExploded = false;
  private weakpointScale = 1;
  private weakpointGlowBlur = 22;
  /** Captured boss centre at the moment dying starts. The death
   *  cinematic anchors fragments + weakpoint + flash on this point
   *  rather than the live x/y so the boss doesn't drift while
   *  blowing up. */
  private deathX = 0;
  private deathY = 0;

  constructor(
    x: number,
    y: number,
    opts: { arenaW?: number; arenaH?: number } = {},
  ) {
    this.x = x;
    this.y = y;
    this.hp = SENTINEL_HP_MAX;
    // Arena bounds drive the figure-8 amplitude + safety clamp.
    // Defaulted to Room 5's 1600×1200 if room5.ts ever forgets to
    // pass them through.
    this.arenaW = opts.arenaW ?? DEFAULT_ARENA_W;
    this.arenaH = opts.arenaH ?? DEFAULT_ARENA_H;
    initAwareness(this, 0);
    // Always combat-active; we gate behaviour off `state`, not the
    // awareness machine.
    this.awarenessState = "aggro";
  }

  isDead(): boolean {
    return this.state === "defeated";
  }

  /** True when rooms-game should freeze player input + skip world
   *  sim. Boss intro and dying are cinematic moments — the player
   *  watches. */
  shouldFreezeWorld(): boolean {
    return this.state === "intro" || this.state === "dying";
  }

  takeDamage(amount: number): void {
    // Damage only lands during active combat. Intro and dying phases
    // are invulnerable cinematic windows; defeated is a no-op.
    // Phase-transition cinematic also gates incoming damage.
    if (this.state !== "idle" && this.state !== "attacking") return;
    if (this.phaseTransition) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.enterDying();
    }
  }

  update(ctxRoom: EnemyContext): void {
    // Sentinel uses unscaledDt (the real frame delta) for its own
    // state timer so the dying slow-mo doesn't slow the cinematic
    // itself recursively. EnemyContext.unscaledDt is set by
    // rooms-game; falls back to `dt` for any caller that hasn't
    // wired it through.
    const realDt = ctxRoom.unscaledDt ?? ctxRoom.dt;

    // Background animations — outer ring rotation, body pulse — keep
    // ticking outside dying/defeated so the boss feels alive even
    // during intro materialization.
    if (this.state !== "dying" && this.state !== "defeated") {
      this.rotation += ROTATION_RATE * realDt;
      this.fragmentRotation += FRAGMENT_ROTATION_RATE * realDt;
      this.pulsePhase += (Math.PI * 2 * realDt) / PULSE_PERIOD_SEC;
      this.eyePulsePhase +=
        (Math.PI * 2 * realDt) / EYE_PULSE_PERIOD_SEC;
      this.eyeBreathPhase +=
        (Math.PI * 2 * realDt) / EYE_BREATH_PERIOD_SEC;
      this.bodyBreathPhase +=
        (Math.PI * 2 * realDt) / BODY_BREATH_PERIOD_SEC;
      this.tickRingRotation(realDt);
      this.tickEnergyBurst(ctxRoom, realDt);
    }

    switch (this.state) {
      case "intro":
        this.updateIntro(ctxRoom, realDt);
        break;
      case "idle":
      case "attacking":
        this.updateCombat(ctxRoom, realDt);
        break;
      case "dying":
        this.updateDying(ctxRoom, realDt);
        break;
      case "defeated":
        // no-op; rooms-game shows Game Complete overlay
        break;
    }
  }

  // -------- intro --------

  private updateIntro(ctxRoom: EnemyContext, dt: number): void {
    this.stateTimer += dt * 1000;

    // Materialization particle burst — fires once at the moment the
    // boss starts becoming visible.
    if (
      !this.materializationSpawned &&
      this.stateTimer >= INTRO_FADE_END_MS
    ) {
      this.materializationSpawned = true;
      this.spawnMaterializationBurst(ctxRoom);
    }
    // 12 px screen shake on completion of the materialization scale.
    if (
      !this.introShakeFired &&
      this.stateTimer >= INTRO_MATERIALIZE_END_MS
    ) {
      this.introShakeFired = true;
      this.pendingShakePx = 12;
      this.pendingShakeSec = (INTRO_SHAKE_END_MS - INTRO_MATERIALIZE_END_MS) / 1000;
    }
    if (this.stateTimer >= INTRO_TOTAL_MS) {
      this.state = "idle";
      this.stateTimer = 0;
    }
  }

  private spawnMaterializationBurst(ctxRoom: EnemyContext): void {
    for (let i = 0; i < MATERIALIZE_PARTICLE_COUNT; i++) {
      const angle = (i / MATERIALIZE_PARTICLE_COUNT) * Math.PI * 2;
      const speed = 200 + Math.random() * 150;
      ctxRoom.particles.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        initialSize: 4,
        color: SENTINEL_COLOR,
        age: 0,
        lifetime: MATERIALIZE_PARTICLE_LIFETIME_MS / 1000,
        glowStrong: 12,
        glowSoft: 5,
        drag: 0.94,
      });
    }
  }

  // -------- combat (idle / attacking) --------

  private updateCombat(ctxRoom: EnemyContext, dt: number): void {
    // Marker flash timers always decay — they're transient HUD
    // visuals, independent of attack state.
    this.tickPhaseMarkerTimers(dt);
    // Drain any pending body-whiff request from the previous frame's
    // tryDashDamage. (Deferred so the FX have ctxRoom; same pattern
    // as pendingEyeHit.) Drains regardless of phase, so a whiff that
    // landed right before a phase transition still pops visually.
    if (this.pendingBodyWhiff) {
      this.spawnBodyWhiff(ctxRoom, this.pendingBodyWhiff);
      this.pendingBodyWhiff = null;
    }
    // Phase-transition cinematic preempts everything: sim freezes,
    // movement freezes, damage rejected, attacks paused. The
    // cinematic ticker drives the visuals + climax fire + end and
    // leaves `this.phaseTransition === null` once the 2 s window
    // closes.
    if (this.phaseTransition) {
      this.tickPhaseTransitionCinematic(ctxRoom, dt);
      return;
    }
    // Cache player position so renderAimedTelegraph can place the
    // diamond at the player's distance projection along the tracked
    // angle. draw() has no ctxRoom, so we stash it.
    this.lastPlayerX = ctxRoom.player.x;
    this.lastPlayerY = ctxRoom.player.y;
    // Figure-8 (lemniscate) around the arena centre — fully
    // independent of the player. amplitudes are inset by hitbox +
    // FIGURE_EIGHT_EDGE_PAD_PX so the path never crosses walls. dt
    // is in seconds — figurePhase walks the lemniscate at one full
    // loop every FIGURE_EIGHT_PERIOD_SEC.
    //
    // figurePhase keeps advancing even when Ring Burst freezes
    // movement, so when RB ends the boss lerps onto the *current*
    // curve point instead of resuming from where it stopped (which
    // would teleport-feel after the long vulnerable hold).
    this.figurePhase +=
      (Math.PI * 2 * dt) / FIGURE_EIGHT_PERIOD_SEC;
    // Movement is owned by the active attack when either Ring Burst
    // OR Charge is non-idle — both attacks lock the boss position
    // (RB freezes, Charge teleports + dashes). Figure-8 only ticks
    // when the boss is "free" between attacks.
    const movementOwnedByAttack =
      this.ringBurstPhase !== "idle" || this.chargePhase !== "idle";
    if (!movementOwnedByAttack) {
      const centerX = this.arenaW / 2;
      const centerY = this.arenaH / 2;
      const ampX = Math.max(
        0,
        this.arenaW / 2 - SENTINEL_HITBOX_RADIUS - FIGURE_EIGHT_EDGE_PAD_PX,
      );
      const ampY = Math.max(
        0,
        this.arenaH / 2 - SENTINEL_HITBOX_RADIUS - FIGURE_EIGHT_EDGE_PAD_PX,
      );
      const t = this.figurePhase;
      const trueTargetX = centerX + ampX * Math.sin(t);
      const trueTargetY = centerY + ampY * Math.sin(t) * Math.cos(t);
      // Post-Ring-Burst smooth resume — blend the target between
      // the frozen position and the live curve point so the boss
      // never teleports.
      let targetX = trueTargetX;
      let targetY = trueTargetY;
      if (this.movementTransition) {
        this.movementTransition.elapsedSec += dt;
        const u = Math.min(
          1,
          this.movementTransition.elapsedSec / MOVEMENT_TRANSITION_SEC,
        );
        const eased = easeInOutCubic(u);
        targetX =
          this.movementTransition.fromX +
          (trueTargetX - this.movementTransition.fromX) * eased;
        targetY =
          this.movementTransition.fromY +
          (trueTargetY - this.movementTransition.fromY) * eased;
        if (u >= 1) this.movementTransition = null;
      }
      // dt (seconds) * 60 reproduces "per-frame at 60 fps" semantics
      // so the lerp behaves the same regardless of frame rate.
      const lerp = POSITION_LERP_PER_FRAME * (dt * 60);
      this.x += (targetX - this.x) * lerp;
      this.y += (targetY - this.y) * lerp;
      // Hard clamp safety net — keeps body inside the arena even if
      // the path or lerp ever overshoots.
      const minX = SENTINEL_HITBOX_RADIUS;
      const maxX = this.arenaW - SENTINEL_HITBOX_RADIUS;
      const minY = SENTINEL_HITBOX_RADIUS;
      const maxY = this.arenaH - SENTINEL_HITBOX_RADIUS;
      if (this.x < minX) this.x = minX;
      else if (this.x > maxX) this.x = maxX;
      if (this.y < minY) this.y = minY;
      else if (this.y > maxY) this.y = maxY;
      this.vx = (targetX - this.x) * lerp * 60;
      this.vy = (targetY - this.y) * lerp * 60;
    } else {
      // Stationary across every Ring Burst phase. Velocity zeroed
      // so any future system reading vx/vy doesn't think the boss
      // is drifting.
      this.vx = 0;
      this.vy = 0;
    }

    // Track combat-state elapsed time so the first Ring Burst has
    // a grace period from the moment the player enters fight.
    this.combatElapsedSec += dt;

    // Eye-hitstop timer (Ring Burst eye-hit feedback). Always decays.
    if (this.eyeHitstopTimer > 0) {
      this.eyeHitstopTimer = Math.max(0, this.eyeHitstopTimer - dt);
      this.timeScale =
        this.eyeHitstopTimer > 0 ? RB_EYE_HITSTOP_TIMESCALE : 1;
    } else if (this.timeScale !== 1) {
      // Restore default in combat states (dying owns its own ramp).
      this.timeScale = 1;
    }

    // Aimed-shot snap-confirm flash decays unconditionally — it's a
    // transient visual, lives 80 ms after the telegraph locks.
    if (this.aimedSnapTimer > 0) {
      this.aimedSnapTimer = Math.max(0, this.aimedSnapTimer - dt);
    }

    // === 1. Progress whichever attack is currently in flight ===
    // Mutual exclusion guarantees at most one of these is non-idle,
    // so the call order is irrelevant. Each tick* short-circuits on
    // its own idle state — the cost of all five calls is a single
    // branch when nothing is firing.
    this.tickRingBurst(ctxRoom, dt);
    this.tickCharge(ctxRoom, dt);
    this.tickSweepLaser(ctxRoom, dt);
    this.tickRadialBurst(ctxRoom, dt);
    this.tickAimedShot(ctxRoom, dt);

    // === 2. Tick idle / cooldown timers — globally gated ===
    // While ANY attack is active, every other attack's cooldown
    // freezes. Symmetric replacement of the old "RB freezes radial
    // + aimed" rule — applies uniformly to all five attacks so a
    // long-running attack never lets others pile up readiness while
    // it's mid-flight (otherwise the next attack would fire instantly
    // on recovery end).
    if (!this.isAnyAttackActive()) {
      if (this.radialPhase === "idle") this.radialIdleTimer += dt;
      if (this.aimedPhase === "idle") this.aimedIdleTimer += dt;
      if (this.sweepLaserPhase === "idle") this.sweepLaserIdleTimer += dt;
      if (this.chargePhase === "idle") this.chargeIdleTimer += dt;
      if (this.ringBurstPhase === "idle" && this.rbCooldownTimer > 0) {
        this.rbCooldownTimer = Math.max(0, this.rbCooldownTimer - dt);
      }
    }

    // === 3. Try to start an attack — priority-ordered ===
    // Each tryStart* short-circuits if any attack is already active
    // (including one started earlier in this same call chain), so on
    // a tied cooldown expiry the first one in this list wins.
    // Priority: ring burst > charge > sweep > aimed > radial.
    // RB is the defining mechanic. Charge is the phase-3 panic
    // moment — beats sweep on a tied cooldown. Sweep is the
    // phase-2+ signature. Aimed is point threat. Radial is filler.
    this.tryStartRingBurst();
    this.tryStartCharge(ctxRoom);
    this.tryStartSweepLaser(ctxRoom);
    this.tryStartAimedShot(ctxRoom);
    this.tryStartRadialBurst();

    // === 4. Mob spawn — phase 3 only, NOT mutual-exclusion-gated.
    // Runs in parallel with attacks: a Hunter can pop in while
    // sweep is firing, while RB is vulnerable, etc. Phase transition
    // cinematic still freezes everything (we already early-returned
    // above when phaseTransition was non-null).
    this.tickMobSpawn(ctxRoom, dt);

    // Reflect activity back into the public state field — rooms-game
    // reads this for HP-bar visibility / kill-credit transitions.
    this.state = this.isAnyAttackActive() ? "attacking" : "idle";

    // Phase-transition trigger — checked AFTER attack state is
    // settled. Only fires when every sub-machine is idle (no attack
    // in flight) AND HP has crossed the matching threshold AND no
    // transition is already running. Stays out of the way if the
    // boss is mid-recovery; the next-frame check picks it up.
    this.maybeStartPhaseTransition();

    // Contact damage. Two paths:
    //   - body contact only fires when the boss is "solid" — RB
    //     idle / telegraph / recovery (not detach / vulnerable /
    //     reassemble where the body is ghosted).
    //   - ring contact only fires while the rings are detached —
    //     RB detach / vulnerable / reassemble. The hit window is a
    //     thin band around each ring's current radius padded by
    //     the player's half-size.
    const player = ctxRoom.player;
    if (player.dashIframeTime <= 0) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const distSq = dx * dx + dy * dy;
      const half = ctxRoom.playerHalfSize;
      if (this.bodyDamageActive()) {
        const r = SENTINEL_CONTACT_RADIUS + half;
        if (distSq < r * r) {
          this.requestPlayerHit = true;
        }
      }
      if (this.ringDamageActive()) {
        // Only the outer ring carries contact damage. Mid + inner
        // are visual-only during the burst — once the player is
        // inside the outer band they're free to roam toward the
        // eye. Reassemble still pushes the outer ring back through
        // a player who lingers in the 110..180 band.
        const dist = Math.sqrt(distSq);
        const band = RB_RING_STROKE_HIT_HALFWIDTH + half;
        if (Math.abs(dist - this.ringRadiusOuter) < band) {
          this.requestPlayerHit = true;
        }
      }
    }
  }

  // === Radial Burst — state-machine progression ===
  // Cooldown ticking + start gating handled by the central scheduler
  // in updateCombat (mutual exclusion across all four attacks).
  private tickRadialBurst(ctxRoom: EnemyContext, dt: number): void {
    if (this.radialPhase === "idle") return;
    this.radialTimer += dt;
    if (
      this.radialPhase === "telegraph" &&
      this.radialTimer >= RADIAL_TELEGRAPH_SEC
    ) {
      this.radialPhase = "firing";
      this.radialTimer = 0;
      this.fireRadialBurst(ctxRoom);
    } else if (
      this.radialPhase === "firing" &&
      this.radialTimer >= RADIAL_FIRING_SEC
    ) {
      this.radialPhase = "recovery";
      this.radialTimer = 0;
    } else if (
      this.radialPhase === "recovery" &&
      this.radialTimer >= RADIAL_RECOVERY_SEC
    ) {
      this.radialPhase = "idle";
      this.radialTimer = 0;
      // Hard floor — explicit zero so a stray dt overshoot never lets
      // the next attack fire on the very next frame.
      this.radialIdleTimer = 0;
    }
  }

  // === Aimed Shot — state-machine progression ===
  private tickAimedShot(ctxRoom: EnemyContext, dt: number): void {
    if (this.aimedPhase === "idle") return;
    this.aimedTimer += dt;
    if (this.aimedPhase === "telegraph") {
      // Crawl the dashed-line offset so the line reads "live".
      const span = AIMED_DASH_PATTERN[0] + AIMED_DASH_PATTERN[1];
      this.aimedDashOffset =
        (this.aimedDashOffset + AIMED_DASH_RATE * dt) % span;
      // Track the player at a capped angular velocity.
      const desired = Math.atan2(
        ctxRoom.player.y - this.y,
        ctxRoom.player.x - this.x,
      );
      const delta = shortestAngleDiff(desired, this.aimedTrackedAngle);
      const maxStep = AIMED_MAX_ANGULAR_VEL * dt;
      if (Math.abs(delta) > maxStep) {
        this.aimedTrackedAngle += Math.sign(delta) * maxStep;
      } else {
        this.aimedTrackedAngle = desired;
      }
      if (this.aimedTimer >= AIMED_TELEGRAPH_SEC) {
        // Lock the angle now — bullets all fire along this. The
        // snap-confirm flash tells the player "the angle just locked."
        this.aimedAngle = this.aimedTrackedAngle;
        this.aimedSnapTimer = AIMED_SNAP_DURATION_SEC;
        this.aimedPhase = "firing";
        this.aimedTimer = 0;
        this.aimedShotsFired = 0;
      }
    } else if (this.aimedPhase === "firing") {
      // Spawn each bullet as its scheduled offset is crossed.
      while (
        this.aimedShotsFired < AIMED_BULLET_COUNT &&
        this.aimedTimer >=
          this.aimedShotsFired * AIMED_BULLET_INTERVAL_SEC
      ) {
        this.fireAimedBullet(ctxRoom);
        this.aimedShotsFired += 1;
      }
      if (this.aimedTimer >= AIMED_FIRING_SEC) {
        this.aimedPhase = "recovery";
        this.aimedTimer = 0;
      }
    } else if (this.aimedPhase === "recovery") {
      if (this.aimedTimer >= AIMED_RECOVERY_SEC) {
        this.aimedPhase = "idle";
        this.aimedTimer = 0;
        this.aimedIdleTimer = 0;
      }
    }
  }

  // === Attack-start gates ===
  // Each tryStart* runs the cooldown / readiness check for its own
  // attack and short-circuits if any other attack is already active.
  // Called in priority order from updateCombat: ring burst > sweep >
  // aimed > radial. The first to fire wins on tied cooldown expiry,
  // and every later call sees `isAnyAttackActive() === true` and bails.
  private tryStartRingBurst(): void {
    if (this.isAnyAttackActive()) return;
    if (this.combatElapsedSec < RB_FIRST_GRACE_SEC) return;
    if (this.rbCooldownTimer > 0) return;
    this.beginRingBurstTelegraph();
  }

  private tryStartSweepLaser(ctxRoom: EnemyContext): void {
    if (this.isAnyAttackActive()) return;
    if (this.bossPhase < 2) return;
    const cadence = PHASE_CADENCE[this.bossPhase];
    if (
      this.sweepLaserIdleTimer < SWEEP_LASER_BASE_COOLDOWN_SEC * cadence
    ) {
      return;
    }
    this.beginSweepLaserTelegraph(ctxRoom);
  }

  private tryStartCharge(ctxRoom: EnemyContext): void {
    if (this.isAnyAttackActive()) return;
    if (this.bossPhase < 3) return;
    const cadence = PHASE_CADENCE[this.bossPhase];
    if (this.chargeIdleTimer < CHARGE_BASE_COOLDOWN_SEC * cadence) return;
    this.beginCharge(ctxRoom);
  }

  private beginCharge(_ctxRoom: EnemyContext): void {
    // Vanish phase only owns the boss's CURRENT position — the
    // chargeStart/End computation happens at the vanish → telegraph
    // transition (enterChargeTelegraph) so the prediction uses the
    // freshest player velocity.
    this.chargePhase = "vanish";
    this.chargeTimer = 0;
    this.chargeImplosionFired = false;
    this.chargeGhostFrames = [];
    this.chargeWakeTimer = 0;
    this.chargeRushingShakeFired = false;
    this.chargeHitLanded = false;
    this.bodyOpacity = 1;
  }

  private tryStartAimedShot(ctxRoom: EnemyContext): void {
    if (this.isAnyAttackActive()) return;
    const cadence = PHASE_CADENCE[this.bossPhase];
    if (this.aimedIdleTimer < AIMED_COOLDOWN_SEC * cadence) return;
    this.beginAimedShot(ctxRoom);
  }

  private tryStartRadialBurst(): void {
    if (this.isAnyAttackActive()) return;
    const cadence = PHASE_CADENCE[this.bossPhase];
    if (this.radialIdleTimer < RADIAL_IDLE_GAP_SEC * cadence) return;
    this.radialPhase = "telegraph";
    this.radialTimer = 0;
  }

  /** Body takes / deals contact damage during RB-idle, telegraph,
   *  recovery (and trivially when no RB is active). */
  /** Active accent colour for the body / outer ring / hex frame.
   *  Pinned to `ACCENT_PER_PHASE[bossPhase]` in normal play; during
   *  the settle window of a phase transition it lerps from the
   *  previous phase's accent to the new one over 500 ms so the
   *  hue shift reads as a slow morph rather than a snap. */
  private accentColor(): string {
    if (this.phaseTransition) {
      const t = this.phaseTransition;
      if (t.elapsedMs < PHASE_TRANSITION_CLIMAX_END_MS) {
        return ACCENT_PER_PHASE[t.fromPhase];
      }
      const span =
        PHASE_TRANSITION_SETTLE_END_MS - PHASE_TRANSITION_CLIMAX_END_MS;
      const u = Math.min(
        1,
        (t.elapsedMs - PHASE_TRANSITION_CLIMAX_END_MS) / span,
      );
      return lerpHex(
        ACCENT_PER_PHASE[t.fromPhase],
        ACCENT_PER_PHASE[t.toPhase],
        u,
      );
    }
    return ACCENT_PER_PHASE[this.bossPhase];
  }

  /** Mid-ring colour. Same lerp model as `accentColor()`. */
  private midRingColor(): string {
    if (this.phaseTransition) {
      const t = this.phaseTransition;
      if (t.elapsedMs < PHASE_TRANSITION_CLIMAX_END_MS) {
        return MID_RING_COLOR_PER_PHASE[t.fromPhase];
      }
      const span =
        PHASE_TRANSITION_SETTLE_END_MS - PHASE_TRANSITION_CLIMAX_END_MS;
      const u = Math.min(
        1,
        (t.elapsedMs - PHASE_TRANSITION_CLIMAX_END_MS) / span,
      );
      return lerpHex(
        MID_RING_COLOR_PER_PHASE[t.fromPhase],
        MID_RING_COLOR_PER_PHASE[t.toPhase],
        u,
      );
    }
    return MID_RING_COLOR_PER_PHASE[this.bossPhase];
  }

  private bodyDamageActive(): boolean {
    // Body is "solid" only when nothing weird is happening to its
    // shape. RB ghosting drops body collision; Charge owns its own
    // damage path (segment hit) and routes player damage there, so
    // the body itself doesn't contact-hit during vanish / telegraph
    // / rushing / recovery. Same gate also suppresses the dash
    // whiff during charge so it doesn't fire on a player who
    // happens to overlap the boss mid-cinematic.
    if (this.chargePhase !== "idle") return false;
    return (
      this.ringBurstPhase === "idle" ||
      this.ringBurstPhase === "telegraph" ||
      this.ringBurstPhase === "recovery"
    );
  }

  /** Rings touch / damage the player while they're detached —
   *  detach, vulnerable, reassemble. */
  private ringDamageActive(): boolean {
    return (
      this.ringBurstPhase === "detach" ||
      this.ringBurstPhase === "vulnerable" ||
      this.ringBurstPhase === "reassemble"
    );
  }

  private beginAimedShot(ctxRoom: EnemyContext): void {
    const { player } = ctxRoom;
    this.aimedPhase = "telegraph";
    this.aimedTimer = 0;
    this.aimedDashOffset = 0;
    // First-frame snap to the player so the line doesn't sweep in
    // from a stale angle. Subsequent telegraph frames track the
    // live player at a capped angular velocity.
    this.aimedTrackedAngle = Math.atan2(
      player.y - this.y,
      player.x - this.x,
    );
    this.aimedAngle = this.aimedTrackedAngle;
  }

  private fireRadialBurst(ctxRoom: EnemyContext): void {
    const speed = RADIAL_BURST_SPEED;
    for (let i = 0; i < RADIAL_BURST_COUNT; i++) {
      const a = (i / RADIAL_BURST_COUNT) * Math.PI * 2;
      ctxRoom.bullets.push(
        makeBullet(
          this.x,
          this.y,
          Math.cos(a) * speed,
          Math.sin(a) * speed,
          false,
        ),
      );
    }
    this.triggerEnergyBurst(ctxRoom);
  }

  private triggerEnergyBurst(ctxRoom: EnemyContext): void {
    // Shockwave 1 fires immediately into the shared rings list —
    // the existing ring renderer interpolates radius / line width /
    // alpha across age so we get the visual for free.
    ctxRoom.rings.push({
      x: this.x,
      y: this.y,
      age: 0,
      lifetime: BURST_SW1_LIFETIME_SEC,
      startR: BURST_SW1_R_START,
      endR: BURST_SW1_R_END,
      color: BURST_SW1_COLOR,
      startLineWidth: BURST_SW1_LW_START,
      endLineWidth: BURST_SW1_LW_END,
      glowBlur: 16,
    });
    // Shockwave 2 is delayed BURST_SW2_DELAY_SEC; parked on a
    // per-frame countdown that fires the ring once.
    this.pendingShockwave2DelayTimer = BURST_SW2_DELAY_SEC;
    // Boss flash — additive white overlay on the body for ~80ms.
    this.bossFlashTimer = BURST_FLASH_DURATION_SEC;
    // Streamers — kept on the boss instance because they're line
    // segments, not the circles the global Particle pipeline draws.
    for (let i = 0; i < BURST_STREAMER_COUNT; i++) {
      const a =
        (i / BURST_STREAMER_COUNT) * Math.PI * 2 +
        Math.random() * 0.05;
      const speed =
        BURST_STREAMER_SPEED_MIN +
        Math.random() *
          (BURST_STREAMER_SPEED_MAX - BURST_STREAMER_SPEED_MIN);
      this.streamers.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        color: i % 2 === 0 ? "#ffffff" : "#ff5577",
      });
    }
  }

  private tickRingRotation(dt: number): void {
    this.ringElapsedMs += dt * 1000;
    const depths: RingDepth[] = [
      OUTER_RING_DEPTH,
      MID_RING_DEPTH,
      INNER_RING_DEPTH,
    ];
    for (let i = 0; i < this.ringStates.length; i++) {
      const r = this.ringStates[i];
      const d = depths[i];
      // First-time init — schedule the first retarget so the ring
      // doesn't start motionless until the timer fires.
      if (r.nextChangeAtMs === 0) {
        r.targetAngularVel = randomAngularVel(d.maxAngularVel);
        r.nextChangeAtMs = this.ringElapsedMs + nextRingRetargetMs();
      }
      // Retarget on timer.
      if (this.ringElapsedMs >= r.nextChangeAtMs) {
        r.targetAngularVel = randomAngularVel(d.maxAngularVel);
        r.nextChangeAtMs = this.ringElapsedMs + nextRingRetargetMs();
      }
      // Smooth easing toward target so velocity changes don't jerk.
      r.angularVel +=
        (r.targetAngularVel - r.angularVel) * RING_ANGULAR_VEL_LERP;
      r.angle += r.angularVel * dt;
    }
  }

  private tickEnergyBurst(ctxRoom: EnemyContext, dt: number): void {
    if (this.bossFlashTimer > 0) {
      this.bossFlashTimer = Math.max(0, this.bossFlashTimer - dt);
    }
    if (this.pendingShockwave2DelayTimer >= 0) {
      this.pendingShockwave2DelayTimer -= dt;
      if (this.pendingShockwave2DelayTimer <= 0) {
        this.pendingShockwave2DelayTimer = -1;
        ctxRoom.rings.push({
          x: this.x,
          y: this.y,
          age: 0,
          lifetime: BURST_SW2_LIFETIME_SEC,
          startR: BURST_SW2_R_START,
          endR: BURST_SW2_R_END,
          color: BURST_SW2_COLOR,
          startLineWidth: BURST_SW2_LW_START,
          endLineWidth: BURST_SW2_LW_END,
          glowBlur: 12,
        });
      }
    }
    for (const s of this.streamers) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.age += dt;
    }
    if (this.streamers.length > 0) {
      this.streamers = this.streamers.filter(
        (s) => s.age < BURST_STREAMER_LIFETIME_SEC,
      );
    }
  }

  // === Ring Burst ===
  // State-machine progression only. Cooldown ticking + start gating
  // are handled by the central scheduler in updateCombat (mutual
  // exclusion across all four attacks).
  private tickRingBurst(ctxRoom: EnemyContext, dt: number): void {
    // Eye-hit feedback is deferred from tryDashDamage to here so we
    // have ctxRoom (rings + particles + audio). Drains regardless of
    // phase so a hit landing on the same frame as a transition still
    // resolves visually.
    if (this.pendingEyeHit) {
      this.pendingEyeHit = false;
      this.triggerEyeHitFeedback(ctxRoom);
    }
    if (this.ringBurstPhase === "idle") return;

    this.rbTimer += dt;
    switch (this.ringBurstPhase) {
      case "telegraph":
        if (this.rbTimer >= RB_TELEGRAPH_SEC) {
          this.enterRingBurstDetach(ctxRoom);
        }
        break;
      case "detach": {
        const t = Math.min(1, this.rbTimer / RB_DETACH_SEC);
        const eased = easeInOutCubic(t);
        this.ringRadiusOuter =
          RB_RING_DEFAULT_OUTER +
          (RB_RING_EXPANDED_OUTER - RB_RING_DEFAULT_OUTER) * eased;
        this.ringRadiusMid =
          RB_RING_DEFAULT_MID +
          (RB_RING_EXPANDED_MID - RB_RING_DEFAULT_MID) * eased;
        this.ringRadiusInner =
          RB_RING_DEFAULT_INNER +
          (RB_RING_EXPANDED_INNER - RB_RING_DEFAULT_INNER) * eased;
        this.bodyOpacity = 1 - (1 - RB_BODY_OPACITY_GHOSTED) * eased;
        if (this.rbTimer >= RB_DETACH_SEC) {
          this.ringRadiusOuter = RB_RING_EXPANDED_OUTER;
          this.ringRadiusMid = RB_RING_EXPANDED_MID;
          this.ringRadiusInner = RB_RING_EXPANDED_INNER;
          this.bodyOpacity = RB_BODY_OPACITY_GHOSTED;
          this.ringBurstPhase = "vulnerable";
          this.rbTimer = 0;
          // Attention pulse — single golden ring expanding from the
          // eye outward, snaps the player's attention to the boss
          // centre at the moment the eye becomes a target.
          ctxRoom.rings.push({
            x: this.x,
            y: this.y,
            age: 0,
            lifetime: RB_ATTENTION_PULSE_LIFETIME_SEC,
            startR: RB_ATTENTION_PULSE_R0,
            endR: RB_ATTENTION_PULSE_R1,
            color: RB_ATTENTION_PULSE_COLOR,
            startLineWidth: RB_ATTENTION_PULSE_LW0,
            endLineWidth: RB_ATTENTION_PULSE_LW1,
            glowBlur: 18,
          });
        }
        break;
      }
      case "vulnerable":
        // Eye gold-rim pulse phase advances on real dt so the
        // pulse cadence is steady regardless of timeScale.
        this.eyeVulnerablePulsePhase +=
          (Math.PI * 2 * dt) / RB_EYE_VULNERABLE_SCALE_PERIOD_SEC;
        if (this.rbTimer >= RB_VULNERABLE_SEC) {
          this.ringBurstPhase = "reassemble";
          this.rbTimer = 0;
        }
        break;
      case "reassemble": {
        const t = Math.min(1, this.rbTimer / RB_REASSEMBLE_SEC);
        const eased = easeInOutCubic(t);
        this.ringRadiusOuter =
          RB_RING_EXPANDED_OUTER +
          (RB_RING_DEFAULT_OUTER - RB_RING_EXPANDED_OUTER) * eased;
        this.ringRadiusMid =
          RB_RING_EXPANDED_MID +
          (RB_RING_DEFAULT_MID - RB_RING_EXPANDED_MID) * eased;
        this.ringRadiusInner =
          RB_RING_EXPANDED_INNER +
          (RB_RING_DEFAULT_INNER - RB_RING_EXPANDED_INNER) * eased;
        this.bodyOpacity =
          RB_BODY_OPACITY_GHOSTED +
          (1 - RB_BODY_OPACITY_GHOSTED) * eased;
        if (this.rbTimer >= RB_REASSEMBLE_SEC) {
          this.ringRadiusOuter = RB_RING_DEFAULT_OUTER;
          this.ringRadiusMid = RB_RING_DEFAULT_MID;
          this.ringRadiusInner = RB_RING_DEFAULT_INNER;
          this.bodyOpacity = 1;
          this.ringBurstPhase = "recovery";
          this.rbTimer = 0;
        }
        break;
      }
      case "recovery":
        if (this.rbTimer >= RB_RECOVERY_SEC) {
          this.ringBurstPhase = "idle";
          this.rbTimer = 0;
          // Hard floor — Math.max guards the (theoretical) edge case
          // where the cooldown timer carried negative slack into the
          // reset, ensuring a minimum full cooldown between two
          // consecutive Ring Bursts.
          const freshCooldown =
            RB_COOLDOWN_SEC * PHASE_CADENCE[this.bossPhase];
          this.rbCooldownTimer = Math.max(
            freshCooldown,
            this.rbCooldownTimer,
          );
          // Smooth re-entry to figure-8: snapshot the frozen
          // position so the movement update can blend to the
          // live curve point. Skipped if the boss died during RB
          // (state would already be "dying" or "defeated").
          if (
            this.state === "idle" ||
            this.state === "attacking"
          ) {
            this.movementTransition = {
              fromX: this.x,
              fromY: this.y,
              elapsedSec: 0,
            };
          }
        }
        break;
    }
  }

  private beginRingBurstTelegraph(): void {
    this.ringBurstPhase = "telegraph";
    this.rbTimer = 0;
    // Telegraph audio cue — reuse alert ping shifted to feel
    // bigger; full layered sound is a follow-up.
    audio.play.alert();
  }

  private enterRingBurstDetach(ctxRoom: EnemyContext): void {
    this.ringBurstPhase = "detach";
    this.rbTimer = 0;
    // Ring-shaped white shockwave + radial particle spray at the
    // moment the rings leave the body.
    ctxRoom.rings.push({
      x: this.x,
      y: this.y,
      age: 0,
      lifetime: RB_DETACH_RING_LIFETIME_SEC,
      startR: RB_DETACH_RING_START_R,
      endR: RB_DETACH_RING_END_R,
      color: "#ffffff",
      startLineWidth: 4,
      endLineWidth: 1,
      glowBlur: 14,
    });
    for (let i = 0; i < RB_DETACH_PARTICLE_COUNT; i++) {
      const a = (i / RB_DETACH_PARTICLE_COUNT) * Math.PI * 2;
      const speed =
        RB_DETACH_PARTICLE_SPEED_MIN +
        Math.random() *
          (RB_DETACH_PARTICLE_SPEED_MAX - RB_DETACH_PARTICLE_SPEED_MIN);
      ctxRoom.particles.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        initialSize: 4,
        color: "#ffffff",
        age: 0,
        lifetime: RB_DETACH_PARTICLE_LIFETIME_SEC,
        glowStrong: 12,
        glowSoft: 5,
        drag: 0.94,
      });
    }
    audio.play.bulletBreak();
  }

  /** Eye reward feedback. Spawns the heavy double ring + 24
   *  particles, requests an 8 px shake, kicks the hitstop. The
   *  3 HP damage to the boss is applied by the caller via
   *  takeDamage(RB_EYE_HIT_DAMAGE) right after this fires. */
  private triggerEyeHitFeedback(ctxRoom: EnemyContext): void {
    ctxRoom.rings.push({
      x: this.x,
      y: this.y,
      age: 0,
      lifetime: RB_EYE_HIT_INNER_RING_LIFETIME_SEC,
      startR: RB_EYE_HIT_INNER_RING_R0,
      endR: RB_EYE_HIT_INNER_RING_R1,
      color: "#ffffff",
      startLineWidth: 5,
      endLineWidth: 1,
      glowBlur: 20,
    });
    ctxRoom.rings.push({
      x: this.x,
      y: this.y,
      age: 0,
      lifetime: RB_EYE_HIT_OUTER_RING_LIFETIME_SEC,
      startR: RB_EYE_HIT_OUTER_RING_R0,
      endR: RB_EYE_HIT_OUTER_RING_R1,
      color: RB_EYE_HIT_OUTER_RING_COLOR,
      startLineWidth: 4,
      endLineWidth: 0.5,
      glowBlur: 18,
    });
    const total =
      RB_EYE_HIT_PARTICLE_COUNT_WHITE + RB_EYE_HIT_PARTICLE_COUNT_GOLD;
    for (let i = 0; i < total; i++) {
      const a = (i / total) * Math.PI * 2;
      const speed =
        RB_EYE_HIT_PARTICLE_SPEED_MIN +
        Math.random() *
          (RB_EYE_HIT_PARTICLE_SPEED_MAX -
            RB_EYE_HIT_PARTICLE_SPEED_MIN);
      ctxRoom.particles.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        initialSize: 4,
        color: i < RB_EYE_HIT_PARTICLE_COUNT_WHITE
          ? "#ffffff"
          : RB_EYE_HIT_OUTER_RING_COLOR,
        age: 0,
        lifetime: RB_EYE_HIT_PARTICLE_LIFETIME_SEC,
        glowStrong: 14,
        glowSoft: 5,
        drag: 0.94,
      });
    }
    this.pendingShakePx = RB_EYE_HIT_SHAKE_PX;
    this.pendingShakeSec = RB_EYE_HIT_SHAKE_SEC;
    this.eyeHitstopTimer = RB_EYE_HITSTOP_SEC;
    this.timeScale = RB_EYE_HITSTOP_TIMESCALE;
    audio.play.hitHeavy();
    audio.play.alert();
  }

  // === Phase transitions ===
  private tickPhaseMarkerTimers(dt: number): void {
    if (this.phaseMarkerFlashTimer1to2 > 0) {
      this.phaseMarkerFlashTimer1to2 = Math.max(
        0,
        this.phaseMarkerFlashTimer1to2 - dt,
      );
    }
    if (this.phaseMarkerFlashTimer2to3 > 0) {
      this.phaseMarkerFlashTimer2to3 = Math.max(
        0,
        this.phaseMarkerFlashTimer2to3 - dt,
      );
    }
  }

  /** Mutual exclusion gate. While any sub-state machine is in a
   *  non-idle phase, every other attack's cooldown freezes and no
   *  new attack can start (see tryStart* methods). The whole
   *  conflict-resolution layer is built on this single predicate so
   *  the rule is uniform across all four attacks. */
  private isAnyAttackActive(): boolean {
    return (
      this.radialPhase !== "idle" ||
      this.aimedPhase !== "idle" ||
      this.sweepLaserPhase !== "idle" ||
      this.ringBurstPhase !== "idle" ||
      this.chargePhase !== "idle"
    );
  }

  private allAttacksIdle(): boolean {
    return !this.isAnyAttackActive();
  }

  private maybeStartPhaseTransition(): void {
    if (this.phaseTransition) return;
    if (!this.allAttacksIdle()) return;
    if (this.bossPhase === 1 && this.hp <= PHASE_HP_BOUNDARY_1_TO_2) {
      this.phaseTransition = {
        elapsedMs: 0,
        fromPhase: 1,
        toPhase: 2,
        climaxFired: false,
        ringEmitTimer: 0,
      };
    } else if (this.bossPhase === 2 && this.hp <= PHASE_HP_BOUNDARY_2_TO_3) {
      this.phaseTransition = {
        elapsedMs: 0,
        fromPhase: 2,
        toPhase: 3,
        climaxFired: false,
        ringEmitTimer: 0,
      };
    }
  }

  /** Drives the 2 s cinematic. Called every frame while
   *  `this.phaseTransition !== null`; takes ctxRoom for ring +
   *  particle spawns. Body / ring rotation + breath continue to
   *  tick in `update()` above this so the boss visibly slows but
   *  doesn't freeze graphically. */
  private tickPhaseTransitionCinematic(
    ctxRoom: EnemyContext,
    dt: number,
  ): void {
    const t = this.phaseTransition;
    if (!t) return;
    const wasZero = t.elapsedMs === 0;
    t.elapsedMs += dt * 1000;

    // ---- timeScale ----
    if (t.elapsedMs < 100) {
      // Hitstop entry — fast 1 → 0.15 ramp.
      this.timeScale =
        1 + (PHASE_TRANSITION_HITSTOP_TIMESCALE - 1) * (t.elapsedMs / 100);
    } else if (t.elapsedMs < PHASE_TRANSITION_HITSTOP_END_MS) {
      this.timeScale = PHASE_TRANSITION_HITSTOP_TIMESCALE;
    } else if (t.elapsedMs < PHASE_TRANSITION_BUILD_END_MS) {
      const u =
        (t.elapsedMs - PHASE_TRANSITION_HITSTOP_END_MS) /
        (PHASE_TRANSITION_BUILD_END_MS - PHASE_TRANSITION_HITSTOP_END_MS);
      this.timeScale =
        PHASE_TRANSITION_HITSTOP_TIMESCALE +
        (PHASE_TRANSITION_BUILD_TIMESCALE -
          PHASE_TRANSITION_HITSTOP_TIMESCALE) *
          u;
    } else if (t.elapsedMs < PHASE_TRANSITION_CLIMAX_END_MS) {
      const u =
        (t.elapsedMs - PHASE_TRANSITION_BUILD_END_MS) /
        (PHASE_TRANSITION_CLIMAX_END_MS - PHASE_TRANSITION_BUILD_END_MS);
      this.timeScale =
        PHASE_TRANSITION_BUILD_TIMESCALE +
        (1 - PHASE_TRANSITION_BUILD_TIMESCALE) * u;
    } else {
      this.timeScale = 1;
    }

    // ---- Hitstop entry: single shake, on the first frame only ----
    if (wasZero) {
      this.pendingShakePx = PHASE_TRANSITION_HITSTOP_SHAKE_PX;
      this.pendingShakeSec = PHASE_TRANSITION_HITSTOP_SHAKE_SEC;
    }

    // ---- Build phase: emit a ring every interval + ramp shake ----
    if (
      t.elapsedMs >= PHASE_TRANSITION_HITSTOP_END_MS &&
      t.elapsedMs < PHASE_TRANSITION_BUILD_END_MS
    ) {
      t.ringEmitTimer += dt * 1000;
      if (t.ringEmitTimer >= PHASE_TRANSITION_RING_INTERVAL_MS) {
        t.ringEmitTimer -= PHASE_TRANSITION_RING_INTERVAL_MS;
        ctxRoom.rings.push({
          x: this.x,
          y: this.y,
          age: 0,
          lifetime: PHASE_TRANSITION_RING_LIFETIME_SEC,
          startR: PHASE_TRANSITION_RING_R0,
          endR: PHASE_TRANSITION_RING_R1,
          color: ACCENT_PER_PHASE[t.fromPhase],
          startLineWidth: 4,
          endLineWidth: 0.5,
          glowBlur: 14,
        });
      }
      const u =
        (t.elapsedMs - PHASE_TRANSITION_HITSTOP_END_MS) /
        (PHASE_TRANSITION_BUILD_END_MS - PHASE_TRANSITION_HITSTOP_END_MS);
      this.pendingShakePx =
        PHASE_TRANSITION_BUILD_SHAKE_MIN_PX +
        (PHASE_TRANSITION_BUILD_SHAKE_MAX_PX -
          PHASE_TRANSITION_BUILD_SHAKE_MIN_PX) *
          u;
      this.pendingShakeSec = dt;
    }

    // ---- Climax (1200 ms): bossPhase increment + heavy spawn ----
    if (!t.climaxFired && t.elapsedMs >= PHASE_TRANSITION_BUILD_END_MS) {
      t.climaxFired = true;
      this.bossPhase = t.toPhase;
      this.pendingShakePx = PHASE_TRANSITION_CLIMAX_SHAKE_PX;
      this.pendingShakeSec = PHASE_TRANSITION_CLIMAX_SHAKE_SEC;
      const half = PHASE_TRANSITION_CLIMAX_PARTICLE_COUNT / 2;
      const newAccent = ACCENT_PER_PHASE[t.toPhase];
      for (let i = 0; i < PHASE_TRANSITION_CLIMAX_PARTICLE_COUNT; i++) {
        const a =
          (i / PHASE_TRANSITION_CLIMAX_PARTICLE_COUNT) * Math.PI * 2;
        const speed =
          PHASE_TRANSITION_CLIMAX_PARTICLE_SPEED_MIN +
          Math.random() *
            (PHASE_TRANSITION_CLIMAX_PARTICLE_SPEED_MAX -
              PHASE_TRANSITION_CLIMAX_PARTICLE_SPEED_MIN);
        ctxRoom.particles.push({
          x: this.x,
          y: this.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          initialSize: 4,
          color: i < half ? "#ffffff" : newAccent,
          age: 0,
          lifetime: PHASE_TRANSITION_CLIMAX_PARTICLE_LIFETIME_SEC,
          glowStrong: 14,
          glowSoft: 5,
          drag: 0.94,
        });
      }
      audio.play.hitHeavy();
      audio.play.alert();
      if (t.toPhase === 2) {
        this.phaseMarkerFlashTimer1to2 = PHASE_TRANSITION_HP_MARKER_FLASH_SEC;
      } else {
        this.phaseMarkerFlashTimer2to3 = PHASE_TRANSITION_HP_MARKER_FLASH_SEC;
        // Phase-3 entry — queue a dramatic forced Hunter spawn from
        // the boss centre. Drained on the first non-frozen frame of
        // tickMobSpawn, so the spawn FX hit just as combat resumes.
        this.pendingDramaticMobSpawn = true;
        this.mobSpawnTimer = MOB_SPAWN_FIRST_DELAY_SEC;
      }
    }

    // ---- End of cinematic — clear flag, reset timeScale ----
    if (t.elapsedMs >= PHASE_TRANSITION_TOTAL_MS) {
      this.phaseTransition = null;
      this.timeScale = 1;
    }
  }

  // === Sweep Laser ===
  // Double-pass cycle: telegraph → firing-1 → mid-pause → firing-2 →
  // recovery → idle. Mid-pause is part of the damaging window — the
  // beam freezes at end-angle and flashes, signaling the reversal,
  // but anyone standing on that line still takes the hit.
  // State-machine progression only. Cooldown ticking + start gating
  // are handled by the central scheduler in updateCombat (mutual
  // exclusion across all four attacks).
  private tickSweepLaser(ctxRoom: EnemyContext, dt: number): void {
    if (this.sweepLaserPhase === "idle") return;

    this.sweepLaserTimer += dt;

    // Trail aging — runs every tick across telegraph / firing /
    // recovery so existing entries fade naturally regardless of
    // phase. New entries are pushed only during the firing window
    // (the beamActive block below).
    if (this.sweepTrail.length > 0) {
      for (const entry of this.sweepTrail) entry.age += dt;
      this.sweepTrail = this.sweepTrail.filter(
        (e) => e.age < SWEEP_TRAIL_MAX_AGE_SEC,
      );
    }

    if (this.sweepLaserPhase === "telegraph") {
      const span =
        SWEEP_LASER_TELEGRAPH_DASH_PATTERN[0] +
        SWEEP_LASER_TELEGRAPH_DASH_PATTERN[1];
      this.sweepLaserDashOffset =
        (this.sweepLaserDashOffset + SWEEP_LASER_TELEGRAPH_DASH_RATE * dt) %
        span;
      if (this.sweepLaserTimer >= SWEEP_LASER_TELEGRAPH_SEC) {
        this.sweepLaserPhase = "firing-1";
        this.sweepLaserTimer = 0;
        this.sweepLaserBeamParticleTimer = 0;
        // Clean slate for the trail — guards against any leftover
        // entries from a previous attack that didn't fully age out.
        this.sweepTrail = [];
      }
      return;
    }

    // Damage + particle emission shared across all three damaging
    // phases. currentSweepBeamAngle() handles the per-phase angle
    // math; the collision check itself is identical.
    const beamActive =
      this.sweepLaserPhase === "firing-1" ||
      this.sweepLaserPhase === "mid-pause" ||
      this.sweepLaserPhase === "firing-2";
    if (beamActive) {
      const player = ctxRoom.player;
      if (player.dashIframeTime <= 0) {
        const currentAngle = this.currentSweepBeamAngle();
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const playerAngle = Math.atan2(dy, dx);
        const diff = Math.abs(shortestAngleDiff(playerAngle, currentAngle));
        if (diff < SWEEP_LASER_BEAM_HIT_HALF_ANGLE) {
          this.requestPlayerHit = true;
        }
      }
      this.sweepLaserBeamParticleTimer += dt;
      while (
        this.sweepLaserBeamParticleTimer >=
        SWEEP_LASER_BEAM_PARTICLE_INTERVAL_SEC
      ) {
        this.sweepLaserBeamParticleTimer -=
          SWEEP_LASER_BEAM_PARTICLE_INTERVAL_SEC;
        const a = this.currentSweepBeamAngle();
        // Particles flip to cyan during the return pass so the
        // streaming energy carries the same colour cue as the core.
        const particleColor =
          this.sweepLaserPhase === "firing-2"
            ? SWEEP_LASER_RETURN_CORE_COLOR
            : "#ffffff";
        ctxRoom.particles.push({
          x: this.x,
          y: this.y,
          vx: Math.cos(a) * SWEEP_LASER_BEAM_PARTICLE_SPEED,
          vy: Math.sin(a) * SWEEP_LASER_BEAM_PARTICLE_SPEED,
          initialSize: 3,
          color: particleColor,
          age: 0,
          lifetime: SWEEP_LASER_BEAM_PARTICLE_LIFETIME_SEC,
          glowStrong: 10,
          glowSoft: 4,
          drag: 0.97,
        });
      }
      // Trail push — capture this frame's beam angle as fresh
      // residue. Mid-pause pushes pile up at the static end-angle
      // since `currentSweepBeamAngle()` returns the unwiggled value;
      // that intentional concentration reads as "the beam is
      // gathering itself" before the return.
      this.sweepTrail.push({
        angle: this.currentSweepBeamAngle(),
        age: 0,
      });
      if (this.sweepTrail.length > SWEEP_TRAIL_MAX_ENTRIES) {
        this.sweepTrail.splice(
          0,
          this.sweepTrail.length - SWEEP_TRAIL_MAX_ENTRIES,
        );
      }
    }

    if (this.sweepLaserPhase === "firing-1") {
      if (this.sweepLaserTimer >= SWEEP_LASER_FIRING_1_SEC) {
        this.sweepLaserPhase = "mid-pause";
        this.sweepLaserTimer = 0;
        // Reverse cue — small kinetic + audio confirmation that the
        // beam has stopped and is about to swing back. No drone
        // synth yet, so reuse the alert chirp; the boss-audio pass
        // will replace this with a swoosh + drone modulation.
        this.pendingShakePx = SWEEP_LASER_MID_PAUSE_SHAKE_PX;
        this.pendingShakeSec = SWEEP_LASER_MID_PAUSE_SHAKE_SEC;
        audio.play.alert();
      }
      return;
    }

    if (this.sweepLaserPhase === "mid-pause") {
      // Final-100ms countdown chirp — fires once when the timer
      // crosses (MID_PAUSE - FINAL) so the audio ramp peaks right
      // before firing-2 starts. Crossing detection uses
      // `prevTimer = sweepLaserTimer - dt` so we don't need a
      // dedicated boolean field.
      const finalChirpThreshold =
        SWEEP_LASER_MID_PAUSE_SEC - SWEEP_LASER_MID_PAUSE_ARROW_FINAL_SEC;
      if (
        this.sweepLaserTimer >= finalChirpThreshold &&
        this.sweepLaserTimer - dt < finalChirpThreshold
      ) {
        audio.play.alert();
      }
      if (this.sweepLaserTimer >= SWEEP_LASER_MID_PAUSE_SEC) {
        this.sweepLaserPhase = "firing-2";
        this.sweepLaserTimer = 0;
      }
      return;
    }

    if (this.sweepLaserPhase === "firing-2") {
      if (this.sweepLaserTimer >= SWEEP_LASER_FIRING_2_SEC) {
        this.sweepLaserPhase = "recovery";
        this.sweepLaserTimer = 0;
        // Release ring — short pink bloom at the boss centre as
        // visual punctuation that the attack just ended. Pairs
        // with the staged glow fade in renderSweepLaserBeam.
        // (Audio-side: the boss audio pass should later add an
        // exponential drone-gain ramp to 0 over SWEEP_LASER_
        // RECOVERY_OUTER_FADE_SEC; no continuous drone synth
        // exists yet to fade.)
        ctxRoom.rings.push({
          x: this.x,
          y: this.y,
          age: 0,
          lifetime: SWEEP_LASER_RELEASE_RING_LIFETIME_SEC,
          startR: SWEEP_LASER_RELEASE_RING_R_START,
          endR: SWEEP_LASER_RELEASE_RING_R_END,
          color: SWEEP_LASER_RELEASE_RING_COLOR,
          startLineWidth: SWEEP_LASER_RELEASE_RING_LW_START,
          endLineWidth: SWEEP_LASER_RELEASE_RING_LW_END,
          glowBlur: 12,
        });
      }
      return;
    }

    if (this.sweepLaserPhase === "recovery") {
      if (this.sweepLaserTimer >= SWEEP_LASER_RECOVERY_SEC) {
        this.sweepLaserPhase = "idle";
        this.sweepLaserTimer = 0;
        this.sweepLaserIdleTimer = 0;
      }
      return;
    }
  }

  private beginSweepLaserTelegraph(ctxRoom: EnemyContext): void {
    const player = ctxRoom.player;
    const playerAngle = Math.atan2(player.y - this.y, player.x - this.x);
    this.sweepLaserDirection = Math.random() < 0.5 ? 1 : -1;
    // Start 90° "before" the player along the rotation direction so
    // the 180° sweep crosses the player's quadrant.
    this.sweepLaserStartAngle =
      playerAngle - this.sweepLaserDirection * (Math.PI / 2);
    this.sweepLaserPhase = "telegraph";
    this.sweepLaserTimer = 0;
    this.sweepLaserDashOffset = 0;
    audio.play.alert();
  }

  /** Live beam angle. Read by the damage check, the particle
   *  emitter, and the render path so all three stay in sync.
   *  - firing-1: lerps `start → start + direction*π` over the pass.
   *  - mid-pause: held at `start + direction*π` (the end-angle).
   *  - firing-2: lerps the end-angle back to `start` (so direction
   *    of motion is `-direction`).
   *  - telegraph / recovery / idle: anchored at start (recovery
   *    freezes wherever firing-2 ended, which equals start angle).
   */
  private currentSweepBeamAngle(): number {
    const start = this.sweepLaserStartAngle;
    const direction = this.sweepLaserDirection;
    const endAngle = start + direction * Math.PI;
    if (this.sweepLaserPhase === "firing-1") {
      const t = Math.min(
        1,
        this.sweepLaserTimer / SWEEP_LASER_FIRING_1_SEC,
      );
      return start + direction * Math.PI * t;
    }
    if (this.sweepLaserPhase === "mid-pause") {
      // Static end-angle for damage / particle math. The visual
      // wiggle is added on top in the render path so it doesn't
      // bleed into the collision check (player on the static
      // end-angle line stays in the hit zone regardless of wiggle).
      return endAngle;
    }
    if (this.sweepLaserPhase === "firing-2") {
      const t = Math.min(
        1,
        this.sweepLaserTimer / SWEEP_LASER_FIRING_2_SEC,
      );
      return endAngle - direction * Math.PI * t;
    }
    return start;
  }

  // === Charge attack (phase 3) ===
  // Sub-state machine. Cooldown ticking + start gating handled by
  // the central scheduler in updateCombat. While non-idle, the
  // figure-8 movement is suppressed (movementOwnedByAttack); the
  // boss owns its own position throughout.
  private tickCharge(ctxRoom: EnemyContext, dt: number): void {
    if (this.chargePhase === "idle") return;
    this.chargeTimer += dt;

    // Age + cull ghost frames — runs every charge frame so they
    // dissolve naturally inside CHARGE_RUSHING_GHOST_LIFETIME_SEC
    // (recovery is shorter than that, so they're all gone before
    // the boss is allowed to act again).
    if (this.chargeGhostFrames.length > 0) {
      for (const g of this.chargeGhostFrames) g.age += dt;
      this.chargeGhostFrames = this.chargeGhostFrames.filter(
        (g) => g.age < CHARGE_RUSHING_GHOST_LIFETIME_SEC,
      );
    }

    if (this.chargePhase === "vanish") {
      // Body fade-out 1 → 0 over CHARGE_VANISH_FADE_OUT_SEC.
      const u = Math.min(1, this.chargeTimer / CHARGE_VANISH_FADE_OUT_SEC);
      this.bodyOpacity = 1 - u;
      // Implosion fires once near the start of vanish — particles
      // start on a circle of radius CHARGE_VANISH_PARTICLE_RADIUS and
      // travel inward toward the boss centre, hitting it about
      // when the body fully fades.
      if (!this.chargeImplosionFired) {
        this.chargeImplosionFired = true;
        for (let i = 0; i < CHARGE_VANISH_PARTICLE_COUNT; i++) {
          const a =
            (i / CHARGE_VANISH_PARTICLE_COUNT) * Math.PI * 2 +
            Math.random() * 0.1;
          const r = CHARGE_VANISH_PARTICLE_RADIUS;
          const sx = this.x + Math.cos(a) * r;
          const sy = this.y + Math.sin(a) * r;
          const speed =
            CHARGE_VANISH_PARTICLE_SPEED_MIN +
            Math.random() *
              (CHARGE_VANISH_PARTICLE_SPEED_MAX -
                CHARGE_VANISH_PARTICLE_SPEED_MIN);
          // Inward velocity: from particle position toward boss
          // centre. Negative direction along (cos a, sin a).
          ctxRoom.particles.push({
            x: sx,
            y: sy,
            vx: -Math.cos(a) * speed,
            vy: -Math.sin(a) * speed,
            initialSize: 3,
            color: CHARGE_VANISH_COLOR,
            age: 0,
            lifetime: CHARGE_VANISH_PARTICLE_LIFETIME_SEC,
            glowStrong: 10,
            glowSoft: 4,
            drag: 0.95,
          });
        }
        // Audio placeholder — reuse alert chirp; bossWarp synth
        // (filtered noise sweep) is a follow-up in the audio pass.
        audio.play.alert();
      }
      if (this.chargeTimer >= CHARGE_VANISH_SEC) {
        this.enterChargeTelegraph(ctxRoom);
      }
      return;
    }

    if (this.chargePhase === "telegraph") {
      // Body fade-in 0 → 1 over CHARGE_TELEGRAPH_FADE_IN_SEC, then
      // hold at 1 for the rest of telegraph.
      const u = Math.min(1, this.chargeTimer / CHARGE_TELEGRAPH_FADE_IN_SEC);
      this.bodyOpacity = u;
      if (this.chargeTimer >= CHARGE_TELEGRAPH_SEC) {
        this.chargePhase = "rushing";
        this.chargeTimer = 0;
        this.chargeRushingShakeFired = false;
        this.chargeHitLanded = false;
        this.chargeWakeTimer = 0;
        this.bodyOpacity = 1;
      }
      return;
    }

    if (this.chargePhase === "rushing") {
      // Boss position lerps linearly start → end over the rushing
      // window. Ghost trail captured each frame, wake particles
      // emitted at a fixed rate.
      const u = Math.min(1, this.chargeTimer / CHARGE_RUSHING_SEC);
      this.x =
        this.chargeStartX + (this.chargeEndX - this.chargeStartX) * u;
      this.y =
        this.chargeStartY + (this.chargeEndY - this.chargeStartY) * u;
      // Rushing-entry shake — fire once on the first rushing frame.
      if (!this.chargeRushingShakeFired) {
        this.chargeRushingShakeFired = true;
        this.pendingShakePx = CHARGE_RUSHING_SHAKE_PX;
        this.pendingShakeSec = CHARGE_RUSHING_SHAKE_SEC;
        // Heavy impact placeholder — bossCharge/BWOAH synth is a
        // follow-up. hitHeavy is the closest existing cue.
        audio.play.hitHeavy();
      }
      // Damage check — point-segment distance against the full
      // chargeStart→chargeEnd line. Latched once via
      // chargeHitLanded so a single rushing pass deals exactly
      // CHARGE_DAMAGE.
      if (!this.chargeHitLanded) {
        const player = ctxRoom.player;
        if (player.dashIframeTime <= 0) {
          const d = pointSegmentDistance(
            player.x,
            player.y,
            this.chargeStartX,
            this.chargeStartY,
            this.chargeEndX,
            this.chargeEndY,
          );
          if (d < CHARGE_HIT_RADIUS) {
            this.requestPlayerHit = true;
            this.requestedPlayerHitDamage = CHARGE_DAMAGE;
            this.chargeHitLanded = true;
          }
        }
      }
      // Ghost capture — every frame.
      this.chargeGhostFrames.push({ x: this.x, y: this.y, age: 0 });
      // Wake particles — fixed rate, perpendicular to chargeAngle
      // (so they fan out sideways from the trail).
      this.chargeWakeTimer += dt;
      const wakeInterval = 1 / CHARGE_RUSHING_WAKE_RATE_PER_SEC;
      while (this.chargeWakeTimer >= wakeInterval) {
        this.chargeWakeTimer -= wakeInterval;
        const sideAngle =
          this.chargeAngle +
          (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        ctxRoom.particles.push({
          x: this.x,
          y: this.y,
          vx: Math.cos(sideAngle) * CHARGE_RUSHING_WAKE_SPEED,
          vy: Math.sin(sideAngle) * CHARGE_RUSHING_WAKE_SPEED,
          initialSize: 3,
          color: CHARGE_VANISH_COLOR,
          age: 0,
          lifetime: CHARGE_RUSHING_WAKE_LIFETIME_SEC,
          glowStrong: 10,
          glowSoft: 4,
          drag: 0.95,
        });
      }
      if (this.chargeTimer >= CHARGE_RUSHING_SEC) {
        // Snap to exact end position so any sub-pixel slop is
        // resolved before recovery.
        this.x = this.chargeEndX;
        this.y = this.chargeEndY;
        this.chargePhase = "recovery";
        this.chargeTimer = 0;
        // Recovery flash — pink ring blooms from the boss centre.
        ctxRoom.rings.push({
          x: this.x,
          y: this.y,
          age: 0,
          lifetime: CHARGE_RECOVERY_FLASH_LIFETIME_SEC,
          startR: CHARGE_RECOVERY_FLASH_R0,
          endR: CHARGE_RECOVERY_FLASH_R1,
          color: CHARGE_TELEGRAPH_OUTER_COLOR,
          startLineWidth: CHARGE_RECOVERY_FLASH_LW0,
          endLineWidth: CHARGE_RECOVERY_FLASH_LW1,
          glowBlur: 14,
        });
      }
      return;
    }

    if (this.chargePhase === "recovery") {
      if (this.chargeTimer >= CHARGE_RECOVERY_SEC) {
        this.chargePhase = "idle";
        this.chargeTimer = 0;
        // Reset idle timer to 0 — it counts up toward
        // CHARGE_BASE_COOLDOWN_SEC * cadence in tryStartCharge,
        // so the wait between charges starts fresh from here.
        this.chargeIdleTimer = 0;
        // Smooth re-entry to figure-8: snapshot the frozen position
        // so the movement update can blend to the live curve point
        // (same MOVEMENT_TRANSITION_SEC easing as RB recovery).
        if (this.state === "idle" || this.state === "attacking") {
          this.movementTransition = {
            fromX: this.x,
            fromY: this.y,
            elapsedSec: 0,
          };
        }
      }
      return;
    }
  }

  private enterChargeTelegraph(ctxRoom: EnemyContext): void {
    // Compute end first (predicted player position), then start
    // (mirror across arena from end). Both are clamped inside the
    // arena so the boss is visible at the line's endpoints.
    const player = ctxRoom.player;
    const predictX = player.x + player.vx * CHARGE_PLAYER_PREDICT_SEC;
    const predictY = player.y + player.vy * CHARGE_PLAYER_PREDICT_SEC;
    const targetMin = SENTINEL_HITBOX_RADIUS + CHARGE_TARGET_INSET;
    const endX = clamp(predictX, targetMin, this.arenaW - targetMin);
    const endY = clamp(predictY, targetMin, this.arenaH - targetMin);
    // Direction from player to boss "edge spawn" — pick a normalized
    // back-vector and walk it out to the arena edge.
    const dx = this.x - endX;
    const dy = this.y - endY;
    let bx = dx;
    let by = dy;
    const m = Math.hypot(bx, by);
    if (m < 1) {
      // Old position is essentially on top of end — fall back to a
      // random direction so we don't divide by zero.
      const a = Math.random() * Math.PI * 2;
      bx = Math.cos(a);
      by = Math.sin(a);
    } else {
      bx /= m;
      by /= m;
    }
    // Walk out along (bx, by) until we hit a wall, capture that
    // intersection as chargeStart.
    const edgeMin = SENTINEL_HITBOX_RADIUS + CHARGE_EDGE_INSET;
    const edgeMaxX = this.arenaW - edgeMin;
    const edgeMaxY = this.arenaH - edgeMin;
    // Parametric ray: (endX + bx*t, endY + by*t). Find smallest
    // positive t that hits one of the four edge lines.
    const candidates: number[] = [];
    if (bx > 0.0001) candidates.push((edgeMaxX - endX) / bx);
    if (bx < -0.0001) candidates.push((edgeMin - endX) / bx);
    if (by > 0.0001) candidates.push((edgeMaxY - endY) / by);
    if (by < -0.0001) candidates.push((edgeMin - endY) / by);
    let t = Infinity;
    for (const c of candidates) {
      if (c > 0 && c < t) t = c;
    }
    if (!Number.isFinite(t)) t = 800;
    const startX = clamp(endX + bx * t, edgeMin, edgeMaxX);
    const startY = clamp(endY + by * t, edgeMin, edgeMaxY);

    this.chargeStartX = startX;
    this.chargeStartY = startY;
    this.chargeEndX = endX;
    this.chargeEndY = endY;
    this.chargeAngle = Math.atan2(endY - startY, endX - startX);
    this.x = startX;
    this.y = startY;
    this.chargePhase = "telegraph";
    this.chargeTimer = 0;
    this.bodyOpacity = 0;
    audio.play.alert();
  }

  // === Mob spawn (phase 3) ===
  private tickMobSpawn(ctxRoom: EnemyContext, dt: number): void {
    // Drain any deferred dramatic spawn left over from the phase
    // transition's climax (cinematic was frozen, so we couldn't
    // mutate ctxRoom from inside it cleanly).
    if (this.pendingDramaticMobSpawn) {
      this.pendingDramaticMobSpawn = false;
      this.spawnHunter(ctxRoom, true);
    }
    if (this.bossPhase === 3) {
      this.mobSpawnTimer -= dt;
      if (
        this.mobSpawnTimer <= 0 &&
        this.aliveSpawnedMobs() < MOB_MAX_ALIVE
      ) {
        this.spawnHunter(ctxRoom, false);
        this.mobSpawnTimer = MOB_SPAWN_INTERVAL_SEC;
      }
    }
    // Process pending spawn requests — instantiate the Hunter at
    // the end of the spawn animation so visuals (ring + particles)
    // play out before the enemy is real.
    if (this.pendingSpawnRequests.length > 0) {
      const stillPending: PendingSpawnRequest[] = [];
      for (const req of this.pendingSpawnRequests) {
        req.timer += dt;
        if (req.timer >= req.duration) {
          const hunter = new Hunter(req.x, req.y, {
            startsAggressive: true,
          });
          hunter.vx = req.initialVx;
          hunter.vy = req.initialVy;
          this.spawnedMobs.push(hunter);
          this.pendingSpawnedMobs.push(hunter);
        } else {
          stillPending.push(req);
        }
      }
      this.pendingSpawnRequests = stillPending;
    }
  }

  private aliveSpawnedMobs(): number {
    let n = 0;
    for (const m of this.spawnedMobs) if (!m.isDead()) n += 1;
    return n;
  }

  /** Spawn a Hunter — push the spawn ring + particles immediately
   *  to ctxRoom and queue a deferred Hunter instantiation that pops
   *  in once the visuals complete. `dramatic === true` upgrades the
   *  ring + particle counts and spawns from the boss centre with
   *  initial velocity (used only on phase-3 entry). */
  private spawnHunter(ctxRoom: EnemyContext, dramatic: boolean): void {
    let x: number;
    let y: number;
    let initialVx = 0;
    let initialVy = 0;
    if (dramatic) {
      x = this.x;
      y = this.y;
      const a = Math.random() * Math.PI * 2;
      initialVx = Math.cos(a) * MOB_DRAMATIC_INITIAL_SPEED;
      initialVy = Math.sin(a) * MOB_DRAMATIC_INITIAL_SPEED;
    } else {
      const inset = MOB_SPAWN_INSET_PX;
      const w = this.arenaW;
      const h = this.arenaH;
      const side = Math.floor(Math.random() * 4);
      switch (side) {
        case 0:
          x = inset + Math.random() * (w - 2 * inset);
          y = inset;
          break;
        case 1:
          x = w - inset;
          y = inset + Math.random() * (h - 2 * inset);
          break;
        case 2:
          x = inset + Math.random() * (w - 2 * inset);
          y = h - inset;
          break;
        default:
          x = inset;
          y = inset + Math.random() * (h - 2 * inset);
          break;
      }
    }
    const duration = dramatic
      ? MOB_DRAMATIC_DURATION_SEC
      : MOB_SPAWN_DURATION_SEC;
    const ringEndR = dramatic ? MOB_DRAMATIC_RING_R1 : MOB_SPAWN_RING_R1;
    const ringStartLW = dramatic ? MOB_DRAMATIC_RING_LW0 : MOB_SPAWN_RING_LW0;
    const particleCount = dramatic
      ? MOB_DRAMATIC_PARTICLE_COUNT
      : MOB_SPAWN_PARTICLE_COUNT;
    const speedMin = dramatic
      ? MOB_DRAMATIC_PARTICLE_SPEED_MIN
      : MOB_SPAWN_PARTICLE_SPEED_MIN;
    const speedMax = dramatic
      ? MOB_DRAMATIC_PARTICLE_SPEED_MAX
      : MOB_SPAWN_PARTICLE_SPEED_MAX;
    ctxRoom.rings.push({
      x,
      y,
      age: 0,
      lifetime: duration,
      startR: MOB_SPAWN_RING_R0,
      endR: ringEndR,
      color: MOB_SPAWN_RING_COLOR,
      startLineWidth: ringStartLW,
      endLineWidth: MOB_SPAWN_RING_LW1,
      glowBlur: 14,
    });
    for (let i = 0; i < particleCount; i++) {
      const a = (i / particleCount) * Math.PI * 2 + Math.random() * 0.2;
      const ps = speedMin + Math.random() * (speedMax - speedMin);
      ctxRoom.particles.push({
        x,
        y,
        vx: Math.cos(a) * ps,
        vy: Math.sin(a) * ps,
        initialSize: 3,
        color: MOB_SPAWN_PARTICLE_COLOR,
        age: 0,
        lifetime: MOB_SPAWN_PARTICLE_LIFETIME_SEC,
        glowStrong: 8,
        glowSoft: 4,
        drag: 0.92,
      });
    }
    audio.play.alert();
    this.pendingSpawnRequests.push({
      x,
      y,
      timer: 0,
      duration,
      initialVx,
      initialVy,
    });
  }

  /** Drained by rooms-game once per frame. Returns Hunters that
   *  finished their spawn animation this frame so they can be
   *  appended to `currentRoom.enemies`. */
  consumeSpawnedMobs(): Hunter[] {
    if (this.pendingSpawnedMobs.length === 0) return EMPTY_HUNTER_LIST;
    const out = this.pendingSpawnedMobs;
    this.pendingSpawnedMobs = [];
    // Periodic prune of the alive-tracker so it doesn't grow
    // unbounded across a long fight.
    if (this.spawnedMobs.length > 16) {
      this.spawnedMobs = this.spawnedMobs.filter((m) => !m.isDead());
    }
    return out;
  }

  private fireAimedBullet(ctxRoom: EnemyContext): void {
    const speed = AIMED_BULLET_SPEED;
    const cos = Math.cos(this.aimedAngle);
    const sin = Math.sin(this.aimedAngle);
    ctxRoom.bullets.push(
      makeBullet(this.x, this.y, cos * speed, sin * speed, false),
    );
    // Muzzle flash — small particle puff at the boss centre, random
    // directions so it reads as a "shot fired" cue without competing
    // with the bullet trajectory.
    for (let i = 0; i < AIMED_MUZZLE_PARTICLE_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const ps = 100 + Math.random() * 80;
      ctxRoom.particles.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(a) * ps,
        vy: Math.sin(a) * ps,
        initialSize: 3,
        color: SENTINEL_COLOR,
        age: 0,
        lifetime: AIMED_MUZZLE_PARTICLE_LIFETIME_SEC,
        glowStrong: 8,
        glowSoft: 3,
        drag: 0.92,
      });
    }
  }

  // -------- dying --------

  private enterDying(): void {
    this.state = "dying";
    this.stateTimer = 0;
    this.deathX = this.x;
    this.deathY = this.y;
    // Freeze any in-flight attack — telegraph / firing / recovery
    // beats stop cold so the death cinematic owns the audio/visual
    // focus.
    this.radialPhase = "idle";
    this.radialTimer = 0;
    this.radialIdleTimer = 0;
    this.aimedPhase = "idle";
    this.aimedTimer = 0;
    this.aimedIdleTimer = 0;
    this.aimedShotsFired = 0;
    // Clear any in-flight energy-burst remnants so they don't bleed
    // into the dying cinematic.
    this.bossFlashTimer = 0;
    this.pendingShockwave2DelayTimer = -1;
    this.streamers.length = 0;
    // Reset Ring Burst — rings snap back to default radii so the
    // dying cinematic renders the canonical silhouette and the
    // hitstop / pending eye-hit don't leak into death.
    this.ringBurstPhase = "idle";
    this.rbTimer = 0;
    this.rbCooldownTimer = 0;
    this.ringRadiusOuter = RB_RING_DEFAULT_OUTER;
    this.ringRadiusMid = RB_RING_DEFAULT_MID;
    this.ringRadiusInner = RB_RING_DEFAULT_INNER;
    this.bodyOpacity = 1;
    this.eyeHitstopTimer = 0;
    this.pendingEyeHit = false;
    this.pendingBodyWhiff = null;
    this.timeScale = 1;
    // Drop any pending movement-resume blend so the dying cinematic
    // owns the boss's position without a phantom lerp toward the
    // live curve point.
    this.movementTransition = null;
    // Cancel sweep laser too — beam wouldn't make sense post-death.
    this.sweepLaserPhase = "idle";
    this.sweepLaserTimer = 0;
    this.sweepLaserIdleTimer = 0;
    this.sweepTrail = [];
    // Charge — same idea: line / particles / ghost trail wouldn't
    // make sense once the boss is dying. Pending mob spawn requests
    // also drop (but already-instantiated mobs in spawnedMobs stay
    // alive so the player has to clean them up before VICTORY).
    this.chargePhase = "idle";
    this.chargeTimer = 0;
    this.chargeIdleTimer = 0;
    this.chargeGhostFrames = [];
    this.chargeImplosionFired = false;
    this.chargeRushingShakeFired = false;
    this.chargeHitLanded = false;
    this.pendingSpawnRequests = [];
    this.pendingDramaticMobSpawn = false;
    this.phaseTransition = null;
    this.phaseMarkerFlashTimer1to2 = -1;
    this.phaseMarkerFlashTimer2to3 = -1;
  }

  private updateDying(_ctxRoom: EnemyContext, dt: number): void {
    this.stateTimer += dt * 1000;
    const t = this.stateTimer;

    // ---- timeScale: 1.0 → 0.3 over first 200ms, hold at 0.3 until
    // 1000ms, then ease 0.3 → 1.0 across the weakpoint window.
    if (t < DYING_SLOWMO_RAMP_MS) {
      this.timeScale = 1 - 0.7 * (t / DYING_SLOWMO_RAMP_MS);
    } else if (t < DYING_SLOWMO_HOLD_END_MS) {
      this.timeScale = 0.3;
    } else if (t < DYING_WEAKPOINT_START_MS) {
      this.timeScale = 0.3;
    } else if (t < DYING_WEAKPOINT_END_MS) {
      const u =
        (t - DYING_WEAKPOINT_START_MS) /
        (DYING_WEAKPOINT_END_MS - DYING_WEAKPOINT_START_MS);
      this.timeScale = 0.3 + 0.7 * u;
    } else {
      this.timeScale = 1;
    }

    // Constant 4 px shake during the slow-mo hold; the user spec calls
    // for "screen shake 4px постоянный" through the slowmo window.
    if (t < DYING_SLOWMO_HOLD_END_MS) {
      this.pendingShakePx = 4;
      this.pendingShakeSec = dt; // refresh each frame
    }

    // ---- fragment spawns: outer / middle / inner at the spec'd
    // thresholds. Each ring spawns 6 fragments at the boss's death
    // position, flying out along that ring's hex-vertex angles.
    if (!this.outerExploded && t >= DYING_OUTER_EXPLODE_MS) {
      this.outerExploded = true;
      this.spawnRingFragments(110);
    }
    if (!this.middleExploded && t >= DYING_MIDDLE_EXPLODE_MS) {
      this.middleExploded = true;
      this.spawnRingFragments(85);
    }
    if (!this.innerExploded && t >= DYING_INNER_EXPLODE_MS) {
      this.innerExploded = true;
      this.spawnRingFragments(60);
    }

    // Fragments tick on REAL dt so the cinematic timing isn't
    // affected by timeScale.
    for (const f of this.fragments) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.angularVel * dt;
      f.age += dt * 1000;
    }
    this.fragments = this.fragments.filter(
      (f) => f.age < FRAGMENT_LIFETIME_MS,
    );

    // ---- weakpoint: scale 1 → 4, glow 20 → 60 across 2500..3000ms.
    if (t < DYING_WEAKPOINT_START_MS) {
      this.weakpointScale = 1;
      this.weakpointGlowBlur = 22;
    } else if (t < DYING_WEAKPOINT_END_MS) {
      const u =
        (t - DYING_WEAKPOINT_START_MS) /
        (DYING_WEAKPOINT_END_MS - DYING_WEAKPOINT_START_MS);
      this.weakpointScale = 1 + 3 * u;
      this.weakpointGlowBlur = 22 + 38 * u;
    } else {
      this.weakpointScale = 4;
      this.weakpointGlowBlur = 60;
    }

    if (t >= DYING_TOTAL_MS) {
      this.state = "defeated";
      this.stateTimer = 0;
      this.timeScale = 1;
    }
  }

  private spawnRingFragments(radius: number): void {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * (Math.PI / 3);
      // Spawn on the ring at its vertex angle, flying outward.
      const spawnX = this.deathX + Math.cos(a) * radius;
      const spawnY = this.deathY + Math.sin(a) * radius;
      const angularVel =
        (Math.random() * 2 - 1) * FRAGMENT_ANGULAR_VEL_RANGE;
      this.fragments.push({
        x: spawnX,
        y: spawnY,
        vx: Math.cos(a) * FRAGMENT_SPEED,
        vy: Math.sin(a) * FRAGMENT_SPEED,
        angle: a, // initial orientation — fragment is a short line
        angularVel,
        age: 0,
      });
    }
  }

  // -------- draw (world space) --------

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === "defeated") return;

    if (this.state === "intro") {
      this.renderIntro(ctx);
      return;
    }
    if (this.state === "dying") {
      this.renderDying(ctx);
      return;
    }
    // idle / attacking — aim-line first (so the body draws on top
    // of it), then the body, then the streamers (drawn last so they
    // sit on top of the boss silhouette). Sweep laser telegraph
    // sits underneath the body too; the firing beam goes ON TOP
    // (drawn after the body) so the bright core reads.
    if (this.aimedPhase === "telegraph") {
      this.renderAimedTelegraph(ctx);
    }
    if (this.aimedSnapTimer > 0) {
      this.renderAimedSnapFlash(ctx);
    }
    if (this.sweepLaserPhase === "telegraph") {
      this.renderSweepLaserTelegraph(ctx);
    }
    // Charge telegraph — drawn under the body so the body silhouette
    // sits on top of the warning line. Telegraph is the only Charge
    // phase whose visuals are independent of the body draw.
    if (this.chargePhase === "telegraph") {
      this.renderChargeTelegraph(ctx);
    }
    // Rushing ghost trail — drawn under the live body so the
    // brightest silhouette is the actual boss, not the afterimages.
    if (
      this.chargePhase === "rushing" &&
      this.chargeGhostFrames.length > 0
    ) {
      this.renderChargeGhosts(ctx);
    }
    this.renderBody(ctx, 1);
    if (
      this.sweepLaserPhase === "firing-1" ||
      this.sweepLaserPhase === "mid-pause" ||
      this.sweepLaserPhase === "firing-2" ||
      this.sweepLaserPhase === "recovery"
    ) {
      this.renderSweepLaserBeam(ctx);
    }
    if (this.streamers.length > 0) {
      this.renderStreamers(ctx);
    }
  }

  private renderChargeTelegraph(ctx: CanvasRenderingContext2D): void {
    const ax = this.chargeStartX;
    const ay = this.chargeStartY;
    const bx = this.chargeEndX;
    const by = this.chargeEndY;
    // Final-flash window — last CHARGE_TELEGRAPH_FINAL_FLASH_SEC of
    // telegraph the line opacity strobes 5x so the rushing entry is
    // impossible to miss.
    let opacityMul = 1;
    const finalStart =
      CHARGE_TELEGRAPH_SEC - CHARGE_TELEGRAPH_FINAL_FLASH_SEC;
    if (this.chargeTimer >= finalStart) {
      const u = Math.min(
        1,
        (this.chargeTimer - finalStart) / CHARGE_TELEGRAPH_FINAL_FLASH_SEC,
      );
      // Triangle wave at CHARGE_TELEGRAPH_FINAL_FLASH_PULSES tics
      // across the window — alpha bobs 0.7 ↔ 1.0.
      const phase = u * CHARGE_TELEGRAPH_FINAL_FLASH_PULSES * Math.PI * 2;
      opacityMul = 0.85 + 0.15 * ((Math.sin(phase) + 1) / 2);
    }
    // Outer / mid / core glow stack — same pattern as the sweep
    // beam. Drawn first so the markers (drawn next) paint on top.
    ctx.save();
    ctx.strokeStyle = CHARGE_TELEGRAPH_OUTER_COLOR;
    ctx.lineWidth = CHARGE_TELEGRAPH_OUTER_LW;
    ctx.globalAlpha = CHARGE_TELEGRAPH_OUTER_OPACITY * opacityMul;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.lineWidth = CHARGE_TELEGRAPH_MID_LW;
    ctx.globalAlpha = CHARGE_TELEGRAPH_MID_OPACITY * opacityMul;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    // Core dashed line — running offset for the "live" motion read.
    ctx.strokeStyle = CHARGE_TELEGRAPH_CORE_COLOR;
    ctx.lineWidth = CHARGE_TELEGRAPH_CORE_LW;
    ctx.globalAlpha = CHARGE_TELEGRAPH_CORE_OPACITY * opacityMul;
    ctx.setLineDash(CHARGE_TELEGRAPH_DASH_PATTERN);
    ctx.lineDashOffset =
      -((this.chargeTimer * CHARGE_TELEGRAPH_DASH_RATE) %
        (CHARGE_TELEGRAPH_DASH_PATTERN[0] +
          CHARGE_TELEGRAPH_DASH_PATTERN[1]));
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // End markers — pulsing diamond at chargeStart, arrow at
    // chargeEnd pointing along the dash direction.
    const pulsePhase =
      (this.chargeTimer * Math.PI * 2) /
      CHARGE_TELEGRAPH_END_MARKER_PERIOD_SEC;
    const pulse = (Math.sin(pulsePhase) + 1) / 2;
    const scale =
      CHARGE_TELEGRAPH_END_MARKER_SCALE_MIN +
      (CHARGE_TELEGRAPH_END_MARKER_SCALE_MAX -
        CHARGE_TELEGRAPH_END_MARKER_SCALE_MIN) *
        pulse;

    ctx.save();
    ctx.fillStyle = CHARGE_TELEGRAPH_OUTER_COLOR;
    ctx.shadowColor = CHARGE_TELEGRAPH_OUTER_COLOR;
    ctx.shadowBlur = 14;
    ctx.globalAlpha = opacityMul;
    // Diamond at chargeStart.
    const diamondSize = CHARGE_TELEGRAPH_END_MARKER_SIZE * scale;
    ctx.beginPath();
    ctx.moveTo(ax, ay - diamondSize);
    ctx.lineTo(ax + diamondSize, ay);
    ctx.lineTo(ax, ay + diamondSize);
    ctx.lineTo(ax - diamondSize, ay);
    ctx.closePath();
    ctx.fill();
    // Arrow at chargeEnd.
    const arrowSize = CHARGE_TELEGRAPH_ARROW_SIZE * scale;
    const ang = this.chargeAngle;
    const apexX = bx + Math.cos(ang) * arrowSize;
    const apexY = by + Math.sin(ang) * arrowSize;
    const sideA = ang + Math.PI - 0.5;
    const sideB = ang + Math.PI + 0.5;
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(
      bx + Math.cos(sideA) * arrowSize * 0.6,
      by + Math.sin(sideA) * arrowSize * 0.6,
    );
    ctx.lineTo(
      bx + Math.cos(sideB) * arrowSize * 0.6,
      by + Math.sin(sideB) * arrowSize * 0.6,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private renderChargeGhosts(ctx: CanvasRenderingContext2D): void {
    // Ghost silhouette = pink filled disc at the recorded position,
    // alpha + radius scale by remaining life. Cheaper than rendering
    // a full hex shell stack and reads as "afterimage" without
    // competing with the live body.
    ctx.save();
    ctx.fillStyle = CHARGE_TELEGRAPH_OUTER_COLOR;
    ctx.shadowColor = CHARGE_TELEGRAPH_OUTER_COLOR;
    ctx.shadowBlur = 18;
    for (const g of this.chargeGhostFrames) {
      const fade = 1 - g.age / CHARGE_RUSHING_GHOST_LIFETIME_SEC;
      if (fade <= 0) continue;
      ctx.globalAlpha = 0.4 * fade;
      const r = SENTINEL_HITBOX_RADIUS * (0.5 + 0.5 * fade);
      ctx.beginPath();
      ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderSweepLaserTelegraph(ctx: CanvasRenderingContext2D): void {
    const accent = this.accentColor();
    const startA = this.sweepLaserStartAngle;
    const direction = this.sweepLaserDirection;
    const endA = startA + direction * Math.PI;
    const reach = Math.hypot(this.arenaW, this.arenaH);
    // Sector preview — pulsing low-alpha fill so the player sees the
    // 180° quadrant the beam will sweep through. Drawn first so the
    // line + triangle render on top.
    const sectorPulse =
      SWEEP_LASER_ARC_ALPHA_MIN +
      ((Math.sin(
        (this.sweepLaserTimer * Math.PI * 2) /
          SWEEP_LASER_ARC_PULSE_PERIOD_SEC,
      ) +
        1) /
        2) *
        (SWEEP_LASER_ARC_ALPHA_MAX - SWEEP_LASER_ARC_ALPHA_MIN);
    ctx.save();
    ctx.fillStyle = accent;
    ctx.globalAlpha = sectorPulse;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    // arc() with anticlockwise depending on rotation direction so
    // the filled sector matches the actual sweep arc.
    ctx.arc(this.x, this.y, reach, startA, endA, direction < 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Start-angle dashed line — same colour family as aimed shot's
    // line but tracks the start of the sweep, not the player.
    const lineEndX = this.x + Math.cos(startA) * reach;
    const lineEndY = this.y + Math.sin(startA) * reach;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.setLineDash(SWEEP_LASER_TELEGRAPH_DASH_PATTERN);
    ctx.lineDashOffset = -this.sweepLaserDashOffset;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(lineEndX, lineEndY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Direction triangle — points along the rotation direction at a
    // fixed offset from the boss, gives the player a quick read of
    // CW vs CCW before the beam fires.
    const triBaseX = this.x + Math.cos(startA) * SWEEP_LASER_DIR_TRIANGLE_OFFSET;
    const triBaseY = this.y + Math.sin(startA) * SWEEP_LASER_DIR_TRIANGLE_OFFSET;
    // Tangent: rotate startA by direction*90° to get the apex direction.
    const tangentA = startA + direction * (Math.PI / 2);
    const apexX =
      triBaseX + Math.cos(tangentA) * SWEEP_LASER_DIR_TRIANGLE_SIZE * 1.2;
    const apexY =
      triBaseY + Math.sin(tangentA) * SWEEP_LASER_DIR_TRIANGLE_SIZE * 1.2;
    const sideA = startA + direction * (Math.PI / 2 + 0.6);
    const sideB = startA + direction * (Math.PI / 2 - 0.6);
    ctx.save();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(
      triBaseX + Math.cos(sideA) * SWEEP_LASER_DIR_TRIANGLE_SIZE * 0.5,
      triBaseY + Math.sin(sideA) * SWEEP_LASER_DIR_TRIANGLE_SIZE * 0.5,
    );
    ctx.lineTo(
      triBaseX + Math.cos(sideB) * SWEEP_LASER_DIR_TRIANGLE_SIZE * 0.5,
      triBaseY + Math.sin(sideB) * SWEEP_LASER_DIR_TRIANGLE_SIZE * 0.5,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private renderSweepLaserBeam(ctx: CanvasRenderingContext2D): void {
    const accent = this.accentColor();
    let a = this.currentSweepBeamAngle();
    // Mid-pause render-only wiggle — the prepared shot visually
    // "trembles" around the end-angle. The damage check uses the
    // unwiggled angle (currentSweepBeamAngle returns the static
    // end-angle in mid-pause), so wiggle never displaces collision.
    if (this.sweepLaserPhase === "mid-pause") {
      const wiggle =
        Math.sin(
          (this.sweepLaserTimer * Math.PI * 2) /
            SWEEP_LASER_MID_PAUSE_WIGGLE_PERIOD_SEC,
        ) * SWEEP_LASER_MID_PAUSE_WIGGLE_AMP_RAD;
      a += wiggle;
    }
    const reach = Math.hypot(this.arenaW, this.arenaH);

    // Trail (residue) — drawn first so the live beam paints on top.
    // Renders independently of the main-beam fade so it can outlive
    // the beam's outer-bloom layer if it has older entries.
    if (this.sweepTrail.length > 0) {
      this.renderSweepTrail(ctx, reach);
    }

    // Staged recovery fade — bloom dissipates last so the beam
    // reads as "cooling" rather than snapping off. Each layer has
    // its own duration + easing curve.
    let coreAlpha = 1;
    let midAlpha = 1;
    let outerAlpha = 1;
    if (this.sweepLaserPhase === "recovery") {
      const t = this.sweepLaserTimer;
      const cu = Math.min(1, t / SWEEP_LASER_RECOVERY_CORE_FADE_SEC);
      const mu = Math.min(1, t / SWEEP_LASER_RECOVERY_MID_FADE_SEC);
      const ou = Math.min(1, t / SWEEP_LASER_RECOVERY_OUTER_FADE_SEC);
      // easeOutQuad / easeOutCubic / easeOutQuart — 1 - u^n.
      coreAlpha = 1 - cu * cu;
      midAlpha = 1 - mu * mu * mu;
      outerAlpha = 1 - ou * ou * ou * ou;
    }
    if (coreAlpha <= 0 && midAlpha <= 0 && outerAlpha <= 0) {
      // Beam fully cooled — trail (if any) was already drawn above.
      return;
    }
    const endX = this.x + Math.cos(a) * reach;
    const endY = this.y + Math.sin(a) * reach;
    // Mid-pause breath — easeInOutSine 0 → 1 → 0 across the 800 ms
    // window. Slow inhale/exhale (sin(π·u) gives 0 → 1 → 0 with
    // eased shoulders); reads as "the beam is charging the return
    // shot." Skipped outside mid-pause.
    let breath = 0;
    if (this.sweepLaserPhase === "mid-pause") {
      const u = Math.min(
        1,
        this.sweepLaserTimer / SWEEP_LASER_MID_PAUSE_SEC,
      );
      breath = Math.sin(Math.PI * u);
    }
    const coreLineWidth =
      SWEEP_LASER_MID_PAUSE_CORE_LW_BASE +
      (SWEEP_LASER_MID_PAUSE_CORE_LW_PEAK -
        SWEEP_LASER_MID_PAUSE_CORE_LW_BASE) *
        breath;
    const outerGlowAlpha =
      SWEEP_LASER_MID_PAUSE_GLOW_ALPHA_BASE +
      (SWEEP_LASER_MID_PAUSE_GLOW_ALPHA_PEAK -
        SWEEP_LASER_MID_PAUSE_GLOW_ALPHA_BASE) *
        breath;
    // Cyan core during firing-2 — subtle "this is the return pass"
    // tell the player picks up via peripheral vision.
    const coreColor =
      this.sweepLaserPhase === "firing-2"
        ? SWEEP_LASER_RETURN_CORE_COLOR
        : "#ffffff";
    ctx.save();
    // Outer glow layer
    ctx.strokeStyle = accent;
    ctx.lineWidth = 24;
    ctx.globalAlpha = outerGlowAlpha * outerAlpha;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    // Mid layer
    ctx.lineWidth = 14;
    ctx.globalAlpha = 0.4 * midAlpha;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    // Hot core
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = coreLineWidth;
    ctx.globalAlpha = 1 * coreAlpha;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();

    // Reverse arrow — only during mid-pause. Sits along the static
    // beam at a fixed offset and points along the OPPOSITE rotation
    // direction so the player has half a beat to read which way the
    // beam is about to swing back.
    if (this.sweepLaserPhase === "mid-pause") {
      this.renderSweepReverseArrow(ctx, a);
    }
  }

  private renderSweepTrail(
    ctx: CanvasRenderingContext2D,
    reach: number,
  ): void {
    ctx.save();
    for (const entry of this.sweepTrail) {
      const fade = 1 - entry.age / SWEEP_TRAIL_MAX_AGE_SEC;
      if (fade <= 0) continue;
      const endX = this.x + Math.cos(entry.angle) * reach;
      const endY = this.y + Math.sin(entry.angle) * reach;
      // Outer fading bloom — softest, widest stroke.
      ctx.strokeStyle = SWEEP_TRAIL_OUTER_COLOR;
      ctx.lineWidth = SWEEP_TRAIL_BASE_LINEWIDTH * fade * 1.8;
      ctx.globalAlpha = SWEEP_TRAIL_BASE_OPACITY * fade * 0.4;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      // Mid trail — same colour, narrower, brighter.
      ctx.lineWidth = SWEEP_TRAIL_BASE_LINEWIDTH * fade;
      ctx.globalAlpha = SWEEP_TRAIL_BASE_OPACITY * fade * 0.7;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      // Hot inner residue — thin near-white core.
      ctx.strokeStyle = SWEEP_TRAIL_INNER_COLOR;
      ctx.lineWidth = SWEEP_TRAIL_BASE_LINEWIDTH * fade * 0.4;
      ctx.globalAlpha = SWEEP_TRAIL_BASE_OPACITY * fade;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderSweepReverseArrow(
    ctx: CanvasRenderingContext2D,
    beamAngle: number,
  ): void {
    const t = this.sweepLaserTimer;
    const total = SWEEP_LASER_MID_PAUSE_SEC;
    // Fade-in over the first 100 ms so the arrow doesn't pop on
    // mid-pause entry.
    const fadeIn = Math.min(
      1,
      t / SWEEP_LASER_MID_PAUSE_ARROW_FADE_IN_SEC,
    );
    // Continuous pulse — base scale oscillates between MIN and MAX
    // on a 250 ms period, independent of the breath. The 0.8 ↔ 1.4
    // range reads as "active prompt" without competing with the
    // beam's own breath.
    const pulsePhase =
      (t * Math.PI * 2) / SWEEP_LASER_MID_PAUSE_ARROW_PULSE_PERIOD_SEC;
    const pulse = (Math.sin(pulsePhase) + 1) / 2;
    let scale =
      SWEEP_LASER_MID_PAUSE_ARROW_SCALE_MIN +
      (SWEEP_LASER_MID_PAUSE_ARROW_SCALE_MAX -
        SWEEP_LASER_MID_PAUSE_ARROW_SCALE_MIN) *
        pulse;
    let alpha = fadeIn;
    // Final-100ms countdown — arrow blows up to ×1.6 and the
    // alpha snaps 1 → 0.4 → 1 so the player gets one last "GO" tick
    // before firing-2 starts.
    const finalStart = total - SWEEP_LASER_MID_PAUSE_ARROW_FINAL_SEC;
    if (t >= finalStart) {
      const u = Math.min(
        1,
        (t - finalStart) / SWEEP_LASER_MID_PAUSE_ARROW_FINAL_SEC,
      );
      scale = SWEEP_LASER_MID_PAUSE_ARROW_FINAL_SCALE;
      // Triangle wave 1 → 0.4 → 1 — fast strobe.
      alpha = u < 0.5 ? 1 - u * 1.2 : 0.4 + (u - 0.5) * 1.2;
    }
    if (alpha <= 0) return;
    const size = SWEEP_LASER_MID_PAUSE_ARROW_SIZE * scale;
    const baseX =
      this.x + Math.cos(beamAngle) * SWEEP_LASER_MID_PAUSE_ARROW_OFFSET;
    const baseY =
      this.y + Math.sin(beamAngle) * SWEEP_LASER_MID_PAUSE_ARROW_OFFSET;
    const reverseDir = (-this.sweepLaserDirection) as 1 | -1;
    const tangentA = beamAngle + reverseDir * (Math.PI / 2);
    const apexX = baseX + Math.cos(tangentA) * size * 1.2;
    const apexY = baseY + Math.sin(tangentA) * size * 1.2;
    const sideA = beamAngle + reverseDir * (Math.PI / 2 + 0.6);
    const sideB = beamAngle + reverseDir * (Math.PI / 2 - 0.6);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(
      baseX + Math.cos(sideA) * size * 0.5,
      baseY + Math.sin(sideA) * size * 0.5,
    );
    ctx.lineTo(
      baseX + Math.cos(sideB) * size * 0.5,
      baseY + Math.sin(sideB) * size * 0.5,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private renderStreamers(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.lineWidth = BURST_STREAMER_LINE_WIDTH;
    ctx.lineCap = "round";
    for (const s of this.streamers) {
      const fade =
        s.age > BURST_STREAMER_LIFETIME_SEC - BURST_STREAMER_FADE_OUT_SEC
          ? Math.max(
              0,
              1 -
                (s.age -
                  (BURST_STREAMER_LIFETIME_SEC - BURST_STREAMER_FADE_OUT_SEC)) /
                  BURST_STREAMER_FADE_OUT_SEC,
            )
          : 1;
      const speed = Math.hypot(s.vx, s.vy) || 1;
      const ux = s.vx / speed;
      const uy = s.vy / speed;
      ctx.globalAlpha = fade;
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(
        s.x - ux * BURST_STREAMER_LENGTH_PX,
        s.y - uy * BURST_STREAMER_LENGTH_PX,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private renderAimedTelegraph(ctx: CanvasRenderingContext2D): void {
    // Live tracked-angle line from boss centre out to the arena
    // edge. Angle updates each frame in update() at up to
    // AIMED_MAX_ANGULAR_VEL — a normal walk gets tracked, a late
    // sideways dash escapes.
    const dist = rayDistToArenaEdge(
      this.x,
      this.y,
      this.aimedTrackedAngle,
      this.arenaW,
      this.arenaH,
    );
    const endX = this.x + Math.cos(this.aimedTrackedAngle) * dist;
    const endY = this.y + Math.sin(this.aimedTrackedAngle) * dist;
    ctx.save();
    ctx.strokeStyle = SENTINEL_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash(AIMED_DASH_PATTERN);
    ctx.lineDashOffset = -this.aimedDashOffset;
    ctx.shadowColor = SENTINEL_COLOR;
    ctx.shadowBlur = AIMED_LINE_GLOW;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Diamond at the player's distance projected along the tracked
    // angle — sticks to the player while the line chases, then
    // snaps to the locked angle the moment firing starts (player
    // distance still drives the radius).
    const pdx = this.lastPlayerX - this.x;
    const pdy = this.lastPlayerY - this.y;
    const playerDist = Math.hypot(pdx, pdy);
    const diamondX = this.x + Math.cos(this.aimedTrackedAngle) * playerDist;
    const diamondY = this.y + Math.sin(this.aimedTrackedAngle) * playerDist;
    const pulse =
      1 +
      0.2 *
        Math.sin(
          (this.aimedTimer / AIMED_TELEGRAPH_SEC) * Math.PI * 4,
        );
    const half = (AIMED_DIAMOND_SIZE / 2) * pulse;
    ctx.save();
    ctx.translate(diamondX, diamondY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = SENTINEL_COLOR;
    ctx.shadowColor = SENTINEL_COLOR;
    ctx.shadowBlur = AIMED_LINE_GLOW;
    ctx.fillRect(-half, -half, half * 2, half * 2);
    ctx.restore();
  }

  /** Brief snap-confirm flash drawn the 80 ms after the telegraph
   *  locks. Solid (no dash), full opacity → fade to 0, so the
   *  player reads "the angle just locked, bullets coming." Drawn
   *  in firing phase, separate from the telegraph dashed line. */
  private renderAimedSnapFlash(ctx: CanvasRenderingContext2D): void {
    const alpha = this.aimedSnapTimer / AIMED_SNAP_DURATION_SEC;
    if (alpha <= 0) return;
    const dist = rayDistToArenaEdge(
      this.x,
      this.y,
      this.aimedAngle,
      this.arenaW,
      this.arenaH,
    );
    const endX = this.x + Math.cos(this.aimedAngle) * dist;
    const endY = this.y + Math.sin(this.aimedAngle) * dist;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.7 + 0.3 * alpha);
    ctx.strokeStyle = SENTINEL_COLOR;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = SENTINEL_COLOR;
    ctx.shadowBlur = AIMED_LINE_GLOW + 4;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
  }

  private renderIntro(ctx: CanvasRenderingContext2D): void {
    const t = this.stateTimer;
    if (t < INTRO_FADE_END_MS) return; // boss hidden during the fade-in
    if (t < INTRO_MATERIALIZE_END_MS) {
      const u =
        (t - INTRO_FADE_END_MS) /
        (INTRO_MATERIALIZE_END_MS - INTRO_FADE_END_MS);
      const scale = Math.max(0, easeOutBack(u));
      this.renderBody(ctx, scale);
      return;
    }
    // Full-size body for the rest of intro (1600..3300ms).
    this.renderBody(ctx, 1);
  }

  private renderDying(ctx: CanvasRenderingContext2D): void {
    const t = this.stateTimer;

    // ---- jitter: ±3px around the death position
    const jx = (Math.random() - 0.5) * 6;
    const jy = (Math.random() - 0.5) * 6;

    // Render each remaining ring shell at the death position. As
    // each ring "explodes", we stop drawing it.
    ctx.save();
    ctx.translate(this.deathX + jx, this.deathY + jy);
    ctx.rotate(this.rotation);
    if (!this.outerExploded) strokeRing(ctx, OUTER_VERTS, 3, 1.0, 22);
    if (!this.middleExploded) strokeRing(ctx, MIDDLE_VERTS, 2, 0.7, 0);
    if (!this.innerExploded) strokeRing(ctx, INNER_VERTS, 1.5, 0.5, 0);
    ctx.restore();

    // Fragments — short line segments, fade out over the last
    // FRAGMENT_FADE_OUT_MS of their lifetime.
    ctx.save();
    ctx.strokeStyle = SENTINEL_COLOR;
    ctx.lineWidth = FRAGMENT_THICKNESS;
    ctx.lineCap = "round";
    for (const f of this.fragments) {
      const fade =
        f.age > FRAGMENT_LIFETIME_MS - FRAGMENT_FADE_OUT_MS
          ? Math.max(
              0,
              1 -
                (f.age - (FRAGMENT_LIFETIME_MS - FRAGMENT_FADE_OUT_MS)) /
                  FRAGMENT_FADE_OUT_MS,
            )
          : 1;
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);
      ctx.beginPath();
      ctx.moveTo(-FRAGMENT_LENGTH / 2, 0);
      ctx.lineTo(FRAGMENT_LENGTH / 2, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Weakpoint (central eye) growing in the final beat of dying.
    if (t >= DYING_INNER_EXPLODE_MS) {
      ctx.save();
      ctx.translate(this.deathX, this.deathY);
      const scale = this.weakpointScale;
      ctx.shadowColor = SENTINEL_COLOR;
      ctx.shadowBlur = this.weakpointGlowBlur;
      ctx.fillStyle = SENTINEL_COLOR;
      ctx.beginPath();
      ctx.arc(0, 0, 14 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, 6 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderDepthRing(
    ctx: CanvasRenderingContext2D,
    radius: number,
    rotState: { angle: number },
    depth: RingDepth,
    /** Multiplier on every alpha in this depth (bloom / shadow /
     *  bright / marker). Used by the Ring Burst transitions to
     *  fade mid + inner rings smoothly across detach + reassemble
     *  without snapping. 1 if omitted. */
    alphaMul = 1,
    /** Optional override of the bright-stroke alpha (after the
     *  alphaMul multiplier). Outer ring uses this for its slow
     *  sub-pulse so the depth config can stay declarative. */
    brightAlphaOverride?: number,
  ): void {
    ctx.save();
    ctx.rotate(rotState.angle);
    // Optional outermost bloom — a wider, dimmer halo painted before
    // the shadow so it reads as a soft glow around the ring.
    if (
      depth.bloomColor !== undefined &&
      depth.bloomLineWidth !== undefined &&
      depth.bloomAlpha !== undefined
    ) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = depth.bloomColor;
      ctx.lineWidth = depth.bloomLineWidth;
      ctx.globalAlpha = depth.bloomAlpha * alphaMul;
      ctx.stroke();
    }
    // Shadow stroke — gives the ring perceived thickness.
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = depth.shadowColor;
    ctx.lineWidth = depth.shadowLineWidth;
    ctx.globalAlpha = depth.shadowAlpha * alphaMul;
    ctx.stroke();
    // Bright stroke on top.
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = depth.brightColor;
    ctx.lineWidth = depth.brightLineWidth;
    const brightBase = brightAlphaOverride ?? depth.brightAlpha;
    ctx.globalAlpha = brightBase * alphaMul;
    ctx.stroke();
    // Three rotation-tracking arc markers — without them a perfect
    // circle reads as static even when angle is changing.
    ctx.strokeStyle = depth.markerColor;
    ctx.lineWidth = depth.markerLineWidth;
    ctx.globalAlpha = (depth.markerAlpha ?? 1) * alphaMul;
    const markerArc = depth.markerArcRad ?? RING_MARKER_ARC_RAD;
    for (let i = 0; i < RING_MARKER_COUNT; i++) {
      const start = (i / RING_MARKER_COUNT) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, start, start + markerArc);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private renderEyeLayers(ctx: CanvasRenderingContext2D): void {
    // Eye breath — uniform scale + ext-glow alpha sync. Independent
    // of the body's pulse so two cycles overlap rather than echo.
    const vulnerable = this.ringBurstPhase === "vulnerable";
    let breathScale: number;
    let extGlowAlpha: number;
    if (vulnerable) {
      // Vulnerable amplification — bigger asymmetric pulse around
      // RB_EYE_VULNERABLE_SCALE_MID = 1.04 (so the eye sits a bit
      // larger than rest), full amber rim alpha.
      breathScale =
        RB_EYE_VULNERABLE_SCALE_MID +
        Math.sin(this.eyeVulnerablePulsePhase) *
          RB_EYE_VULNERABLE_SCALE_AMPLITUDE;
      extGlowAlpha = 1;
    } else {
      breathScale =
        EYE_SCALE_MIN +
        ((Math.sin(this.eyeBreathPhase) + 1) / 2) *
          (EYE_SCALE_MAX - EYE_SCALE_MIN);
      extGlowAlpha =
        EYE_EXT_GLOW_ALPHA_MIN +
        ((Math.sin(this.eyeBreathPhase) + 1) / 2) *
          (EYE_EXT_GLOW_ALPHA_MAX - EYE_EXT_GLOW_ALPHA_MIN);
    }

    ctx.save();
    ctx.scale(breathScale, breathScale);

    // === Vulnerable-only outermost halo (bloom) ===
    // Drawn FIRST (outermost-first) so the rest of the eye stack
    // paints over it. Pulses alpha 0.20 ↔ 0.45 in lockstep with
    // the breath cycle.
    if (vulnerable) {
      const haloAlpha =
        RB_EYE_HALO_ALPHA_MIN +
        ((Math.sin(this.eyeVulnerablePulsePhase) + 1) / 2) *
          (RB_EYE_HALO_ALPHA_MAX - RB_EYE_HALO_ALPHA_MIN);
      ctx.beginPath();
      ctx.arc(0, 0, RB_EYE_HALO_R, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffaa22";
      ctx.lineWidth = RB_EYE_HALO_LW;
      ctx.globalAlpha = haloAlpha;
      ctx.stroke();
    }

    for (let i = 0; i < EYE_LAYERS.length; i++) {
      const layer = EYE_LAYERS[i];
      // Vulnerable per-layer overrides — boost ext glow + amber rim
      // and switch the warm pupil to neutral white so the contrast
      // against the gold rim reads cleanly.
      let stroke = layer.stroke;
      let fill = layer.fill;
      let lineWidth = layer.lineWidth;
      let alpha = i === 0 ? extGlowAlpha : (layer.alpha ?? 1);
      if (vulnerable) {
        if (i === 0) {
          // ext glow — wider lineWidth + breath-driven brighter alpha
          lineWidth = 9;
          alpha = 0.1 + 0.15 * ((Math.sin(this.eyeVulnerablePulsePhase) + 1) / 2);
        } else if (i === 1) {
          // amber rim — thicker + more saturated colour
          lineWidth = 2.5;
          stroke = "#ffbb33";
        } else if (i === 7) {
          // pupil fill — pure white, no warm cream
          fill = "#ffffff";
        }
      }
      ctx.beginPath();
      ctx.arc(0, 0, layer.r, 0, Math.PI * 2);
      ctx.globalAlpha = alpha;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke && lineWidth) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
      // After the inner-ring layer (index 4) but before the white
      // hot cores (5+), paint a soft fuzzy pupil glow so the
      // pupil-vicinity reads as a hot point in vulnerable.
      if (vulnerable && i === 4) {
        ctx.beginPath();
        ctx.arc(0, 0, RB_EYE_PUPIL_GLOW_R, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = RB_EYE_PUPIL_GLOW_LW;
        ctx.globalAlpha = RB_EYE_PUPIL_GLOW_ALPHA;
        ctx.stroke();
      }
    }

    // Eight radial spokes inside the iris — give the eye the "alive"
    // feel without animating each one separately.
    ctx.strokeStyle = EYE_SPOKE_COLOR;
    ctx.lineWidth = EYE_SPOKE_LINE_WIDTH;
    ctx.globalAlpha = EYE_SPOKE_ALPHA;
    for (let i = 0; i < EYE_SPOKE_COUNT; i++) {
      const a = (i / EYE_SPOKE_COUNT) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(EYE_SPOKE_INNER_R * cos, EYE_SPOKE_INNER_R * sin);
      ctx.lineTo(EYE_SPOKE_OUTER_R * cos, EYE_SPOKE_OUTER_R * sin);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.restore();

    // Reticle — four triangles N/E/S/W around the eye (un-scaled by
    // breath; they tag the boss centre, not the eye geometry).
    this.renderReticle(ctx);
  }

  /** Four-triangle reticle around the eye centre. Idle: red, dim,
   *  small. Vulnerable: gold, full alpha, +40% scale — reads as
   *  "target acquired" brackets. Drawn outside the breath-scaled
   *  ctx so size doesn't pump with the eye. */
  private renderReticle(ctx: CanvasRenderingContext2D): void {
    const vulnerable = this.ringBurstPhase === "vulnerable";
    const color = vulnerable ? RETICLE_VULNERABLE_COLOR : RETICLE_IDLE_COLOR;
    const alpha = vulnerable ? RETICLE_VULNERABLE_ALPHA : RETICLE_IDLE_ALPHA;
    const scale = vulnerable ? RETICLE_VULNERABLE_SCALE : 1;
    const r = RETICLE_BASE_RADIUS * scale;
    const h = RETICLE_HEIGHT * scale;
    const hw = RETICLE_HALF_WIDTH * scale;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    // N (apex inward, toward eye centre)
    drawReticleTriangle(ctx, 0, -r, h, hw, "down");
    // S
    drawReticleTriangle(ctx, 0, r, h, hw, "up");
    // E
    drawReticleTriangle(ctx, r, 0, h, hw, "left");
    // W
    drawReticleTriangle(ctx, -r, 0, h, hw, "right");
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private renderBody(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    // Body breath — rescales the whole shell stack on a slow sin
    // wave. Composes multiplicatively with the intro-driven scale
    // so the boss still grows in from 0.1 → 1 during materialise.
    const breathScale =
      BODY_SCALE_MIN +
      ((Math.sin(this.bodyBreathPhase) + 1) / 2) *
        (BODY_SCALE_MAX - BODY_SCALE_MIN);
    const totalScale = scale * breathScale;
    if (totalScale !== 1) ctx.scale(totalScale, totalScale);

    // Telegraph jitter — small random offset while charging the
    // radial burst. Aimed-shot telegraph doesn't shake the body
    // (the line + diamond carry the read). Ring Burst telegraph
    // also shakes — same channel, ramped from 0 → RB_TELEGRAPH_JITTER_PX.
    if (this.radialPhase === "telegraph") {
      const t = Math.min(1, this.radialTimer / RADIAL_TELEGRAPH_SEC);
      const intensity = 2 * t;
      ctx.translate(
        (Math.random() - 0.5) * intensity * 2,
        (Math.random() - 0.5) * intensity * 2,
      );
    } else if (this.ringBurstPhase === "telegraph") {
      const t = Math.min(1, this.rbTimer / RB_TELEGRAPH_SEC);
      const intensity = RB_TELEGRAPH_JITTER_PX * t;
      ctx.translate(
        (Math.random() - 0.5) * intensity * 2,
        (Math.random() - 0.5) * intensity * 2,
      );
    }

    const pulseScale = 1 + Math.sin(this.pulsePhase) * PULSE_AMPLITUDE;

    // Body glow alpha — same phase as bodyBreathPhase so the silhouette
    // pulses light + scale together. Ring Burst telegraph multiplies
    // the alpha so the silhouette flares up before the rings detach.
    const rbGlowMul =
      this.ringBurstPhase === "telegraph"
        ? 1 +
          (RB_TELEGRAPH_GLOW_BOOST - 1) *
            Math.min(1, this.rbTimer / RB_TELEGRAPH_SEC)
        : 1;
    // Charge rushing flares the silhouette — body looks like it's
    // riding a wave of energy through the dash. Stacks
    // multiplicatively with the RB telegraph boost (they're mutually
    // exclusive in practice, but the math is fine either way).
    const chargeGlowMul =
      this.chargePhase === "rushing" ? CHARGE_RUSHING_GLOW_MUL : 1;
    const bodyGlowAlpha =
      (BODY_GLOW_ALPHA_MIN +
        ((Math.sin(this.bodyBreathPhase) + 1) / 2) *
          (BODY_GLOW_ALPHA_MAX - BODY_GLOW_ALPHA_MIN)) *
      rbGlowMul *
      chargeGlowMul;

    // Outer ring with a glow halo — alpha tracks bodyGlowAlpha for
    // the breath sync. Whole hex stack is wrapped in bodyOpacity so
    // it ghosts during Ring Burst detach / vulnerable / reassemble.
    // The hex frame strokes track the active phase accent.
    const hexAccent = this.accentColor();
    ctx.save();
    ctx.rotate(this.rotation);
    ctx.globalAlpha = this.bodyOpacity;
    drawNeon(
      ctx,
      () => {
        ctx.globalAlpha = bodyGlowAlpha * this.bodyOpacity;
        strokeHexagon(ctx, OUTER_VERTS, pulseScale);
        ctx.strokeStyle = hexAccent;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = this.bodyOpacity;
      },
      hexAccent,
      this.radialPhase === "telegraph" ? 40 : 22,
      10,
    );

    ctx.globalAlpha = 0.7 * this.bodyOpacity;
    strokeHexagon(ctx, MIDDLE_VERTS, pulseScale);
    ctx.strokeStyle = hexAccent;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.globalAlpha = 0.5 * this.bodyOpacity;
    strokeHexagon(ctx, INNER_VERTS, pulseScale);
    ctx.strokeStyle = hexAccent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    // === Three independently-rotating depth rings ===
    //
    // Visual hierarchy in Ring Burst (detach / vulnerable /
    // reassemble): outer ring switches to a triple-stack with a
    // bloom + brighter `#ff4455` core (the only damaging shell);
    // mid + inner cross-fade to a desaturated `#8a2030` /
    // `#5a1020` palette at 0.40 / 0.30 alpha so they don't
    // compete for attention. The fade is driven by `dimRamp`
    // 0..1: 0 in idle / attacking / telegraph / recovery, ramps
    // 0→1 across detach, holds 1 in vulnerable, ramps 1→0 across
    // reassemble. Using a multiplicative alpha factor instead of
    // a hard switch makes the cross-fade smooth.
    const rbPhase = this.ringBurstPhase;
    const inRingBurst =
      rbPhase === "detach" ||
      rbPhase === "vulnerable" ||
      rbPhase === "reassemble";
    let dimRamp = 0;
    if (rbPhase === "detach") {
      dimRamp = easeInOutCubic(
        Math.min(1, this.rbTimer / RB_DETACH_SEC),
      );
    } else if (rbPhase === "vulnerable") {
      dimRamp = 1;
    } else if (rbPhase === "reassemble") {
      dimRamp =
        1 -
        easeInOutCubic(Math.min(1, this.rbTimer / RB_REASSEMBLE_SEC));
    }
    // Outer slow pulse — different period from the eye breath so
    // they don't beat in lockstep.
    const outerPulseAlpha =
      RB_OUTER_PULSE_ALPHA_MIN +
      ((Math.sin(
        (this.combatElapsedSec * Math.PI * 2) /
          RB_OUTER_PULSE_PERIOD_SEC,
      ) +
        1) /
        2) *
        (RB_OUTER_PULSE_ALPHA_MAX - RB_OUTER_PULSE_ALPHA_MIN);
    const accent = this.accentColor();
    const outerDepthBase = inRingBurst ? OUTER_RING_DEPTH_RB : OUTER_RING_DEPTH;
    // Spread the per-phase accent over the outer-ring depth config
    // so the bright + bloom strokes shift hue with the phase. Markers
    // in RB stay white for legibility; outside RB markers track
    // accent so the colour doesn't fight the shell.
    const outerDepth: RingDepth = inRingBurst
      ? { ...outerDepthBase, brightColor: accent, bloomColor: accent }
      : { ...outerDepthBase, brightColor: accent, markerColor: accent };
    this.renderDepthRing(
      ctx,
      this.ringRadiusOuter,
      this.ringStates[0],
      outerDepth,
      1,
      outerPulseAlpha,
    );
    // Mid + inner: blend bright config with dimmed config based on
    // dimRamp. Color snaps to dim at start of detach (alpha is
    // also low at that point so the snap isn't loud); alpha
    // additionally cross-fades via two renderDepthRing passes. Mid
    // ring's bright colour shifts per phase via midRingColor().
    if (dimRamp < 1) {
      this.renderDepthRing(
        ctx,
        this.ringRadiusMid,
        this.ringStates[1],
        { ...MID_RING_DEPTH, brightColor: this.midRingColor() },
        1 - dimRamp,
      );
    }
    if (dimRamp > 0) {
      this.renderDepthRing(
        ctx,
        this.ringRadiusMid,
        this.ringStates[1],
        MID_RING_DEPTH_DIM,
        dimRamp,
      );
    }
    if (dimRamp < 1) {
      this.renderDepthRing(
        ctx,
        this.ringRadiusInner,
        this.ringStates[2],
        INNER_RING_DEPTH,
        1 - dimRamp,
      );
    }
    if (dimRamp > 0) {
      this.renderDepthRing(
        ctx,
        this.ringRadiusInner,
        this.ringStates[2],
        INNER_RING_DEPTH_DIM,
        dimRamp,
      );
    }

    // Fragments orbiting the outer vertices — counter-rotation.
    // Same body-opacity gate as the shells so they vanish together
    // during Ring Burst.
    ctx.save();
    ctx.rotate(this.fragmentRotation);
    ctx.fillStyle = SENTINEL_COLOR;
    ctx.globalAlpha = 0.85 * this.bodyOpacity;
    for (const v of OUTER_VERTS) {
      ctx.beginPath();
      ctx.moveTo(v.x * 1.18, v.y * 1.18);
      const ax = -v.y * 0.08;
      const ay = v.x * 0.08;
      ctx.lineTo(v.x * 1.04 + ax, v.y * 1.04 + ay);
      ctx.lineTo(v.x * 1.04 - ax, v.y * 1.04 - ay);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // === Central eye stack ===
    this.renderEyeLayers(ctx);

    if (this.hitFlashTime > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = Math.min(1, this.hitFlashTime * 5);
      circle(ctx, 0, 0, SENTINEL_HITBOX_RADIUS);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // Energy-burst boss flash — short additive overlay covering the
    // body bbox right after the radial burst lands.
    if (this.bossFlashTimer > 0) {
      const t = this.bossFlashTimer / BURST_FLASH_DURATION_SEC;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = BURST_FLASH_PEAK_ALPHA * t;
      circle(ctx, 0, 0, SENTINEL_HITBOX_RADIUS + 6);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
  }

  // -------- screen-space overlays (intro fade, SENTINEL/VICTORY
  // text, white flash). Called by rooms-game after the world render
  // restores the screen-space transform. --------

  drawScreenOverlay(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
  ): void {
    if (this.state === "intro") {
      this.drawIntroOverlay(ctx, viewW, viewH);
    } else if (this.state === "dying") {
      this.drawDyingOverlay(ctx, viewW, viewH);
    }
  }

  private drawIntroOverlay(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
  ): void {
    const t = this.stateTimer;
    // Fade-in 0..0.7 across [0, 800), 0.7..0.3 across [800, 1600),
    // 0.3..0 across [1600, 1700).
    let fadeAlpha = 0;
    if (t < INTRO_FADE_END_MS) {
      fadeAlpha = 0.7 * (t / INTRO_FADE_END_MS);
    } else if (t < INTRO_MATERIALIZE_END_MS) {
      const u =
        (t - INTRO_FADE_END_MS) /
        (INTRO_MATERIALIZE_END_MS - INTRO_FADE_END_MS);
      fadeAlpha = 0.7 - 0.4 * u;
    } else if (t < INTRO_SHAKE_END_MS) {
      const u =
        (t - INTRO_MATERIALIZE_END_MS) /
        (INTRO_SHAKE_END_MS - INTRO_MATERIALIZE_END_MS);
      fadeAlpha = 0.3 - 0.3 * u;
    }
    if (fadeAlpha > 0) {
      ctx.save();
      ctx.fillStyle = FADE_OVERLAY_COLOR.replace("ALPHA", fadeAlpha.toFixed(3));
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    // SENTINEL title — fade in, hold, fade out across [1700, 3300].
    if (t >= INTRO_TEXT_START_MS && t < INTRO_TEXT_END_MS) {
      let alpha = 0;
      if (t < INTRO_TEXT_FADE_IN_END_MS) {
        alpha =
          (t - INTRO_TEXT_START_MS) /
          (INTRO_TEXT_FADE_IN_END_MS - INTRO_TEXT_START_MS);
      } else if (t < INTRO_TEXT_HOLD_END_MS) {
        alpha = 1;
      } else {
        alpha =
          1 -
          (t - INTRO_TEXT_HOLD_END_MS) /
            (INTRO_TEXT_END_MS - INTRO_TEXT_HOLD_END_MS);
      }
      if (alpha > 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = "700 60px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = SENTINEL_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = SENTINEL_COLOR;
        ctx.shadowBlur = 24;
        ctx.fillText("SENTINEL", viewW / 2, viewH / 2);
        ctx.restore();
      }
    }
  }

  private drawDyingOverlay(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
  ): void {
    const t = this.stateTimer;
    // White flash: 0 → 0.7 across [3000, 3050], 0.7 → 0 across
    // [3050, 3300].
    if (t >= DYING_FLASH_START_MS && t < DYING_FLASH_END_MS) {
      let alpha;
      if (t < DYING_FLASH_PEAK_MS) {
        alpha =
          0.7 *
          ((t - DYING_FLASH_START_MS) /
            (DYING_FLASH_PEAK_MS - DYING_FLASH_START_MS));
      } else {
        alpha =
          0.7 *
          (1 -
            (t - DYING_FLASH_PEAK_MS) /
              (DYING_FLASH_END_MS - DYING_FLASH_PEAK_MS));
      }
      if (alpha > 0) {
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = alpha;
        ctx.fillRect(0, 0, viewW, viewH);
        ctx.restore();
      }
    }
    // VICTORY title — fade in over 300ms starting at 3050, then hold.
    if (t >= DYING_VICTORY_START_MS) {
      const alpha = Math.min(
        1,
        (t - DYING_VICTORY_START_MS) /
          (DYING_VICTORY_FADE_IN_END_MS - DYING_VICTORY_START_MS),
      );
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "700 60px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = VICTORY_COLOR;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = VICTORY_COLOR;
      ctx.shadowBlur = 24;
      ctx.fillText("VICTORY", viewW / 2, viewH / 2);
      ctx.restore();
    }
  }

  /** "Whiff" feedback when a dash passes through the (solid)
   *  body without landing damage — short grey ring + a few grey
   *  particles + (silent for now; the audio module doesn't expose a
   *  pitched + attenuated `bulletBreak` variant yet). Visual cue
   *  that this is invulnerable, not bugged. */
  private spawnBodyWhiff(
    ctxRoom: EnemyContext,
    pos: { x: number; y: number },
  ): void {
    ctxRoom.rings.push({
      x: pos.x,
      y: pos.y,
      age: 0,
      lifetime: BODY_WHIFF_RING_LIFETIME_SEC,
      startR: BODY_WHIFF_RING_R_START,
      endR: BODY_WHIFF_RING_R_END,
      color: BODY_WHIFF_RING_COLOR,
      startLineWidth: BODY_WHIFF_RING_LW_START,
      endLineWidth: BODY_WHIFF_RING_LW_END,
      glowBlur: 0,
    });
    for (let i = 0; i < BODY_WHIFF_PARTICLE_COUNT; i++) {
      const a = (i / BODY_WHIFF_PARTICLE_COUNT) * Math.PI * 2;
      ctxRoom.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(a) * BODY_WHIFF_PARTICLE_SPEED,
        vy: Math.sin(a) * BODY_WHIFF_PARTICLE_SPEED,
        initialSize: 2,
        color: BODY_WHIFF_PARTICLE_COLOR,
        age: 0,
        lifetime: BODY_WHIFF_PARTICLE_LIFETIME_SEC,
        glowStrong: 4,
        glowSoft: 2,
        drag: 0.9,
      });
    }
  }

  overlapsPlayer(px: number, py: number, half: number): boolean {
    // Contact damage is suppressed during cinematic phases AND
    // during the ghosted Ring Burst phases (detach / vulnerable /
    // reassemble). Dash damage to body uses the same gate via
    // bodyDamageActive() so dash and contact line up.
    if (this.state === "intro" || this.state === "dying") return false;
    if (!this.bodyDamageActive()) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    const r = SENTINEL_HITBOX_RADIUS + half;
    return dx * dx + dy * dy < r * r;
  }

  tryDashDamage(
    dashId: number,
    px: number,
    py: number,
    half: number,
  ): boolean {
    if (this.state !== "idle" && this.state !== "attacking") return false;
    // Phase-transition cinematic also blocks every interaction
    // (matches takeDamage's gate so the boss is fully invulnerable
    // through the 2 s window).
    if (this.phaseTransition) return false;
    // Ring Burst vulnerable: the eye is the *only* damage path
    // anywhere in the fight. Body is intangible during this
    // phase (ghosted), and ring contact damage is handled
    // separately in updateCombat. Eye hit deals RB_EYE_HIT_DAMAGE
    // and queues the heavy feedback for the next update tick.
    if (this.ringBurstPhase === "vulnerable") {
      if (dashId === this.dashIdAlreadyDamaged) return false;
      const dx = px - this.x;
      const dy = py - this.y;
      const r = RB_EYE_HITBOX_RADIUS + half;
      if (dx * dx + dy * dy >= r * r) return false;
      this.dashIdAlreadyDamaged = dashId;
      this.takeDamage(RB_EYE_HIT_DAMAGE);
      this.pendingEyeHit = true;
      return true;
    }
    // Body whiff — outside the ghosted RB phases the body is
    // SOLID but INVULNERABLE: a dash through it deals zero
    // damage and triggers a small grey "whiff" effect so the
    // player learns the eye is the only target. bodyDamageActive
    // gates this (skips detach / vulnerable / reassemble).
    if (this.bodyDamageActive() && dashId !== this.dashIdAlreadyWhiffed) {
      const dx = px - this.x;
      const dy = py - this.y;
      const r = SENTINEL_HITBOX_RADIUS + half;
      if (dx * dx + dy * dy < r * r) {
        this.dashIdAlreadyWhiffed = dashId;
        this.pendingBodyWhiff = { x: px, y: py };
      }
    }
    return false;
  }
}

function strokeHexagon(
  ctx: CanvasRenderingContext2D,
  verts: { x: number; y: number }[],
  scale: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const x = v.x * scale;
    const y = v.y * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function strokeRing(
  ctx: CanvasRenderingContext2D,
  verts: { x: number; y: number }[],
  lineWidth: number,
  alpha: number,
  glow: number,
): void {
  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = SENTINEL_COLOR;
    ctx.shadowBlur = glow;
  }
  ctx.globalAlpha = alpha;
  strokeHexagon(ctx, verts, 1);
  ctx.strokeStyle = SENTINEL_COLOR;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Distance along (cos a, sin a) from (x, y) to the arena's outer
 *  bounds. Used to terminate the aim-line cleanly at the wall
 *  instead of letting it draw past the visible space. */
function rayDistToArenaEdge(
  x: number,
  y: number,
  angle: number,
  w: number,
  h: number,
): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let tx = Infinity;
  let ty = Infinity;
  if (Math.abs(dx) > 1e-6) {
    tx = dx > 0 ? (w - x) / dx : -x / dx;
  }
  if (Math.abs(dy) > 1e-6) {
    ty = dy > 0 ? (h - y) / dy : -y / dy;
  }
  return Math.max(0, Math.min(tx, ty));
}

export const SENTINEL_HP_MAX_EXPORT = SENTINEL_HP_MAX;
export const SENTINEL_PHASE_HP_BOUNDARY_1_TO_2 = PHASE_HP_BOUNDARY_1_TO_2;
export const SENTINEL_PHASE_HP_BOUNDARY_2_TO_3 = PHASE_HP_BOUNDARY_2_TO_3;
