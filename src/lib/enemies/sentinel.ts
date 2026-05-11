// Boss SFX cues are temporarily disabled — see the commented
// audio.play.* calls inside this file. Music for the boss fight
// loads from public/audio/boss/ as a single track via the audio
// module once a file is added. Re-enable selectively by
// uncommenting; the import is dropped for now so tsc doesn't flag
// the unused symbol.
// import { audio } from "../audio";
import { isGodMode } from "../god-mode";
import { makeBullet } from "../bullets";
import { initAwareness } from "./awareness";
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

// === Pre-detonation buildup (2200..3000 ms) ===
// Tension before the flash: shake escalates from 3 px to 12 px and
// inward "absorption" particles converge on the boss centre so the
// detonation moment feels earned rather than a sudden flash.
const DYING_BUILDUP_START_MS = 2200;
const DYING_BUILDUP_SHAKE_MIN_PX = 3;
const DYING_BUILDUP_SHAKE_MAX_PX = 12;
const DYING_BUILDUP_PARTICLE_INTERVAL_SEC = 0.05;
const DYING_BUILDUP_PARTICLE_RING_RADIUS = 140;
const DYING_BUILDUP_PARTICLE_SPEED_MIN = 250;
const DYING_BUILDUP_PARTICLE_SPEED_MAX = 400;
const DYING_BUILDUP_PARTICLE_LIFETIME_SEC = 0.25;

// === Detonation moment (one-shot at DYING_FLASH_START_MS) ===
const DYING_DETONATION_PARTICLE_COUNT = 32;
const DYING_DETONATION_PARTICLE_SPEED_MIN = 350;
const DYING_DETONATION_PARTICLE_SPEED_MAX = 550;
const DYING_DETONATION_PARTICLE_LIFETIME_SEC = 0.8;
const DYING_DETONATION_SHAKE_PX = 16;
const DYING_DETONATION_SHAKE_SEC = 0.25;
// Three concentric shockwaves at different rates — fast accent ring
// snaps out first, white middle ring follows, green outer ring drifts
// out slowest as a hand-off into VICTORY.
const DYING_DETONATION_RING1_R0 = 20;
const DYING_DETONATION_RING1_R1 = 200;
const DYING_DETONATION_RING1_LW0 = 5;
const DYING_DETONATION_RING1_LW1 = 0.5;
const DYING_DETONATION_RING1_LIFETIME_SEC = 0.4;
const DYING_DETONATION_RING2_R0 = 40;
const DYING_DETONATION_RING2_R1 = 320;
const DYING_DETONATION_RING2_LW0 = 7;
const DYING_DETONATION_RING2_LW1 = 0.5;
const DYING_DETONATION_RING2_LIFETIME_SEC = 0.6;
const DYING_DETONATION_RING3_R0 = 60;
const DYING_DETONATION_RING3_R1 = 520;
const DYING_DETONATION_RING3_LW0 = 4;
const DYING_DETONATION_RING3_LW1 = 0.5;
const DYING_DETONATION_RING3_LIFETIME_SEC = 0.9;

// Brighter peak — 0.95 instead of 0.7 reads as "the screen actually
// blew out" without burning to pure white.
const DYING_FLASH_PEAK_ALPHA = 0.95;

// Ambient settling tremor under the VICTORY title (1 px) so the
// arena feels alive after the detonation rather than freezing dead.
const DYING_AMBIENT_SHAKE_PX = 1;
const DYING_AMBIENT_SHAKE_START_MS = 3500;

// === Post-detonation force waves (3500..5500 ms) ===
// After the initial detonation rings have expired and the flash has
// faded, a sequence of expanding shockwaves keeps pulsing outward
// across the arena under the VICTORY title. Each wave is a thin
// ring with a long lifetime so it actually crosses the field; the
// colour cycle (accent → white → green → accent → green) hands the
// eye off to the green VICTORY palette. Each wave fires a small
// percussive shake that wins against the 1 px ambient tremor.
const POST_WAVE_START_R = 30;
const POST_WAVE_LW_START = 4;
const POST_WAVE_LW_END = 0.5;
const POST_WAVE_GLOW_BLUR = 14;
const POST_WAVE_SHAKE_PX = 4;
const POST_WAVE_SHAKE_SEC = 0.12;
const POST_WAVE_SCHEDULE: ReadonlyArray<{
  startMs: number;
  color: string;
  endR: number;
  lifetimeSec: number;
}> = [
  { startMs: 3500, color: SENTINEL_COLOR, endR: 600, lifetimeSec: 1.0 },
  { startMs: 4000, color: "#ffffff", endR: 700, lifetimeSec: 1.1 },
  { startMs: 4500, color: VICTORY_COLOR, endR: 800, lifetimeSec: 1.2 },
  { startMs: 5000, color: SENTINEL_COLOR, endR: 720, lifetimeSec: 1.1 },
  { startMs: 5500, color: VICTORY_COLOR, endR: 850, lifetimeSec: 1.3 },
];

// VICTORY scale-pulse — text starts slightly smaller, eases past 1
// with an overshoot, then settles. Multiplies the text scale during
// the fade-in window.
const DYING_VICTORY_SCALE_START = 0.85;
const DYING_VICTORY_SCALE_OVERSHOOT = 1.05;

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
// Eye render — compressed from 8 layers + 8 radial spokes to 4
// layers after profiling. Decorations (spokes + nested cores) were
// pure cosmetics that didn't carry gameplay information.
const EYE_LAYERS: ReadonlyArray<{
  r: number;
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  alpha?: number;
}> = [
  // Amber rim + dark base — rim colour switches to brighter
  // `#ffbb33` in vulnerable via the override in `renderEyeLayers`.
  { r: 24, fill: "#1f1004", stroke: "#ffaa22", lineWidth: 2, alpha: 0.95 },
  // Red iris fill + outline.
  { r: 18, fill: "#1a0508", stroke: "#ff3344", lineWidth: 1, alpha: 0.95 },
  // Pupil glow halo — soft white aura under the pupil core.
  { r: 10, stroke: "#ffffff", lineWidth: 4, alpha: 0.4 },
  // Pupil core (warm cream by default; flips to neutral white in
  // vulnerable so the gold rim doesn't fight the pupil colour).
  { r: 7, fill: "#fff8e0" },
];
const EYE_BREATH_PERIOD_SEC = 1.4;
const EYE_SCALE_MIN = 0.94;
const EYE_SCALE_MAX = 1.06;

// Body silhouette is a stack of three nested pointy-top hexagons,
// not concentric circles. The hex shape is rotated by each shell's
// own angular state so the rotation is visible as the corners
// sweep, and rivet-style diamond markers are pinned to vertices to
// read as mechanical joints. Each shell renders as max two stacked
// strokes (glow + main) plus the marker pass — same visual budget
// as the previous circular ring, just hex-shaped.
const HEX_VERTEX_COUNT = 6;
// Pointy-top: vertex 0 at the top of the local frame (-PI/2). The
// rest spread clockwise on PI/3 increments.
const HEX_TOP_OFFSET_RAD = -Math.PI / 2;

function traceHexPath(
  ctx: CanvasRenderingContext2D,
  radius: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < HEX_VERTEX_COUNT; i++) {
    const a =
      HEX_TOP_OFFSET_RAD + (i * Math.PI * 2) / HEX_VERTEX_COUNT;
    const x = radius * Math.cos(a);
    const y = radius * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

type RingDepth = {
  /** Optional outer glow pass (drawn first). When `null`, the ring
   *  paints just the bright stroke + markers. Mid + inner rings
   *  drop the glow layer entirely. */
  glowColor: string | null;
  glowLineWidth: number;
  glowAlpha: number;
  /** The crisp main stroke. */
  brightColor: string;
  brightLineWidth: number;
  brightAlpha: number;
  /** Inner ring uses a dotted main stroke (`[2, 6]`) to read as
   *  rotating without needing markers; outer ring uses a wider
   *  `[12, 8]` during the Ring Burst cyan-mode. Optional;
   *  defaults to solid. */
  brightDashPattern?: [number, number];
  /** Optional `lineDashOffset` in pixels applied alongside the
   *  pattern. Animated by `combatElapsedSec` for a "marching
   *  dashes" effect on the outer ring during cyan-mode. */
  brightDashOffset?: number;
  /** Arc-marker count (0 disables markers entirely; inner ring
   *  uses 0 since its dash pattern already conveys rotation). */
  markerCount: number;
  markerColor: string;
  /** Drives the rivet diamond size: side ≈ markerLineWidth × 1.8.
   *  Kept the legacy name so existing config sites don't churn. */
  markerLineWidth: number;
  markerAlpha?: number;
  maxAngularVel: number; // rad/s — the random target sample range
};
// Outer ring config is computed dynamically per frame (see
// `computeOuterRingDepth`) so the color + dash-pattern can lerp
// across phase boundaries. Only the rotation tunable lives here.
const OUTER_RING_MAX_ANGULAR_VEL = 0.8;
// Mid + inner during vulnerable / reassemble — desaturated and
// faded so they read as visual decoration, not threats.
const MID_RING_DEPTH_DIM: RingDepth = {
  glowColor: null,
  glowLineWidth: 0,
  glowAlpha: 0,
  brightColor: "#8a2030",
  brightLineWidth: 2.5,
  brightAlpha: 0.4,
  markerCount: 2,
  markerColor: "#8a2030",
  markerLineWidth: 2.5,
  markerAlpha: 0.5,
  maxAngularVel: 1.2,
};
const INNER_RING_DEPTH_DIM: RingDepth = {
  glowColor: null,
  glowLineWidth: 0,
  glowAlpha: 0,
  brightColor: "#5a1020",
  brightLineWidth: 1.5,
  brightAlpha: 0.3,
  brightDashPattern: [2, 6],
  markerCount: 0,
  markerColor: "#5a1020",
  markerLineWidth: 1.5,
  markerAlpha: 0.4,
  maxAngularVel: 1.6,
};
const MID_RING_DEPTH: RingDepth = {
  glowColor: null,
  glowLineWidth: 0,
  glowAlpha: 0,
  brightColor: "#ff5577",
  brightLineWidth: 2.5,
  brightAlpha: 1.0,
  markerCount: 2,
  markerColor: "#ff99aa",
  markerLineWidth: 3.5,
  maxAngularVel: 1.2,
};
const INNER_RING_DEPTH: RingDepth = {
  glowColor: null,
  glowLineWidth: 0,
  glowAlpha: 0,
  brightColor: "#ff3344",
  brightLineWidth: 1.5,
  brightAlpha: 0.7,
  brightDashPattern: [2, 6],
  markerCount: 0,
  markerColor: "#ff7788",
  markerLineWidth: 2.5,
  maxAngularVel: 1.6,
};
const RING_ANGULAR_VEL_LERP = 0.02;
const RING_RETARGET_MIN_MS = 2000;
const RING_RETARGET_MAX_MS = 5000;

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
// Outer ring switches to cyan dashed during the three ghost-body
// Ring Burst phases — same visual language as the cyan dashed
// walls in the tutorial / Room 4 ("dash through, costs HP without
// i-frames"). Was previously a separate stroke layered under a
// red outer; merged into the outer ring itself so the player sees
// one ring with two render modes instead of two stacked rings.
const RB_OUTER_CYAN_COLOR = "#7dd3fc";
const RB_OUTER_CYAN_DASH_PATTERN: [number, number] = [12, 8];
const RB_OUTER_CYAN_DASH_RATE_PX_PER_SEC = 30;
const RB_OUTER_RED_GLOW_LW = 10;
const RB_OUTER_CYAN_GLOW_LW = 14;
const RB_OUTER_RED_GLOW_ALPHA = 0.2;
const RB_OUTER_CYAN_GLOW_ALPHA = 0.18;
// 300 ms color crossfade at telegraph → detach (red → cyan) and
// at reassemble → recovery (cyan → red, ticked across recovery's
// rbTimer). The dash pattern flips on/off discretely on the same
// boundaries — interpolating dash-pattern itself reads as glitchy.
const RB_OUTER_TRANSITION_SEC = 0.3;
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
// Vulnerable halo pulses 0.18 → 0.40 in lockstep with the breath
// (per the visual budget — was 0.20 → 0.45 with a wider line).
const RB_EYE_HALO_ALPHA_MIN = 0.18;
const RB_EYE_HALO_ALPHA_MAX = 0.4;
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
const RB_DETACH_PARTICLE_COUNT = 12;
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
const RB_EYE_HIT_PARTICLE_COUNT_WHITE = 8;
const RB_EYE_HIT_PARTICLE_COUNT_GOLD = 8;
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
// in phase 2, mine field in phase 3.
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
const PHASE_TRANSITION_CLIMAX_PARTICLE_COUNT = 20;
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

// === Phase 3 mine field ===
// Parallel timer (not in the attack rotation, no mutex). Once per
// MINE_SPAWN_INTERVAL_SEC the boss drops a mine in a random arena
// point, picked to keep clear of both the player and the boss
// itself. The mine telegraphs as a pulsing hex outline for
// MINE_TELEGRAPH_SEC, then detonates a 6-bullet radial burst from
// its position. Player can stand in a mine during telegraph
// without taking damage — the threat is the bullets after, not
// the mine itself. The hex outline echoes the boss silhouette;
// six bullets continues the hex theme.
const MINE_SPAWN_INTERVAL_SEC = 2.0;
const MINE_TELEGRAPH_SEC = 1.5;
// Last fraction of the telegraph reads as a fast strobe so the
// detonation moment is impossible to miss.
const MINE_STROBE_SEC = 0.2;
const MINE_MAX_ACTIVE = 5;
const MINE_MIN_DIST_FROM_PLAYER = 200;
const MINE_MIN_DIST_FROM_BOSS = 150;
// Up to N attempts per spawn tick to find a valid position; if
// every candidate collides with the exclusion zones we skip this
// tick (timer keeps running, not reset, so the next try lands on
// the same cadence).
const MINE_SPAWN_MAX_ATTEMPTS = 8;
const MINE_RADIUS = 30;
const MINE_CENTER_DOT_RADIUS = 4;
const MINE_OUTLINE_LINE_WIDTH = 2;
const MINE_COLOR = "#ff5577";
const MINE_DETONATION_BULLET_COUNT = 6;
const MINE_DETONATION_BULLET_SPEED = 280;
// Outward shockwave on detonation — same `Ring` shape as the
// rest of the boss FX so the shared renderer interpolates it.
const MINE_DETONATION_RING_R0 = 10;
const MINE_DETONATION_RING_R1 = 80;
const MINE_DETONATION_RING_LW0 = 6;
const MINE_DETONATION_RING_LW1 = 0.5;
const MINE_DETONATION_RING_LIFETIME_SEC = 0.4;
const MINE_DETONATION_PARTICLE_COUNT = 8;
const MINE_DETONATION_PARTICLE_SPEED_MIN = 200;
const MINE_DETONATION_PARTICLE_SPEED_MAX = 350;
const MINE_DETONATION_PARTICLE_LIFETIME_SEC = 0.4;
const MINE_SPAWN_PARTICLE_COUNT = 4;
const MINE_SPAWN_PARTICLE_SPEED = 80;
const MINE_SPAWN_PARTICLE_LIFETIME_SEC = 0.3;

type Mine = {
  x: number;
  y: number;
  /** Seconds since spawn; detonates at MINE_TELEGRAPH_SEC. */
  age: number;
};

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
const BURST_STREAMER_COUNT = 12;
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
   *  1 HP for normal contact / RB ring / sweep beam. rooms-game
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

  // === Phase 3 mine field ===
  /** Live mines on the floor. Each entry ages until detonation,
   *  then is filtered out. */
  private mines: Mine[] = [];
  /** Seconds since the last successful mine spawn (ticks only when
   *  `bossPhase === 3`). Resets on a successful spawn. */
  private mineSpawnTimer = 0;

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
  /** Cadence timer for the buildup absorption particles. */
  private buildupParticleTimer = 0;
  /** Latched true the first frame DYING_FLASH_START_MS is crossed
   *  so the detonation burst (particles + 3 shockwaves + big shake)
   *  fires exactly once, not every frame inside the flash window. */
  private detonationFired = false;
  /** Index into POST_WAVE_SCHEDULE — counts how many of the post-
   *  detonation force waves have already fired. Each entry fires
   *  once when stateTimer crosses its `startMs`. */
  private postWavesFired = 0;
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
    // God-mode dev shortcut — any successful damage call drops the
    // boss instantly so the death cinematic is one dash-through eye-
    // hit away. Lets us iterate on the dying / VICTORY visuals
    // without grinding through 60 HP every time.
    if (isGodMode()) {
      this.hp = 0;
      this.enterDying();
      return;
    }
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
    // Movement is owned by the active attack when Ring Burst is
    // non-idle — RB locks the boss position. Figure-8 only ticks
    // when the boss is "free" between attacks.
    const movementOwnedByAttack = this.ringBurstPhase !== "idle";
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
    // its own idle state — the cost of all four calls is a single
    // branch when nothing is firing.
    this.tickRingBurst(ctxRoom, dt);
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
      if (this.ringBurstPhase === "idle" && this.rbCooldownTimer > 0) {
        this.rbCooldownTimer = Math.max(0, this.rbCooldownTimer - dt);
      }
    }

    // === 3. Try to start an attack — priority-ordered ===
    // Each tryStart* short-circuits if any attack is already active
    // (including one started earlier in this same call chain), so on
    // a tied cooldown expiry the first one in this list wins.
    // Priority: ring burst > sweep > aimed > radial.
    // RB is the defining mechanic. Sweep is the phase-2+ signature.
    // Aimed is point threat. Radial is filler.
    this.tryStartRingBurst();
    this.tryStartSweepLaser(ctxRoom);
    this.tryStartAimedShot(ctxRoom);
    this.tryStartRadialBurst();

    // === 4. Mine field — phase-3 only. Parallel to the attack
    // rotation: independent timer, no mutex. Internally gated
    // on bossPhase === 3 so it's a no-op in phases 1 / 2.
    this.tickMineField(ctxRoom, dt);

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
    // shape. RB ghosting drops body collision during detach /
    // vulnerable / reassemble.
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
    // alpha across age so we get the visual for free. Shockwave 2
    // (a delayed second ring) was dropped during the visual budget
    // pass; it overlapped with shockwave 1 enough that the visual
    // delta wasn't worth the extra ring.
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
    // Outer ring's render config is computed per-frame, so its
    // max-angular-vel lives as a standalone constant; mid + inner
    // still pull from the static RingDepth configs.
    const maxVels = [
      OUTER_RING_MAX_ANGULAR_VEL,
      MID_RING_DEPTH.maxAngularVel,
      INNER_RING_DEPTH.maxAngularVel,
    ];
    for (let i = 0; i < this.ringStates.length; i++) {
      const r = this.ringStates[i];
      const maxVel = maxVels[i];
      // First-time init — schedule the first retarget so the ring
      // doesn't start motionless until the timer fires.
      if (r.nextChangeAtMs === 0) {
        r.targetAngularVel = randomAngularVel(maxVel);
        r.nextChangeAtMs = this.ringElapsedMs + nextRingRetargetMs();
      }
      // Retarget on timer.
      if (this.ringElapsedMs >= r.nextChangeAtMs) {
        r.targetAngularVel = randomAngularVel(maxVel);
        r.nextChangeAtMs = this.ringElapsedMs + nextRingRetargetMs();
      }
      // Smooth easing toward target so velocity changes don't jerk.
      r.angularVel +=
        (r.targetAngularVel - r.angularVel) * RING_ANGULAR_VEL_LERP;
      r.angle += r.angularVel * dt;
    }
  }

  private tickEnergyBurst(_ctxRoom: EnemyContext, dt: number): void {
    if (this.bossFlashTimer > 0) {
      this.bossFlashTimer = Math.max(0, this.bossFlashTimer - dt);
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
    // audio.play.alert();                  // boss sfx disabled — see public/audio/boss/
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
    // audio.play.bossRingDetach();         // boss sfx disabled
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
    // Crystalline reward chime — replaces the hitHeavy+alert
    // placeholder. The chime fronts a tiny noise pop for the impact
    // transient and a sustained C6+E6+G6 sine stack with reverb.
    // audio.play.bossEyeHit();              // boss sfx disabled
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
      this.ringBurstPhase !== "idle"
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
      // Phase-transition climax — dedicated BWAA + noise sizzle
      // replacing the hitHeavy+alert placeholder.
      // audio.play.bossPhase();              // boss sfx disabled
      if (t.toPhase === 2) {
        this.phaseMarkerFlashTimer1to2 = PHASE_TRANSITION_HP_MARKER_FLASH_SEC;
      } else {
        this.phaseMarkerFlashTimer2to3 = PHASE_TRANSITION_HP_MARKER_FLASH_SEC;
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
        // Reverse cue — heavy pull-back swell at firing-1 → mid-pause.
        // audio.play.bossSweepReverse(false); // boss sfx disabled
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
        // Brighter pitch of the same reverse swell — countdown
        // chirp before firing-2 starts.
        // audio.play.bossSweepReverse(true);  // boss sfx disabled
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
    // Rising warning drone for the telegraph window.
    // audio.play.bossSweepStart();         // boss sfx disabled
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

  /** Phase-3 mine field. Runs from updateCombat in parallel with
   *  the attack rotation (no mutex). Ages live mines, detonates
   *  them at MINE_TELEGRAPH_SEC, and tries to spawn a new mine on
   *  MINE_SPAWN_INTERVAL_SEC cadence up to MINE_MAX_ACTIVE.
   *  Filtered out automatically — phaseTransition cinematic short-
   *  circuits updateCombat, so detonations don't pop mid-cinematic
   *  (the timer just pauses for the cinematic's ~2 s, mines
   *  resume aging when combat resumes). */
  private tickMineField(ctxRoom: EnemyContext, dt: number): void {
    if (this.bossPhase !== 3) return;
    // Age + detonate. Detonation pushes its FX into ctxRoom; the
    // mine itself is filtered next frame.
    for (const m of this.mines) {
      m.age += dt;
      if (m.age >= MINE_TELEGRAPH_SEC) {
        this.detonateMine(m, ctxRoom);
      }
    }
    this.mines = this.mines.filter((m) => m.age < MINE_TELEGRAPH_SEC);
    // Spawn cadence — only resets on a successful spawn so a
    // crowded arena (5 active mines) keeps trying every frame
    // once one detonates.
    this.mineSpawnTimer += dt;
    if (
      this.mineSpawnTimer >= MINE_SPAWN_INTERVAL_SEC &&
      this.mines.length < MINE_MAX_ACTIVE
    ) {
      if (this.trySpawnMine(ctxRoom)) {
        this.mineSpawnTimer = 0;
      }
    }
  }

  /** Try to drop a mine at a random arena point that's at least
   *  MINE_MIN_DIST_FROM_PLAYER from the player and
   *  MINE_MIN_DIST_FROM_BOSS from the boss center. Up to
   *  MINE_SPAWN_MAX_ATTEMPTS rolls; if everything collides the
   *  caller can retry next tick. Returns true on a successful
   *  placement so the cadence timer only resets on success. */
  private trySpawnMine(ctxRoom: EnemyContext): boolean {
    const minPx = MINE_MIN_DIST_FROM_PLAYER * MINE_MIN_DIST_FROM_PLAYER;
    const minBx = MINE_MIN_DIST_FROM_BOSS * MINE_MIN_DIST_FROM_BOSS;
    const xMin = MINE_RADIUS;
    const xMax = this.arenaW - MINE_RADIUS;
    const yMin = MINE_RADIUS;
    const yMax = this.arenaH - MINE_RADIUS;
    for (let attempt = 0; attempt < MINE_SPAWN_MAX_ATTEMPTS; attempt++) {
      const x = xMin + Math.random() * (xMax - xMin);
      const y = yMin + Math.random() * (yMax - yMin);
      const dxP = x - ctxRoom.player.x;
      const dyP = y - ctxRoom.player.y;
      if (dxP * dxP + dyP * dyP < minPx) continue;
      const dxB = x - this.x;
      const dyB = y - this.y;
      if (dxB * dxB + dyB * dyB < minBx) continue;
      this.mines.push({ x, y, age: 0 });
      this.spawnMineFx(ctxRoom, x, y);
      return true;
    }
    return false;
  }

  /** Small spark burst on mine placement so the spawn reads as
   *  an event rather than a mine just appearing. */
  private spawnMineFx(
    ctxRoom: EnemyContext,
    x: number,
    y: number,
  ): void {
    for (let i = 0; i < MINE_SPAWN_PARTICLE_COUNT; i++) {
      const a = (i / MINE_SPAWN_PARTICLE_COUNT) * Math.PI * 2;
      ctxRoom.particles.push({
        x,
        y,
        vx: Math.cos(a) * MINE_SPAWN_PARTICLE_SPEED,
        vy: Math.sin(a) * MINE_SPAWN_PARTICLE_SPEED,
        initialSize: 4,
        color: MINE_COLOR,
        age: 0,
        lifetime: MINE_SPAWN_PARTICLE_LIFETIME_SEC,
        glowStrong: 8,
        glowSoft: 3,
        drag: 0.92,
      });
    }
    // Tense single beep so the player can locate the new mine by
    // ear before the strobe phase kicks in.
    // audio.play.bossMineSpawn();          // boss sfx disabled
  }

  /** Detonate a mine — radial 6-bullet burst (hex theme), one
   *  shockwave ring, particles, audio. Bullets origin at the
   *  mine; angles rotated so vertex 0 sits at top to match the
   *  mine outline. */
  private detonateMine(m: Mine, ctxRoom: EnemyContext): void {
    for (let i = 0; i < MINE_DETONATION_BULLET_COUNT; i++) {
      const a =
        HEX_TOP_OFFSET_RAD +
        (i / MINE_DETONATION_BULLET_COUNT) * Math.PI * 2;
      ctxRoom.bullets.push(
        makeBullet(
          m.x,
          m.y,
          Math.cos(a) * MINE_DETONATION_BULLET_SPEED,
          Math.sin(a) * MINE_DETONATION_BULLET_SPEED,
          false,
        ),
      );
    }
    ctxRoom.rings.push({
      x: m.x,
      y: m.y,
      age: 0,
      lifetime: MINE_DETONATION_RING_LIFETIME_SEC,
      startR: MINE_DETONATION_RING_R0,
      endR: MINE_DETONATION_RING_R1,
      color: MINE_COLOR,
      startLineWidth: MINE_DETONATION_RING_LW0,
      endLineWidth: MINE_DETONATION_RING_LW1,
      glowBlur: 12,
    });
    for (let i = 0; i < MINE_DETONATION_PARTICLE_COUNT; i++) {
      const a = (i / MINE_DETONATION_PARTICLE_COUNT) * Math.PI * 2;
      const ps =
        MINE_DETONATION_PARTICLE_SPEED_MIN +
        Math.random() *
          (MINE_DETONATION_PARTICLE_SPEED_MAX -
            MINE_DETONATION_PARTICLE_SPEED_MIN);
      ctxRoom.particles.push({
        x: m.x,
        y: m.y,
        vx: Math.cos(a) * ps,
        vy: Math.sin(a) * ps,
        initialSize: 5,
        color: MINE_COLOR,
        age: 0,
        lifetime: MINE_DETONATION_PARTICLE_LIFETIME_SEC,
        glowStrong: 10,
        glowSoft: 4,
        drag: 0.92,
      });
    }
    // Heavier than hitHeavy: sub thump + bandpass noise sizzle. Pulls
    // attention even when an attack is mid-firing.
    // audio.play.bossMineDetonate();       // boss sfx disabled
  }

  /** Render all live mines as pulsing hex outlines with a small
   *  center dot. Last MINE_STROBE_SEC of telegraph reads as a
   *  fast strobe so the detonation moment is unmissable. Drawn
   *  in world space; rooms-game wraps the boss's draw call in
   *  the camera transform already. */
  private renderMines(ctx: CanvasRenderingContext2D): void {
    if (this.mines.length === 0) return;
    for (const m of this.mines) {
      const t = m.age / MINE_TELEGRAPH_SEC;
      const inStrobe = m.age >= MINE_TELEGRAPH_SEC - MINE_STROBE_SEC;
      let alpha: number;
      if (inStrobe) {
        // Fast strobe: 4 full pulses across the strobe window.
        const u =
          (m.age - (MINE_TELEGRAPH_SEC - MINE_STROBE_SEC)) /
          MINE_STROBE_SEC;
        alpha = 0.4 + 0.6 * ((Math.sin(u * Math.PI * 8) + 1) / 2);
      } else {
        // Buildup pulse — base alpha grows from 0.4 to ~0.9 with
        // a slow sin shimmer on top so even early in the
        // telegraph the mine reads as "alive".
        const pulse = (Math.sin(m.age * 6) + 1) / 2;
        alpha = 0.4 + 0.4 * t + 0.1 * pulse;
      }
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.strokeStyle = MINE_COLOR;
      ctx.lineWidth = MINE_OUTLINE_LINE_WIDTH;
      ctx.globalAlpha = alpha;
      traceHexPath(ctx, MINE_RADIUS);
      ctx.stroke();
      ctx.fillStyle = MINE_COLOR;
      ctx.beginPath();
      ctx.arc(0, 0, MINE_CENTER_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
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
    // Mine field stops cold — live mines are dropped without
    // detonating so the dying cinematic isn't interrupted by a
    // late explosion. Bullets already in flight from earlier
    // detonations keep going (rooms-game owns them).
    this.mines = [];
    this.mineSpawnTimer = 0;
    this.phaseTransition = null;
    this.phaseMarkerFlashTimer1to2 = -1;
    this.phaseMarkerFlashTimer2to3 = -1;
  }

  private updateDying(ctxRoom: EnemyContext, dt: number): void {
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

    // Shake schedule: 4 px constant through the slow-mo hold; nothing
    // through the dead beat between hold-end and the buildup window;
    // 3 → 12 px ramp through the buildup; 16 px one-shot at the
    // detonation moment (fired below); 1 px ambient settling tremor
    // through the VICTORY hold.
    if (t < DYING_SLOWMO_HOLD_END_MS) {
      this.pendingShakePx = 4;
      this.pendingShakeSec = dt; // refresh each frame
    } else if (t >= DYING_BUILDUP_START_MS && t < DYING_FLASH_START_MS) {
      const u =
        (t - DYING_BUILDUP_START_MS) /
        (DYING_FLASH_START_MS - DYING_BUILDUP_START_MS);
      this.pendingShakePx =
        DYING_BUILDUP_SHAKE_MIN_PX +
        (DYING_BUILDUP_SHAKE_MAX_PX - DYING_BUILDUP_SHAKE_MIN_PX) * u;
      this.pendingShakeSec = dt;
    } else if (t >= DYING_AMBIENT_SHAKE_START_MS && t < DYING_TOTAL_MS) {
      this.pendingShakePx = DYING_AMBIENT_SHAKE_PX;
      this.pendingShakeSec = dt;
    }

    // ---- Buildup particles: every DYING_BUILDUP_PARTICLE_INTERVAL_SEC
    // seconds, spawn one absorption particle on a ring around the
    // boss centre that flies inward. Reads as the boss's shell being
    // sucked into the impending detonation.
    if (t >= DYING_BUILDUP_START_MS && t < DYING_FLASH_START_MS) {
      this.buildupParticleTimer += dt;
      while (
        this.buildupParticleTimer >= DYING_BUILDUP_PARTICLE_INTERVAL_SEC
      ) {
        this.buildupParticleTimer -= DYING_BUILDUP_PARTICLE_INTERVAL_SEC;
        const a = Math.random() * Math.PI * 2;
        const sx = this.deathX + Math.cos(a) * DYING_BUILDUP_PARTICLE_RING_RADIUS;
        const sy = this.deathY + Math.sin(a) * DYING_BUILDUP_PARTICLE_RING_RADIUS;
        // Inward velocity = away from spawn toward death centre.
        const sp =
          DYING_BUILDUP_PARTICLE_SPEED_MIN +
          Math.random() *
            (DYING_BUILDUP_PARTICLE_SPEED_MAX -
              DYING_BUILDUP_PARTICLE_SPEED_MIN);
        ctxRoom.particles.push({
          x: sx,
          y: sy,
          vx: -Math.cos(a) * sp,
          vy: -Math.sin(a) * sp,
          initialSize: 4,
          color: SENTINEL_COLOR,
          age: 0,
          lifetime: DYING_BUILDUP_PARTICLE_LIFETIME_SEC,
          glowStrong: 10,
          glowSoft: 4,
          drag: 0.96,
        });
      }
    }

    // ---- Detonation moment: one-shot when t crosses 3000 ms. Fires
    // 32 radial particles (half accent / half white), three concentric
    // shockwaves at different speeds (accent → white → green for the
    // hand-off to VICTORY), and a 16 px shake. The flash itself comes
    // from drawDyingOverlay.
    if (!this.detonationFired && t >= DYING_FLASH_START_MS) {
      this.detonationFired = true;
      this.fireDeathDetonation(ctxRoom);
    }

    // ---- Post-detonation force waves. Each schedule entry fires
    // exactly once when stateTimer crosses its startMs; the wave
    // is a single ring with a long lifetime + large endR so it
    // sweeps across the whole arena. A 4 px / 120 ms percussive
    // shake punctuates each wave (wins against the 1 px ambient
    // tremor via triggerShake's max-amplitude rule). while-loop
    // so multiple waves can fire on the same frame if a long
    // unscaledDt step (e.g. tab refocus) skips past several
    // schedule entries at once.
    while (
      this.postWavesFired < POST_WAVE_SCHEDULE.length &&
      t >= POST_WAVE_SCHEDULE[this.postWavesFired].startMs
    ) {
      const w = POST_WAVE_SCHEDULE[this.postWavesFired];
      ctxRoom.rings.push({
        x: this.deathX,
        y: this.deathY,
        age: 0,
        lifetime: w.lifetimeSec,
        startR: POST_WAVE_START_R,
        endR: w.endR,
        color: w.color,
        startLineWidth: POST_WAVE_LW_START,
        endLineWidth: POST_WAVE_LW_END,
        glowBlur: POST_WAVE_GLOW_BLUR,
      });
      this.pendingShakePx = POST_WAVE_SHAKE_PX;
      this.pendingShakeSec = POST_WAVE_SHAKE_SEC;
      this.postWavesFired++;
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

  /** Detonation moment of the death cinematic — fires once when
   *  stateTimer crosses DYING_FLASH_START_MS. Pushes 32 radial
   *  particles, three concentric shockwaves (accent / white /
   *  green hand-off into VICTORY), and a single 16 px shake into
   *  ctxRoom + the shake channel. The full-screen white flash is
   *  drawn separately by drawDyingOverlay. */
  private fireDeathDetonation(ctxRoom: EnemyContext): void {
    // Particles — alternate accent + white so the radial spray reads
    // as both a "boss exploded" (accent) and a flash kick (white).
    for (let i = 0; i < DYING_DETONATION_PARTICLE_COUNT; i++) {
      const a =
        (i / DYING_DETONATION_PARTICLE_COUNT) * Math.PI * 2 +
        Math.random() * 0.05;
      const sp =
        DYING_DETONATION_PARTICLE_SPEED_MIN +
        Math.random() *
          (DYING_DETONATION_PARTICLE_SPEED_MAX -
            DYING_DETONATION_PARTICLE_SPEED_MIN);
      ctxRoom.particles.push({
        x: this.deathX,
        y: this.deathY,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        initialSize: i % 2 === 0 ? 5 : 4,
        color: i % 2 === 0 ? SENTINEL_COLOR : "#ffffff",
        age: 0,
        lifetime: DYING_DETONATION_PARTICLE_LIFETIME_SEC,
        glowStrong: 12,
        glowSoft: 5,
        drag: 0.93,
      });
    }
    // Three shockwaves stacked at the death position.
    ctxRoom.rings.push({
      x: this.deathX,
      y: this.deathY,
      age: 0,
      lifetime: DYING_DETONATION_RING1_LIFETIME_SEC,
      startR: DYING_DETONATION_RING1_R0,
      endR: DYING_DETONATION_RING1_R1,
      color: SENTINEL_COLOR,
      startLineWidth: DYING_DETONATION_RING1_LW0,
      endLineWidth: DYING_DETONATION_RING1_LW1,
      glowBlur: 18,
    });
    ctxRoom.rings.push({
      x: this.deathX,
      y: this.deathY,
      age: 0,
      lifetime: DYING_DETONATION_RING2_LIFETIME_SEC,
      startR: DYING_DETONATION_RING2_R0,
      endR: DYING_DETONATION_RING2_R1,
      color: "#ffffff",
      startLineWidth: DYING_DETONATION_RING2_LW0,
      endLineWidth: DYING_DETONATION_RING2_LW1,
      glowBlur: 14,
    });
    ctxRoom.rings.push({
      x: this.deathX,
      y: this.deathY,
      age: 0,
      lifetime: DYING_DETONATION_RING3_LIFETIME_SEC,
      startR: DYING_DETONATION_RING3_R0,
      endR: DYING_DETONATION_RING3_R1,
      color: VICTORY_COLOR,
      startLineWidth: DYING_DETONATION_RING3_LW0,
      endLineWidth: DYING_DETONATION_RING3_LW1,
      glowBlur: 12,
    });
    this.pendingShakePx = DYING_DETONATION_SHAKE_PX;
    this.pendingShakeSec = DYING_DETONATION_SHAKE_SEC;
    // audio.play.hitHeavy();                // boss sfx disabled (death)
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
    // Phase-3 mines — drawn under the body so the boss stays the
    // focal point. Mines are spawned with player + boss exclusion
    // zones so the body rarely covers one anyway, and the strobe
    // window in the last 200 ms cuts through any overlap.
    this.renderMines(ctx);
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

  /** Build the outer-ring depth config for THIS frame. The outer
   *  ring switches between "red solid" and "cyan dashed" modes
   *  across Ring Burst — solid red `accent` in
   *  idle/attacking/telegraph/recovery, `#7dd3fc` dashed during
   *  detach/vulnerable/reassemble. Color crossfades over 300 ms
   *  at the telegraph → detach and reassemble → recovery edges.
   *  Dash pattern flips on/off on those same edges (interpolating
   *  the pattern itself looks glitchy). Animated `lineDashOffset`
   *  comes from `combatElapsedSec` so the dashes march steadily
   *  across the whole fight. */
  private computeOuterRingDepth(): RingDepth {
    const red = this.accentColor();
    const cyan = RB_OUTER_CYAN_COLOR;
    const phase = this.ringBurstPhase;
    let color: string;
    let glowLineWidth: number;
    let glowAlpha: number;
    let dashed: boolean;
    if (phase === "detach") {
      const t = Math.min(1, this.rbTimer / RB_OUTER_TRANSITION_SEC);
      color = lerpHex(red, cyan, t);
      glowLineWidth =
        RB_OUTER_RED_GLOW_LW +
        (RB_OUTER_CYAN_GLOW_LW - RB_OUTER_RED_GLOW_LW) * t;
      glowAlpha =
        RB_OUTER_RED_GLOW_ALPHA +
        (RB_OUTER_CYAN_GLOW_ALPHA - RB_OUTER_RED_GLOW_ALPHA) * t;
      dashed = true;
    } else if (phase === "vulnerable" || phase === "reassemble") {
      color = cyan;
      glowLineWidth = RB_OUTER_CYAN_GLOW_LW;
      glowAlpha = RB_OUTER_CYAN_GLOW_ALPHA;
      dashed = true;
    } else if (phase === "recovery") {
      // Recovery's `rbTimer` runs 0 → RB_RECOVERY_SEC. Lerp the
      // first 300 ms back to red; dashes are off the moment we
      // entered recovery so the boundary reads as "the dash
      // window just closed."
      const t = Math.min(1, this.rbTimer / RB_OUTER_TRANSITION_SEC);
      color = lerpHex(cyan, red, t);
      glowLineWidth =
        RB_OUTER_CYAN_GLOW_LW +
        (RB_OUTER_RED_GLOW_LW - RB_OUTER_CYAN_GLOW_LW) * t;
      glowAlpha =
        RB_OUTER_CYAN_GLOW_ALPHA +
        (RB_OUTER_RED_GLOW_ALPHA - RB_OUTER_CYAN_GLOW_ALPHA) * t;
      dashed = false;
    } else {
      // idle / attacking / telegraph
      color = red;
      glowLineWidth = RB_OUTER_RED_GLOW_LW;
      glowAlpha = RB_OUTER_RED_GLOW_ALPHA;
      dashed = false;
    }
    return {
      glowColor: color,
      glowLineWidth,
      glowAlpha,
      brightColor: color,
      brightLineWidth: 4,
      brightAlpha: 1.0,
      brightDashPattern: dashed ? RB_OUTER_CYAN_DASH_PATTERN : undefined,
      brightDashOffset: dashed
        ? -this.combatElapsedSec * RB_OUTER_CYAN_DASH_RATE_PX_PER_SEC
        : undefined,
      markerCount: 2,
      markerColor: "#ffffff",
      markerLineWidth: 5,
      maxAngularVel: OUTER_RING_MAX_ANGULAR_VEL,
    };
  }

  private renderDepthRing(
    ctx: CanvasRenderingContext2D,
    radius: number,
    rotState: { angle: number },
    depth: RingDepth,
    /** Alpha multiplier on glow + main + markers. Used by Ring
     *  Burst transitions to fade mid + inner across detach +
     *  reassemble without snapping. 1 if omitted. */
    alphaMul = 1,
    /** Optional override of the main-stroke alpha (after alphaMul).
     *  Outer ring uses this for its slow sub-pulse. */
    brightAlphaOverride?: number,
  ): void {
    ctx.save();
    ctx.rotate(rotState.angle);
    // Optional outer glow — single wide low-alpha pass on the
    // hex outline. Mid + inner shells skip this entirely
    // (`glowColor === null`).
    if (depth.glowColor !== null) {
      traceHexPath(ctx, radius);
      ctx.strokeStyle = depth.glowColor;
      ctx.lineWidth = depth.glowLineWidth;
      ctx.globalAlpha = depth.glowAlpha * alphaMul;
      ctx.stroke();
    }
    // Main stroke (optionally dashed for the inner shell + outer
    // cyan-mode). `brightDashOffset` is animated by the caller to
    // give the dashes a marching effect along the perimeter; on a
    // hex the dash pattern resets at each corner segment which
    // reads as fine for the small inner shell.
    traceHexPath(ctx, radius);
    ctx.strokeStyle = depth.brightColor;
    ctx.lineWidth = depth.brightLineWidth;
    ctx.globalAlpha = (brightAlphaOverride ?? depth.brightAlpha) * alphaMul;
    if (depth.brightDashPattern) {
      ctx.setLineDash(depth.brightDashPattern);
      if (depth.brightDashOffset !== undefined) {
        ctx.lineDashOffset = depth.brightDashOffset;
      }
    }
    ctx.stroke();
    if (depth.brightDashPattern) {
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    // Rotation markers — small filled diamond rivets pinned to
    // hex vertices. Marker count is config-driven (0 disables);
    // markers distribute across the 6 vertices so e.g. count=2
    // sits at top + bottom, count=3 at every other vertex.
    if (depth.markerCount > 0) {
      ctx.fillStyle = depth.markerColor;
      ctx.globalAlpha = (depth.markerAlpha ?? 1) * alphaMul;
      const r = depth.markerLineWidth * 1.8;
      for (let i = 0; i < depth.markerCount; i++) {
        const vIdx = Math.floor(
          (i * HEX_VERTEX_COUNT) / depth.markerCount,
        );
        const a =
          HEX_TOP_OFFSET_RAD +
          (vIdx * Math.PI * 2) / HEX_VERTEX_COUNT;
        const vx = radius * Math.cos(a);
        const vy = radius * Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(vx, vy - r);
        ctx.lineTo(vx + r, vy);
        ctx.lineTo(vx, vy + r);
        ctx.lineTo(vx - r, vy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private renderEyeLayers(ctx: CanvasRenderingContext2D): void {
    // Compressed from 8 layers + 8 radial spokes to 4 layers in the
    // visual-budget pass. Vulnerable adds a separate halo on top of
    // the static stack and overrides the rim / pupil colours so the
    // open-eye reads as the gold target.
    const vulnerable = this.ringBurstPhase === "vulnerable";
    let breathScale: number;
    if (vulnerable) {
      // Vulnerable amplification — bigger asymmetric pulse around
      // RB_EYE_VULNERABLE_SCALE_MID = 1.04 (so the eye sits a bit
      // larger than rest).
      breathScale =
        RB_EYE_VULNERABLE_SCALE_MID +
        Math.sin(this.eyeVulnerablePulsePhase) *
          RB_EYE_VULNERABLE_SCALE_AMPLITUDE;
    } else {
      breathScale =
        EYE_SCALE_MIN +
        ((Math.sin(this.eyeBreathPhase) + 1) / 2) *
          (EYE_SCALE_MAX - EYE_SCALE_MIN);
    }

    ctx.save();
    ctx.scale(breathScale, breathScale);

    // Vulnerable-only outermost halo — drawn FIRST so the rest of
    // the stack paints over it. Pulses alpha 0.18 ↔ 0.40 in
    // lockstep with the breath cycle.
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
      let stroke = layer.stroke;
      let fill = layer.fill;
      const lineWidth = layer.lineWidth;
      const alpha = layer.alpha ?? 1;
      if (vulnerable) {
        // Amber rim brightens to `#ffbb33`; pupil core flips to
        // neutral white so the contrast against the gold rim reads
        // cleanly. The other two layers stay the same.
        if (i === 0 && stroke) stroke = "#ffbb33";
        if (i === 3 && fill) fill = "#ffffff";
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
    const bodyGlowAlpha =
      (BODY_GLOW_ALPHA_MIN +
        ((Math.sin(this.bodyBreathPhase) + 1) / 2) *
          (BODY_GLOW_ALPHA_MAX - BODY_GLOW_ALPHA_MIN)) *
      rbGlowMul;

    // Body silhouette — single hex frame painted as a glow + main
    // pair (was a `drawNeon` two-pass shadowBlur stack + nested
    // MIDDLE / INNER hexes; the inner hexes were decorative
    // "circuitry" that didn't carry gameplay info). The glow alpha
    // tracks bodyGlowAlpha for the breath sync; main is the
    // canonical 2.5 px accent stroke. Whole pair is wrapped in
    // bodyOpacity so it ghosts during Ring Burst detach /
    // vulnerable / reassemble. Radial-burst telegraph widens the
    // glow line so the silhouette flares without an extra stroke pass.
    const hexAccent = this.accentColor();
    ctx.save();
    ctx.rotate(this.rotation);
    const glowLineWidth = this.radialPhase === "telegraph" ? 14 : 8;
    // Glow pass — wide, low alpha.
    strokeHexagon(ctx, OUTER_VERTS, pulseScale);
    ctx.strokeStyle = hexAccent;
    ctx.lineWidth = glowLineWidth;
    ctx.globalAlpha = bodyGlowAlpha * this.bodyOpacity;
    ctx.stroke();
    // Main pass — crisp accent edge.
    strokeHexagon(ctx, OUTER_VERTS, pulseScale);
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = this.bodyOpacity;
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
    // Outer ring config is built per-frame so the color +
    // dashing can crossfade across Ring Burst phase edges
    // (telegraph → detach goes red → cyan dashed; reassemble →
    // recovery goes the other way). The previous separate
    // "cyan indicator drawn under the outer" stroke is gone —
    // it's the same ring now, with a phase-conditional render.
    const outerDepth: RingDepth = this.computeOuterRingDepth();
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

    // (The six counter-rotating "rivet" fragments at the outer
    // vertices were dropped in the visual-budget pass — they were
    // decorative and didn't carry gameplay info. `fragmentRotation`
    // still ticks but is unused by this renderer.)

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
    // White flash: 0 → DYING_FLASH_PEAK_ALPHA across
    // [3000, 3050], peak → 0 across [3050, 3300]. Bumped from 0.7
    // to 0.95 so the screen actually blows out at the detonation
    // moment without burning fully white.
    if (t >= DYING_FLASH_START_MS && t < DYING_FLASH_END_MS) {
      let alpha;
      if (t < DYING_FLASH_PEAK_MS) {
        alpha =
          DYING_FLASH_PEAK_ALPHA *
          ((t - DYING_FLASH_START_MS) /
            (DYING_FLASH_PEAK_MS - DYING_FLASH_START_MS));
      } else {
        alpha =
          DYING_FLASH_PEAK_ALPHA *
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
    // VICTORY title — fade in over 300 ms starting at 3050, then hold.
    // Scale-pulse on entry: starts at 0.85, overshoots past 1.05, then
    // settles at 1.0. The scale is keyed on the same fade-in window so
    // the pulse lands exactly when the text is at full opacity.
    if (t >= DYING_VICTORY_START_MS) {
      const fadeWindow =
        DYING_VICTORY_FADE_IN_END_MS - DYING_VICTORY_START_MS;
      const u = Math.min(1, (t - DYING_VICTORY_START_MS) / fadeWindow);
      const alpha = u;
      // easeOutBack-ish overshoot: 0..0.6 ramps start → overshoot,
      // 0.6..1.0 settles overshoot → 1.0. Same shape used for the
      // intro scale on the boss body.
      let scale: number;
      if (u < 0.6) {
        const s = u / 0.6;
        scale =
          DYING_VICTORY_SCALE_START +
          (DYING_VICTORY_SCALE_OVERSHOOT - DYING_VICTORY_SCALE_START) * s;
      } else {
        const s = (u - 0.6) / 0.4;
        scale =
          DYING_VICTORY_SCALE_OVERSHOOT +
          (1 - DYING_VICTORY_SCALE_OVERSHOOT) * s;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(viewW / 2, viewH / 2);
      ctx.scale(scale, scale);
      ctx.font = "700 60px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = VICTORY_COLOR;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = VICTORY_COLOR;
      ctx.shadowBlur = 24;
      ctx.fillText("VICTORY", 0, 0);
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
    // God-mode dev shortcut — any dash through the body kills the
    // boss outright. Skips the body-vs-eye distinction so we can
    // trigger the death cinematic from any phase without grinding
    // for a Ring Burst window.
    if (isGodMode()) {
      const dx = px - this.x;
      const dy = py - this.y;
      const r = SENTINEL_HITBOX_RADIUS + half;
      if (dx * dx + dy * dy < r * r) {
        this.takeDamage(SENTINEL_HP_MAX);
        return true;
      }
      return false;
    }
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
