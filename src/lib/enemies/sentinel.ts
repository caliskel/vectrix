import { audio } from "../audio";
import { makeBullet } from "../bullets";
import { drawNeon } from "../neon";
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
const SENTINEL_HP_MAX = 30;
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
const RB_DETACH_SEC = 0.3;
const RB_VULNERABLE_SEC = 3.0;
const RB_REASSEMBLE_SEC = 0.5;
const RB_RECOVERY_SEC = 0.5;
const RB_COOLDOWN_SEC = 8.0;

// Default + expanded ring radii. Detach lerps the live radii from
// the default values to the expanded ones; reassemble lerps back.
const RB_RING_DEFAULT_OUTER = 110;
const RB_RING_DEFAULT_MID = 85;
const RB_RING_DEFAULT_INNER = 60;
const RB_RING_EXPANDED_OUTER = 180;
const RB_RING_EXPANDED_MID = 130;
const RB_RING_EXPANDED_INNER = 95;

const RB_BODY_OPACITY_GHOSTED = 0.25;
const RB_TELEGRAPH_JITTER_PX = 3;
const RB_TELEGRAPH_GLOW_BOOST = 1.6;

// Eye behaviour during vulnerable.
const RB_EYE_HITBOX_RADIUS = 20;
const RB_EYE_HIT_DAMAGE = 3;
const RB_EYE_VULNERABLE_SCALE_AMPLITUDE = 0.09; // ≈ 0.91 ↔ 1.09
const RB_EYE_VULNERABLE_SCALE_PERIOD_SEC = 0.7;
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

function randomAngularVel(max: number): number {
  return (Math.random() * 2 - 1) * max;
}

function nextRingRetargetMs(): number {
  return (
    RING_RETARGET_MIN_MS +
    Math.random() * (RING_RETARGET_MAX_MS - RING_RETARGET_MIN_MS)
  );
}

export type SentinelState =
  | "intro"
  | "idle"
  | "attacking"
  | "dying"
  | "defeated";

type AttackPhase = "idle" | "telegraph" | "firing" | "recovery";

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
  private aimedLockX = 0;
  private aimedLockY = 0;
  private aimedAngle = 0;
  private aimedShotsFired = 0;
  private aimedDashOffset = 0; // crawl offset for the dashed telegraph line

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
  // Set true on a successful eye dash-through; tickRingBurst drains
  // it next frame so triggerEyeHitFeedback can fire with ctxRoom in
  // hand (tryDashDamage doesn't get ctxRoom in its signature).
  private pendingEyeHit = false;

  // damage / death
  private dashIdAlreadyDamaged = -1;

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
    if (this.state !== "idle" && this.state !== "attacking") return;
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
    // Figure-8 (lemniscate) around the arena centre — fully
    // independent of the player. amplitudes are inset by hitbox +
    // FIGURE_EIGHT_EDGE_PAD_PX so the path never crosses walls. dt
    // is in seconds — figurePhase walks the lemniscate at one full
    // loop every FIGURE_EIGHT_PERIOD_SEC.
    this.figurePhase +=
      (Math.PI * 2 * dt) / FIGURE_EIGHT_PERIOD_SEC;
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
    const targetX = centerX + ampX * Math.sin(t);
    const targetY = centerY + ampY * Math.sin(t) * Math.cos(t);
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

    // Track combat-state elapsed time so the first Ring Burst has
    // a grace period from the moment the player enters fight.
    this.combatElapsedSec += dt;
    // Ring Burst takes priority over the other two attacks. Tick
    // its phase machine first; while it's non-idle, radial / aimed
    // sub-machines and their idle timers freeze.
    this.tickRingBurst(ctxRoom, dt);
    if (this.eyeHitstopTimer > 0) {
      this.eyeHitstopTimer = Math.max(0, this.eyeHitstopTimer - dt);
      this.timeScale =
        this.eyeHitstopTimer > 0 ? RB_EYE_HITSTOP_TIMESCALE : 1;
    } else if (this.timeScale !== 1) {
      // Restore default in combat states (dying owns its own ramp).
      this.timeScale = 1;
    }
    const ringBurstActive = this.ringBurstPhase !== "idle";

    // === Attack scheduling — dual sub-state machines ===
    // Only one attack runs at a time. Whichever attack is in a
    // non-idle phase blocks the other one's cooldown from ticking,
    // so the boss reads as "doing one thing." When both are idle
    // and at least one is ready, the one that's been ready longer
    // wins (overshoot comparison). Ring Burst pre-empts both — its
    // active phases freeze every other timer.
    const radialBlocked = this.aimedPhase !== "idle" || ringBurstActive;
    const aimedBlocked = this.radialPhase !== "idle" || ringBurstActive;

    // ---- Radial sub-machine ----
    if (!radialBlocked) {
      if (this.radialPhase === "idle") {
        this.radialIdleTimer += dt;
      } else {
        this.radialTimer += dt;
        if (this.radialPhase === "telegraph" && this.radialTimer >= RADIAL_TELEGRAPH_SEC) {
          this.radialPhase = "firing";
          this.radialTimer = 0;
          this.fireRadialBurst(ctxRoom);
        } else if (this.radialPhase === "firing" && this.radialTimer >= RADIAL_FIRING_SEC) {
          this.radialPhase = "recovery";
          this.radialTimer = 0;
        } else if (this.radialPhase === "recovery" && this.radialTimer >= RADIAL_RECOVERY_SEC) {
          this.radialPhase = "idle";
          this.radialTimer = 0;
          this.radialIdleTimer = 0;
        }
      }
    }

    // ---- Aimed sub-machine ----
    if (!aimedBlocked) {
      if (this.aimedPhase === "idle") {
        this.aimedIdleTimer += dt;
      } else {
        this.aimedTimer += dt;
        if (this.aimedPhase === "telegraph") {
          // crawl the dashed-line offset so the line reads "live"
          const span = AIMED_DASH_PATTERN[0] + AIMED_DASH_PATTERN[1];
          this.aimedDashOffset =
            (this.aimedDashOffset + AIMED_DASH_RATE * dt) % span;
          if (this.aimedTimer >= AIMED_TELEGRAPH_SEC) {
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
    }

    // ---- Decide whether to start an attack now ----
    if (this.radialPhase === "idle" && this.aimedPhase === "idle") {
      const radialReady = this.radialIdleTimer >= RADIAL_IDLE_GAP_SEC;
      const aimedReady = this.aimedIdleTimer >= AIMED_COOLDOWN_SEC;
      if (radialReady || aimedReady) {
        const radialOver = this.radialIdleTimer - RADIAL_IDLE_GAP_SEC;
        const aimedOver = this.aimedIdleTimer - AIMED_COOLDOWN_SEC;
        if (radialReady && (!aimedReady || radialOver >= aimedOver)) {
          this.radialPhase = "telegraph";
          this.radialTimer = 0;
        } else if (aimedReady) {
          this.beginAimedShot(ctxRoom);
        }
      }
    }

    // Reflect activity back into the public state field — rooms-game
    // reads this for HP-bar visibility / kill-credit transitions.
    this.state =
      this.radialPhase !== "idle" || this.aimedPhase !== "idle"
        ? "attacking"
        : "idle";

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
        const dist = Math.sqrt(distSq);
        const band = RB_RING_STROKE_HIT_HALFWIDTH + half;
        const radii = [
          this.ringRadiusOuter,
          this.ringRadiusMid,
          this.ringRadiusInner,
        ];
        for (const rr of radii) {
          if (Math.abs(dist - rr) < band) {
            this.requestPlayerHit = true;
            break;
          }
        }
      }
    }
  }

  /** Body takes / deals contact damage during RB-idle, telegraph,
   *  recovery (and trivially when no RB is active). */
  private bodyDamageActive(): boolean {
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
    this.aimedLockX = player.x;
    this.aimedLockY = player.y;
    this.aimedAngle = Math.atan2(
      this.aimedLockY - this.y,
      this.aimedLockX - this.x,
    );
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
  private tickRingBurst(ctxRoom: EnemyContext, dt: number): void {
    // Eye-hit feedback is deferred from tryDashDamage to here so we
    // have ctxRoom (rings + particles + audio).
    if (this.pendingEyeHit) {
      this.pendingEyeHit = false;
      this.triggerEyeHitFeedback(ctxRoom);
    }
    if (this.ringBurstPhase === "idle") {
      // Tick cooldown only while idle so the rest of the timer
      // semantics — "8 s after recovery" — match the spec.
      if (this.rbCooldownTimer > 0) {
        this.rbCooldownTimer = Math.max(0, this.rbCooldownTimer - dt);
      }
      const cooldownReady = this.rbCooldownTimer <= 0;
      const graceReady = this.combatElapsedSec >= RB_FIRST_GRACE_SEC;
      const otherIdle =
        this.radialPhase === "idle" && this.aimedPhase === "idle";
      if (cooldownReady && graceReady && otherIdle) {
        this.beginRingBurstTelegraph();
      }
      return;
    }

    this.rbTimer += dt;
    switch (this.ringBurstPhase) {
      case "telegraph":
        if (this.rbTimer >= RB_TELEGRAPH_SEC) {
          this.enterRingBurstDetach(ctxRoom);
        }
        break;
      case "detach": {
        const t = Math.min(1, this.rbTimer / RB_DETACH_SEC);
        const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
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
        const eased = t * t; // easeInQuad
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
          this.rbCooldownTimer = RB_COOLDOWN_SEC;
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
    this.timeScale = 1;
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
    // sit on top of the boss silhouette).
    if (this.aimedPhase === "telegraph") {
      this.renderAimedTelegraph(ctx);
    }
    this.renderBody(ctx, 1);
    if (this.streamers.length > 0) {
      this.renderStreamers(ctx);
    }
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
    // Locked dashed line from boss centre out to the arena edge in
    // the direction captured at telegraph entry. Crawls forward at
    // AIMED_DASH_RATE to read as a live threat.
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

    // Pulsing diamond on the locked target — sin wave at the
    // telegraph-window frequency so it does roughly two pulses
    // before the bullets fly.
    const pulse =
      1 +
      0.2 *
        Math.sin(
          (this.aimedTimer / AIMED_TELEGRAPH_SEC) * Math.PI * 4,
        );
    const half = (AIMED_DIAMOND_SIZE / 2) * pulse;
    ctx.save();
    ctx.translate(this.aimedLockX, this.aimedLockY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = SENTINEL_COLOR;
    ctx.shadowColor = SENTINEL_COLOR;
    ctx.shadowBlur = AIMED_LINE_GLOW;
    ctx.fillRect(-half, -half, half * 2, half * 2);
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
  ): void {
    ctx.save();
    ctx.rotate(rotState.angle);
    // Shadow stroke first — gives the ring perceived thickness.
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = depth.shadowColor;
    ctx.lineWidth = depth.shadowLineWidth;
    ctx.globalAlpha = depth.shadowAlpha;
    ctx.stroke();
    // Bright stroke on top.
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = depth.brightColor;
    ctx.lineWidth = depth.brightLineWidth;
    ctx.globalAlpha = depth.brightAlpha;
    ctx.stroke();
    // Three rotation-tracking arc markers — without them a perfect
    // circle reads as static even when angle is changing.
    ctx.strokeStyle = depth.markerColor;
    ctx.lineWidth = depth.markerLineWidth;
    ctx.globalAlpha = 1;
    for (let i = 0; i < RING_MARKER_COUNT; i++) {
      const start = (i / RING_MARKER_COUNT) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, start, start + RING_MARKER_ARC_RAD);
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
      // Vulnerable amplification — bigger pulse on a faster phase
      // and a fully-on amber rim to read as "shoot here."
      breathScale =
        1 +
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

    for (let i = 0; i < EYE_LAYERS.length; i++) {
      const layer = EYE_LAYERS[i];
      ctx.beginPath();
      ctx.arc(0, 0, layer.r, 0, Math.PI * 2);
      // First (outermost) layer's alpha is driven by breath so the
      // glow brightens with the inhale.
      const alpha =
        i === 0 ? extGlowAlpha : (layer.alpha ?? 1);
      ctx.globalAlpha = alpha;
      if (layer.fill) {
        ctx.fillStyle = layer.fill;
        ctx.fill();
      }
      if (layer.stroke && layer.lineWidth) {
        ctx.strokeStyle = layer.stroke;
        ctx.lineWidth = layer.lineWidth;
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

    // Outer ring with a glow halo — alpha tracks bodyGlowAlpha for
    // the breath sync. Whole hex stack is wrapped in bodyOpacity so
    // it ghosts during Ring Burst detach / vulnerable / reassemble.
    ctx.save();
    ctx.rotate(this.rotation);
    ctx.globalAlpha = this.bodyOpacity;
    drawNeon(
      ctx,
      () => {
        ctx.globalAlpha = bodyGlowAlpha * this.bodyOpacity;
        strokeHexagon(ctx, OUTER_VERTS, pulseScale);
        ctx.strokeStyle = SENTINEL_COLOR;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = this.bodyOpacity;
      },
      SENTINEL_COLOR,
      this.radialPhase === "telegraph" ? 40 : 22,
      10,
    );

    ctx.globalAlpha = 0.7 * this.bodyOpacity;
    strokeHexagon(ctx, MIDDLE_VERTS, pulseScale);
    ctx.strokeStyle = SENTINEL_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.globalAlpha = 0.5 * this.bodyOpacity;
    strokeHexagon(ctx, INNER_VERTS, pulseScale);
    ctx.strokeStyle = SENTINEL_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    // === Three independently-rotating depth rings ===
    this.renderDepthRing(
      ctx,
      this.ringRadiusOuter,
      this.ringStates[0],
      OUTER_RING_DEPTH,
    );
    this.renderDepthRing(
      ctx,
      this.ringRadiusMid,
      this.ringStates[1],
      MID_RING_DEPTH,
    );
    this.renderDepthRing(
      ctx,
      this.ringRadiusInner,
      this.ringStates[2],
      INNER_RING_DEPTH,
    );

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
    if (dashId === this.dashIdAlreadyDamaged) return false;
    // Ring Burst vulnerable: only the eye is a valid target. Body
    // is intangible, ring damage is contact-only (handled in
    // updateCombat). Eye hit deals RB_EYE_HIT_DAMAGE and queues the
    // heavy feedback for the next update tick.
    if (this.ringBurstPhase === "vulnerable") {
      const dx = px - this.x;
      const dy = py - this.y;
      const r = RB_EYE_HITBOX_RADIUS + half;
      if (dx * dx + dy * dy >= r * r) return false;
      this.dashIdAlreadyDamaged = dashId;
      this.takeDamage(RB_EYE_HIT_DAMAGE);
      this.pendingEyeHit = true;
      return true;
    }
    // Body path — only when the body is solid.
    if (!this.bodyDamageActive()) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    const r = SENTINEL_HITBOX_RADIUS + half;
    if (dx * dx + dy * dy >= r * r) return false;
    this.dashIdAlreadyDamaged = dashId;
    this.takeDamage(1);
    return true;
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
