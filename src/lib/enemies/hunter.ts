import {
  ENEMY_HUNTER_DETECTION,
  HUNTER_IDLE_DART_ARRIVAL_DIST,
  HUNTER_IDLE_DART_DURATION_MAX_MS,
  HUNTER_IDLE_DART_DURATION_MIN_MS,
  HUNTER_IDLE_FAR_CHANCE,
  HUNTER_IDLE_FAR_DART_MAX,
  HUNTER_IDLE_FAR_DART_MIN,
  HUNTER_IDLE_GLOW_BLUR,
  HUNTER_IDLE_HOME_RETURN_THRESHOLD,
  HUNTER_IDLE_MAX_SPEED_FACTOR,
  HUNTER_IDLE_MICRO_DRIFT_AMPLITUDE,
  HUNTER_IDLE_MID_CHANCE,
  HUNTER_IDLE_MID_DART_MAX,
  HUNTER_IDLE_MID_DART_MIN,
  HUNTER_IDLE_NEAR_CHANCE,
  HUNTER_IDLE_NEAR_DART_MAX,
  HUNTER_IDLE_NEAR_DART_MIN,
  HUNTER_IDLE_PAUSE_DURATION_MAX_MS,
  HUNTER_IDLE_PAUSE_DURATION_MIN_MS,
  HUNTER_IDLE_PAUSE_VELOCITY_DAMPING,
  HUNTER_IDLE_SPEED_LINE_THRESHOLD,
  HUNTER_TRAIL_BUFFER_SIZE,
  HUNTER_TRAIL_GLOW_BLUR,
  HUNTER_TRAIL_INTERVAL_MS,
  HUNTER_TRAIL_MAX_ALPHA,
  HUNTER_TRAIL_MAX_SCALE,
  HUNTER_TRAIL_MIN_SCALE,
  HUNTER_TRAIL_MIN_VELOCITY,
} from "../config";
import { drawNeon } from "../neon";
import { resolveEntityWallCollisions } from "../walls";
import { applyAwarenessJitter, initAwareness } from "./awareness";
import { applyEnemyKnockback, drawEnemyHitFlash } from "./fx";
import type { AwarenessState, Enemy, EnemyContext, EnemyType } from "./types";

// Hunter — fast inertial chaser. Accelerates toward the player but
// can't turn instantly, so it skids and overshoots; the player can
// punish it by side-stepping. Contact deals 1 damage and bounces the
// Hunter (`vx,vy *= -0.5`); a dash-through one-shots it (HP=1).
const HUNTER_HP_MAX = 1;
const HUNTER_SPEED_FACTOR = 1.2;       // of player.maxSpeed
const HUNTER_ACCEL = 1500;             // px/s²
const HUNTER_HITBOX_RADIUS = 14;       // for overlap (circle approx of polygon)
const HUNTER_COLOR = "#fb923c";
const STRETCH_SPEED_THRESHOLD = 250;
const STRETCH_ALONG = 1.15;
const STRETCH_PERP = 0.9;
const SPEED_LINE_THRESHOLD = 200;
const CONTACT_BOUNCE_FACTOR = -0.5;
const CONTACT_SQUASH_SEC = 0.1;
const CONTACT_SQUASH_AMOUNT = 0.25;    // perpendicular squeeze 1 → 0.75 → 1
const GLOW_BLUR_MIN = 12;
const GLOW_BLUR_MAX = 20;

// Body polygon (in local space, pointing along +X axis). Rendered both
// as outer stroke (neon) and translucent inner fill.
const POLY: Array<readonly [number, number]> = [
  [-22, -12],
  [22, 0],
  [-22, 12],
  [-10, 0],
];

// Two trail-line layouts so the speed lines look different at low/high
// speeds without per-frame Math.random flicker.
const SPEED_LINES_LOW: Array<readonly [number, number]> = [
  [-6, 14],
  [6, 14],
];
const SPEED_LINES_HIGH: Array<readonly [number, number]> = [
  [-9, 18],
  [-3, 12],
  [3, 16],
  [9, 10],
];

const HUNTER_TRAIL_INTERVAL_SEC = HUNTER_TRAIL_INTERVAL_MS / 1000;
// Samples are dropped by buffer cap during sustained motion; this age
// kicks in once the Hunter slows down so existing samples fade out
// over roughly the visible-trail length instead of lingering.
const HUNTER_TRAIL_MAX_AGE_SEC =
  (HUNTER_TRAIL_BUFFER_SIZE + 2) * HUNTER_TRAIL_INTERVAL_SEC;
// Inner translucent fill alpha relative to the outer stroke alpha,
// matching the body's 0.4 fill / 1.0 stroke ratio.
const HUNTER_TRAIL_FILL_RATIO = 0.4;
const HUNTER_TRAIL_STROKE_WIDTH = 2;

type TrailSample = {
  x: number;
  y: number;
  /** Direction the Hunter was facing when this sample was recorded.
   *  Stored so the trail ghosts curve through a turn instead of all
   *  pointing the way the Hunter is going right now. */
  angle: number;
  age: number;
};

type IdlePhase = "darting" | "pausing";

const HUNTER_IDLE_PAUSE_VELOCITY_SQ_THRESHOLD = 20 * 20;

export class Hunter implements Enemy {
  readonly type: EnemyType = "hunter";
  readonly color = HUNTER_COLOR;
  x: number;
  y: number;
  hp: number;
  hitFlashTime = 0;
  knockbackTime = 0;
  knockbackDuration = 0;
  knockbackPeakX = 0;
  knockbackPeakY = 0;
  dropsKey = false;
  hitboxRadius = 14;
  hitByLaserId = 0;
  awarenessState: AwarenessState = "idle";
  detectionRadius = ENEMY_HUNTER_DETECTION;
  alertTimer = 0;
  // Idle behavior — playful darts around a home position. Latched on
  // first construction; on idle → alerting transition we re-anchor to
  // the current spot so a future de-aggro returns home to the alerted
  // location, not the spawn.
  private idleHomeX: number;
  private idleHomeY: number;
  private idleTargetX: number;
  private idleTargetY: number;
  private idlePhase: IdlePhase = "darting";
  private idleTimer: number;
  private idleMicroPhase = 0;
  private pauseAnchorX = 0;
  private pauseAnchorY = 0;
  private prevAwarenessState: AwarenessState = "idle";
  private destroyed = false;
  vx = 0;
  vy = 0;
  private dashIdAlreadyDamaged = -1;
  private contactSquashTime = 0;
  // Cached so draw() can scale glow / speed lines without an EnemyContext
  private maxSpeed = 528; // 1.2 * 440 default; refreshed in update()
  private trailSamples: TrailSample[] = [];
  private trailTimer = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = HUNTER_HP_MAX;
    this.idleHomeX = x;
    this.idleHomeY = y;
    this.idleTargetX = x;
    this.idleTargetY = y;
    this.idleTimer = randomDartDuration();
    initAwareness(this, ENEMY_HUNTER_DETECTION);
  }

  isDead(): boolean {
    return this.destroyed;
  }

  takeDamage(amount: number): void {
    if (this.destroyed) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroyed = true;
    }
  }

  update(ctxRoom: EnemyContext): void {
    if (this.destroyed) return;
    const { dt, player } = ctxRoom;

    // Latch idle home on idle → non-idle transition so a future
    // de-aggro returns the Hunter to wherever it was alerted, not
    // its original spawn.
    if (
      this.prevAwarenessState === "idle" &&
      this.awarenessState !== "idle"
    ) {
      this.idleHomeX = this.x;
      this.idleHomeY = this.y;
    }
    this.prevAwarenessState = this.awarenessState;

    if (this.awarenessState === "alerting") {
      // Telegraph window — Hunter holds position with a quick velocity
      // decay so it gives the player a clear "I see you" beat before
      // the pounce.
      this.vx *= 0.85;
      this.vy *= 0.85;
      return;
    }
    if (this.awarenessState === "idle") {
      this.tickIdle(ctxRoom);
      return;
    }

    this.maxSpeed = ctxRoom.playerMaxSpeed * HUNTER_SPEED_FACTOR;

    // Steer: accelerate toward the player. Inertia keeps the Hunter
    // overshooting on hard turns — the gameplay shape that reads.
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-3) {
      const inv = 1 / dist;
      this.vx += dx * inv * HUNTER_ACCEL * dt;
      this.vy += dy * inv * HUNTER_ACCEL * dt;
    }
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > this.maxSpeed) {
      const k = this.maxSpeed / speed;
      this.vx *= k;
      this.vy *= k;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Slide along walls instead of clipping through.
    resolveEntityWallCollisions(this, ctxRoom.walls, HUNTER_HITBOX_RADIUS);
    if (this.contactSquashTime > 0) {
      this.contactSquashTime = Math.max(0, this.contactSquashTime - dt);
    }

    // Trail buffer — age existing samples, drop expired ones, and
    // emit a new one every HUNTER_TRAIL_INTERVAL while moving fast
    // enough. When stopped, emission halts but ages keep advancing
    // so the existing trail fades naturally.
    for (const sample of this.trailSamples) sample.age += dt;
    if (this.trailSamples.length > 0) {
      this.trailSamples = this.trailSamples.filter(
        (s) => s.age < HUNTER_TRAIL_MAX_AGE_SEC,
      );
    }
    const speedNow = Math.hypot(this.vx, this.vy);
    if (speedNow > HUNTER_TRAIL_MIN_VELOCITY) {
      this.trailTimer += dt;
      if (this.trailTimer >= HUNTER_TRAIL_INTERVAL_SEC) {
        this.trailTimer = 0;
        this.trailSamples.push({
          x: this.x,
          y: this.y,
          angle: Math.atan2(this.vy, this.vx),
          age: 0,
        });
        if (this.trailSamples.length > HUNTER_TRAIL_BUFFER_SIZE) {
          this.trailSamples.shift();
        }
      }
    } else {
      this.trailTimer = 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.destroyed) {
      drawEnemyHitFlash(ctx, this, () => {
        ctx.save();
        ctx.translate(this.x, this.y);
        polyPath(ctx);
        ctx.restore();
      });
      return;
    }
    // Trail draws under the body. Suppressed during the contact
    // window so the bounce squash isn't competing with motion ghosts,
    // and during idle so the calm darting reads visually distinct
    // from the engaged chase.
    const isAggro = this.awarenessState === "aggro";
    if (isAggro && this.contactSquashTime <= 0) this.drawTrail(ctx);
    const speed = Math.hypot(this.vx, this.vy);
    const angle = speed > 0.01 ? Math.atan2(this.vy, this.vx) : 0;
    const speedNorm =
      this.maxSpeed > 0 ? Math.min(1, speed / this.maxSpeed) : 0;
    const glowBlur = isAggro
      ? GLOW_BLUR_MIN + (GLOW_BLUR_MAX - GLOW_BLUR_MIN) * speedNorm
      : HUNTER_IDLE_GLOW_BLUR;

    ctx.save();
    applyAwarenessJitter(ctx, this);
    applyEnemyKnockback(ctx, this);
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);

    // Stretch into a bullet shape when fast (along motion, squash perp)
    if (speed > STRETCH_SPEED_THRESHOLD) {
      ctx.scale(STRETCH_ALONG, STRETCH_PERP);
    }
    // Short perpendicular squeeze on contact
    if (this.contactSquashTime > 0) {
      const t = this.contactSquashTime / CONTACT_SQUASH_SEC;
      ctx.scale(1, 1 - CONTACT_SQUASH_AMOUNT * t);
    }

    // Speed lines — drawn first so the body overlays them. Anchored
    // behind the polygon (negative X in local space). Hidden when
    // the body is barely moving (e.g., idle pausing) so a stationary
    // Hunter doesn't sport visible streaks.
    if (speed > HUNTER_IDLE_SPEED_LINE_THRESHOLD) {
      const lines =
        speed > SPEED_LINE_THRESHOLD ? SPEED_LINES_HIGH : SPEED_LINES_LOW;
      ctx.save();
      ctx.strokeStyle = HUNTER_COLOR;
      ctx.lineWidth = 2;
      ctx.shadowColor = HUNTER_COLOR;
      ctx.shadowBlur = 6;
      ctx.globalAlpha = 0.55;
      for (const [yOff, len] of lines) {
        ctx.beginPath();
        ctx.moveTo(-22, yOff);
        ctx.lineTo(-22 - len, yOff);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Inner translucent fill
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = HUNTER_COLOR;
    polyPath(ctx);
    ctx.fill();
    ctx.restore();

    // Outer neon stroke — glow scales with speed
    drawNeon(
      ctx,
      () => {
        polyPath(ctx);
        ctx.strokeStyle = HUNTER_COLOR;
        ctx.lineWidth = 2;
        ctx.stroke();
      },
      HUNTER_COLOR,
      glowBlur,
      4,
    );

    drawEnemyHitFlash(ctx, this, () => polyPath(ctx));
    ctx.restore();
  }

  overlapsPlayer(px: number, py: number, half: number): boolean {
    if (this.destroyed) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    const reach = HUNTER_HITBOX_RADIUS + half;
    return dx * dx + dy * dy < reach * reach;
  }

  tryDashDamage(
    dashId: number,
    px: number,
    py: number,
    half: number,
  ): boolean {
    if (this.destroyed) return false;
    if (this.dashIdAlreadyDamaged === dashId) return false;
    if (!this.overlapsPlayer(px, py, half)) return false;
    this.dashIdAlreadyDamaged = dashId;
    this.takeDamage(1);
    return true;
  }

  /**
   * Idle dart-and-pause cycle. Hunter accelerates toward an
   * `idleTarget` for a randomized window, then damps to a stop and
   * sits with a tiny micro-drift before picking a new target. Uses
   * the same inertia model as combat but at HUNTER_IDLE_MAX_SPEED_FACTOR
   * (35 %) of full speed and emits no trail.
   */
  private tickIdle(ctxRoom: EnemyContext): void {
    const { dt } = ctxRoom;
    this.idleTimer -= dt;
    const idleMaxSpeed =
      ctxRoom.playerMaxSpeed * HUNTER_SPEED_FACTOR * HUNTER_IDLE_MAX_SPEED_FACTOR;

    if (this.idlePhase === "darting") {
      const dx = this.idleTargetX - this.x;
      const dy = this.idleTargetY - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-3) {
        const inv = 1 / dist;
        this.vx += dx * inv * HUNTER_ACCEL * dt;
        this.vy += dy * inv * HUNTER_ACCEL * dt;
      }
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > idleMaxSpeed) {
        const k = idleMaxSpeed / sp;
        this.vx *= k;
        this.vy *= k;
      }
      if (dist < HUNTER_IDLE_DART_ARRIVAL_DIST || this.idleTimer <= 0) {
        this.idlePhase = "pausing";
        this.idleTimer = randomPauseDuration();
        this.pauseAnchorX = this.x;
        this.pauseAnchorY = this.y;
      }
    } else {
      // pausing — damp + micro-drift around the anchor
      const damping = Math.pow(
        HUNTER_IDLE_PAUSE_VELOCITY_DAMPING,
        dt * 60,
      );
      this.vx *= damping;
      this.vy *= damping;
      this.idleMicroPhase += dt;
      if (
        this.vx * this.vx + this.vy * this.vy <
        HUNTER_IDLE_PAUSE_VELOCITY_SQ_THRESHOLD
      ) {
        // re-anchor lerp toward an oscillating target so the body
        // looks like it's hovering, not frozen
        const mx =
          Math.sin(this.idleMicroPhase * 1.3) *
          HUNTER_IDLE_MICRO_DRIFT_AMPLITUDE;
        const my =
          Math.cos(this.idleMicroPhase * 1.7) *
          HUNTER_IDLE_MICRO_DRIFT_AMPLITUDE;
        const target = { x: this.pauseAnchorX + mx, y: this.pauseAnchorY + my };
        const k = 1 - Math.exp(-3 * dt);
        this.x += (target.x - this.x) * k;
        this.y += (target.y - this.y) * k;
        this.vx = 0;
        this.vy = 0;
      }
      if (this.idleTimer <= 0) {
        this.idlePhase = "darting";
        this.idleTimer = randomDartDuration();
        // If the Hunter has wandered far from home, return there
        // instead of picking a random target — keeps it from
        // drifting across the room.
        const hdx = this.x - this.idleHomeX;
        const hdy = this.y - this.idleHomeY;
        if (
          hdx * hdx + hdy * hdy >
          HUNTER_IDLE_HOME_RETURN_THRESHOLD * HUNTER_IDLE_HOME_RETURN_THRESHOLD
        ) {
          this.idleTargetX = this.idleHomeX;
          this.idleTargetY = this.idleHomeY;
        } else {
          this.pickIdleTarget(ctxRoom.walls);
        }
      }
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    resolveEntityWallCollisions(this, ctxRoom.walls, HUNTER_HITBOX_RADIUS);
  }

  /**
   * Pick a tier-weighted random angle/distance from idleHome. Up to
   * four attempts to land on a target that doesn't bury the Hunter
   * in a wall AABB; on failure, fall back to home.
   */
  private pickIdleTarget(walls: import("../walls").Wall[]): void {
    for (let attempt = 0; attempt < 4; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const tier = Math.random();
      let dMin: number;
      let dMax: number;
      if (tier < HUNTER_IDLE_NEAR_CHANCE) {
        dMin = HUNTER_IDLE_NEAR_DART_MIN;
        dMax = HUNTER_IDLE_NEAR_DART_MAX;
      } else if (tier < HUNTER_IDLE_NEAR_CHANCE + HUNTER_IDLE_MID_CHANCE) {
        dMin = HUNTER_IDLE_MID_DART_MIN;
        dMax = HUNTER_IDLE_MID_DART_MAX;
      } else {
        dMin = HUNTER_IDLE_FAR_DART_MIN;
        dMax = HUNTER_IDLE_FAR_DART_MAX;
      }
      // small assertion for the tier compile-time check
      void HUNTER_IDLE_FAR_CHANCE;
      const dist = dMin + Math.random() * (dMax - dMin);
      const tx = this.idleHomeX + Math.cos(angle) * dist;
      const ty = this.idleHomeY + Math.sin(angle) * dist;
      if (!pointTouchesWall(tx, ty, walls, HUNTER_HITBOX_RADIUS)) {
        this.idleTargetX = tx;
        this.idleTargetY = ty;
        return;
      }
    }
    this.idleTargetX = this.idleHomeX;
    this.idleTargetY = this.idleHomeY;
  }

  onContactDamage(): void {
    if (this.destroyed) return;
    this.vx *= CONTACT_BOUNCE_FACTOR;
    this.vy *= CONTACT_BOUNCE_FACTOR;
    this.contactSquashTime = CONTACT_SQUASH_SEC;
  }

  private drawTrail(ctx: CanvasRenderingContext2D): void {
    const len = this.trailSamples.length;
    if (len === 0) return;
    // Iterate old → new so freshly-emitted ghosts overlay older ones,
    // matching the alpha ramp of i / len (0 = old / faint, 1 = fresh).
    for (let i = 0; i < len; i++) {
      const s = this.trailSamples[i];
      const t = i / len;
      const alpha = t * HUNTER_TRAIL_MAX_ALPHA;
      const scale =
        HUNTER_TRAIL_MIN_SCALE +
        t * (HUNTER_TRAIL_MAX_SCALE - HUNTER_TRAIL_MIN_SCALE);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.scale(scale, scale);
      ctx.shadowColor = HUNTER_COLOR;
      ctx.shadowBlur = HUNTER_TRAIL_GLOW_BLUR * scale;
      // Inner translucent fill at the same fill / stroke ratio as the
      // live body. Stroke at full alpha for the ghost.
      ctx.fillStyle = HUNTER_COLOR;
      ctx.globalAlpha = alpha * HUNTER_TRAIL_FILL_RATIO;
      polyPath(ctx);
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = HUNTER_COLOR;
      ctx.lineWidth = HUNTER_TRAIL_STROKE_WIDTH;
      polyPath(ctx);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function polyPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(POLY[0][0], POLY[0][1]);
  for (let i = 1; i < POLY.length; i++) {
    ctx.lineTo(POLY[i][0], POLY[i][1]);
  }
  ctx.closePath();
}

function randomDartDuration(): number {
  const min = HUNTER_IDLE_DART_DURATION_MIN_MS / 1000;
  const max = HUNTER_IDLE_DART_DURATION_MAX_MS / 1000;
  return min + Math.random() * (max - min);
}

function randomPauseDuration(): number {
  const min = HUNTER_IDLE_PAUSE_DURATION_MIN_MS / 1000;
  const max = HUNTER_IDLE_PAUSE_DURATION_MAX_MS / 1000;
  return min + Math.random() * (max - min);
}

function pointTouchesWall(
  x: number,
  y: number,
  walls: import("../walls").Wall[],
  r: number,
): boolean {
  for (const w of walls) {
    if (
      x + r > w.x &&
      x - r < w.x + w.w &&
      y + r > w.y &&
      y - r < w.y + w.h
    ) {
      return true;
    }
  }
  return false;
}
