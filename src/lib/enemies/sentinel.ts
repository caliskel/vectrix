import { makeBullet } from "../bullets";
import { drawNeon } from "../neon";
import { PALETTE } from "../palette";
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
const EYE_PULSE_AMPLITUDE = 0.05;

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

export type SentinelState =
  | "intro"
  | "idle"
  | "attacking"
  | "dying"
  | "defeated";

type AttackPhase = "idle" | "telegraph" | "firing" | "recovery";

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

  // anim
  private rotation = 0;
  private fragmentRotation = 0;
  private pulsePhase = Math.random() * Math.PI * 2;
  private eyePulsePhase = Math.random() * Math.PI * 2;

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

    // === Attack scheduling — dual sub-state machines ===
    // Only one attack runs at a time. Whichever attack is in a
    // non-idle phase blocks the other one's cooldown from ticking,
    // so the boss reads as "doing one thing." When both are idle
    // and at least one is ready, the one that's been ready longer
    // wins (overshoot comparison).
    const radialBlocked = this.aimedPhase !== "idle";
    const aimedBlocked = this.radialPhase !== "idle";

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
    // of it), then the body.
    if (this.aimedPhase === "telegraph") {
      this.renderAimedTelegraph(ctx);
    }
    this.renderBody(ctx, 1);
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

  private renderBody(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (scale !== 1) ctx.scale(scale, scale);

    // Telegraph jitter — small random offset while charging the
    // radial burst. Aimed-shot telegraph doesn't shake the body
    // (the line + diamond carry the read).
    if (this.radialPhase === "telegraph") {
      const t = Math.min(1, this.radialTimer / RADIAL_TELEGRAPH_SEC);
      const intensity = 2 * t;
      ctx.translate(
        (Math.random() - 0.5) * intensity * 2,
        (Math.random() - 0.5) * intensity * 2,
      );
    }

    const pulseScale = 1 + Math.sin(this.pulsePhase) * PULSE_AMPLITUDE;
    const eyePulseScale =
      1 + Math.sin(this.eyePulsePhase) * EYE_PULSE_AMPLITUDE;

    ctx.save();
    ctx.rotate(this.rotation);

    drawNeon(
      ctx,
      () => {
        strokeHexagon(ctx, OUTER_VERTS, pulseScale);
        ctx.strokeStyle = SENTINEL_COLOR;
        ctx.lineWidth = 3;
        ctx.stroke();
      },
      SENTINEL_COLOR,
      this.radialPhase === "telegraph" ? 40 : 22,
      10,
    );

    ctx.globalAlpha = 0.7;
    strokeHexagon(ctx, MIDDLE_VERTS, pulseScale);
    ctx.strokeStyle = SENTINEL_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.globalAlpha = 0.5;
    strokeHexagon(ctx, INNER_VERTS, pulseScale);
    ctx.strokeStyle = SENTINEL_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    // Fragments orbiting the outer vertices — counter-rotation.
    ctx.save();
    ctx.rotate(this.fragmentRotation);
    ctx.fillStyle = SENTINEL_COLOR;
    ctx.globalAlpha = 0.85;
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

    // Central eye.
    ctx.fillStyle = SENTINEL_COLOR;
    ctx.globalAlpha = 0.45;
    circle(ctx, 0, 0, 35 * eyePulseScale);

    ctx.fillStyle = PALETTE.bg;
    ctx.globalAlpha = 1;
    circle(ctx, 0, 0, 22 * eyePulseScale);

    ctx.fillStyle = SENTINEL_COLOR;
    ctx.globalAlpha = 0.9;
    circle(ctx, 0, 0, 14 * eyePulseScale);

    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 1;
    const pupilR =
      this.radialPhase === "telegraph"
        ? 6 + 6 * Math.min(1, this.radialTimer / RADIAL_TELEGRAPH_SEC)
        : 6;
    circle(ctx, 0, 0, pupilR);

    if (this.hitFlashTime > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = Math.min(1, this.hitFlashTime * 5);
      circle(ctx, 0, 0, SENTINEL_HITBOX_RADIUS);
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
    // Contact damage is suppressed during cinematic phases.
    if (this.state === "intro" || this.state === "dying") return false;
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
    if (!this.overlapsPlayer(px, py, half)) return false;
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
