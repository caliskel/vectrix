import {
  ENEMY_HUNTER_DETECTION,
  HUNTER_IDLE_ANGLE_LERP,
  HUNTER_IDLE_LERP_FACTOR,
  HUNTER_IDLE_PATH_SIZE_MAX,
  HUNTER_IDLE_PATH_SIZE_MIN,
  HUNTER_IDLE_PATH_SPEED,
  HUNTER_IDLE_TRAIL_GLOW_BLUR,
  HUNTER_IDLE_TRAIL_INTERVAL_MS,
  HUNTER_IDLE_TRAIL_MAX_ALPHA,
  HUNTER_TRAIL_BUFFER_SIZE,
  HUNTER_TRAIL_GLOW_BLUR,
  HUNTER_TRAIL_INTERVAL_MS,
  HUNTER_TRAIL_MAX_ALPHA,
  HUNTER_TRAIL_MAX_SCALE,
  HUNTER_TRAIL_MIN_SCALE,
} from "../config";
// Hunter audio temporarily silenced — see comment above the snarl call.
// import { audio } from "../audio";
import { resolveEntityWallCollisions } from "../walls";
import { applyAwarenessJitter, initAwareness } from "./awareness";
import { applyEnemyKnockback, drawEnemyHitFlash } from "./fx";
import { getHunterSprite, HUNTER_SPRITE_ANCHOR } from "./hunter-sprite";
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

type TrailSample = {
  x: number;
  y: number;
  /** Direction the Hunter was facing when this sample was recorded.
   *  Stored so the trail ghosts curve through a turn instead of all
   *  pointing the way the Hunter is going right now. */
  angle: number;
  age: number;
  /** Visual params captured at emission time so an idle → aggro
   *  transition fades old softer ghosts while new brighter ones
   *  spawn behind the now-charging Hunter. */
  maxAlpha: number;
  glowBlur: number;
};

type IdlePathType = "figure8" | "oval" | "circle";
const IDLE_PATH_TYPES: IdlePathType[] = ["figure8", "oval", "circle"];
const HUNTER_IDLE_TRAIL_INTERVAL_SEC = HUNTER_IDLE_TRAIL_INTERVAL_MS / 1000;
// Minimum displacement (squared, to skip the sqrt) between trail
// samples — gates emission by actual position change instead of
// instantaneous velocity, which is unreliable on the slow parametric
// idle path.
const TRAIL_MIN_DISPLACEMENT_SQ = 5 * 5;

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
  // Hunter intentionally has canDeaggro unset — once it sees the
  // player it stays aggro for the rest of the run. The field below
  // is kept at 0 for interface compliance only.
  deAggroCooldownTimer = 0;
  // Set per-instance via the ctor `ignoresWalls` opt — Room 4
  // hunters phase through the section dividers, regular hunters
  // resolve normally.
  ignoresWalls = false;
  // Idle behavior — slow parametric trajectory around a home anchor.
  // Path type / size / rotation are randomized per Hunter so a roomful
  // of them swims in distinct curves. Latched on first construction;
  // on idle → alerting we re-anchor to the current spot so a future
  // de-aggro returns to the alerted location, not the spawn.
  private idleHomeX: number;
  private idleHomeY: number;
  private idlePathPhase = 0;
  private idlePathType: IdlePathType;
  private idlePathSize: number;
  private idleRotation: number;
  /** Smoothed body heading — driven from velocity in aggro and from
   *  the trajectory's tangent in idle. Used for body rotation and
   *  trail-sample angle so the chevron always points along motion. */
  private currentAngle = 0;
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
  /** Position of the last trail sample so we can gate emission by
   *  actual displacement instead of velocity magnitude — the slow
   *  parametric idle path moves at ~28 px/s, well below any sane
   *  velocity gate. -1 means "no sample yet, emit on next chance". */
  private lastTrailX = Number.NEGATIVE_INFINITY;
  private lastTrailY = Number.NEGATIVE_INFINITY;

  constructor(
    x: number,
    y: number,
    opts: { startsAggressive?: boolean; ignoresWalls?: boolean } = {},
  ) {
    this.x = x;
    this.y = y;
    this.hp = HUNTER_HP_MAX;
    this.idleHomeX = x;
    this.idleHomeY = y;
    this.idlePathPhase = Math.random() * Math.PI * 2;
    this.idlePathType =
      IDLE_PATH_TYPES[Math.floor(Math.random() * IDLE_PATH_TYPES.length)];
    this.idlePathSize =
      HUNTER_IDLE_PATH_SIZE_MIN +
      Math.random() * (HUNTER_IDLE_PATH_SIZE_MAX - HUNTER_IDLE_PATH_SIZE_MIN);
    this.idleRotation = Math.random() * Math.PI * 2;
    initAwareness(this, ENEMY_HUNTER_DETECTION);
    if (opts.startsAggressive) {
      // Skip the idle / alerting telegraph entirely — the Hunter
      // begins the encounter mid-pounce. prevAwarenessState is
      // pinned to "aggro" so the idle→non-idle latch in update()
      // doesn't reset idleHome on the first frame.
      this.awarenessState = "aggro";
      this.prevAwarenessState = "aggro";
    }
    if (opts.ignoresWalls) {
      this.ignoresWalls = true;
    }
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
    // Slide along walls instead of clipping through. Skipped entirely
    // when `ignoresWalls` is set so phase-through hunters (Room 4)
    // can cross section dividers freely.
    if (!this.ignoresWalls) {
      resolveEntityWallCollisions(this, ctxRoom.walls, HUNTER_HITBOX_RADIUS);
    }
    if (this.contactSquashTime > 0) {
      this.contactSquashTime = Math.max(0, this.contactSquashTime - dt);
    }

    // Aggro-tuned trail emission (sharper interval, brighter per-
    // sample params). Idle uses HUNTER_IDLE_* timing via
    // emitTrailSample called from tickIdle.
    this.emitTrailSample(
      dt,
      HUNTER_TRAIL_INTERVAL_SEC,
      HUNTER_TRAIL_MAX_ALPHA,
      HUNTER_TRAIL_GLOW_BLUR,
    );

    // Aggro angle for body — derive directly from velocity since the
    // chase model already gives a clean direction every frame.
    const speedNow = Math.hypot(this.vx, this.vy);
    if (speedNow > 0.01)
      this.currentAngle = Math.atan2(this.vy, this.vx);
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
    // Trail draws under the body. Visible in both idle and aggro,
    // with softer params in idle so the parametric trajectory reads
    // as a hypnotic motion ghost rather than a combat streak.
    // Suppressed only during the post-contact bounce window.
    const isAggro = this.awarenessState === "aggro";
    if (this.contactSquashTime <= 0) this.drawTrail(ctx);
    const speed = Math.hypot(this.vx, this.vy);

    ctx.save();
    applyAwarenessJitter(ctx, this);
    applyEnemyKnockback(ctx, this);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.currentAngle);

    // Stretch into a bullet shape when fast (along motion, squash perp)
    if (speed > STRETCH_SPEED_THRESHOLD) {
      ctx.scale(STRETCH_ALONG, STRETCH_PERP);
    }
    // Short perpendicular squeeze on contact
    if (this.contactSquashTime > 0) {
      const t = this.contactSquashTime / CONTACT_SQUASH_SEC;
      ctx.scale(1, 1 - CONTACT_SQUASH_AMOUNT * t);
    }

    // Speed lines — kept live (small, no glow needed for the read).
    // shadowBlur removed: at 6 px on 4-line strokes the cost wasn't
    // matched by visible glow once the sprite glow already paints.
    {
      const lines = isAggro
        ? speed > SPEED_LINE_THRESHOLD
          ? SPEED_LINES_HIGH
          : SPEED_LINES_LOW
        : SPEED_LINES_LOW;
      const alpha = isAggro ? 0.55 : 0.4;
      ctx.save();
      ctx.strokeStyle = HUNTER_COLOR;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha;
      for (const [yOff, len] of lines) {
        ctx.beginPath();
        ctx.moveTo(-22, yOff);
        ctx.lineTo(-22 - len, yOff);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Body — fill + neon stroke baked into one sprite. Replaces a
    // drawNeon (2 shadowBlur ops) + a translucent fill with one
    // drawImage. Per-speed glow ramp is gone — the sprite is baked
    // at the midpoint blur and the stretch transform already carries
    // the "going fast" read.
    const sprite = getHunterSprite();
    ctx.drawImage(sprite, -HUNTER_SPRITE_ANCHOR, -HUNTER_SPRITE_ANCHOR);

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
   * Slow parametric trajectory around `idleHome`. Phase advances in
   * radians per second; the (localX, localY) curve is rotated by the
   * per-instance `idleRotation` so the same path type can sit at
   * different angles in the room. The body lerps toward the curve
   * point with `HUNTER_IDLE_LERP_FACTOR` per frame, giving a slight
   * trailing drag that reads as natural inertia rather than locked
   * motion. Trail emission still runs (with idle-tuned interval).
   */
  private tickIdle(ctxRoom: EnemyContext): void {
    const { dt } = ctxRoom;
    this.idlePathPhase += dt * HUNTER_IDLE_PATH_SPEED;
    if (this.idlePathPhase > Math.PI * 2)
      this.idlePathPhase -= Math.PI * 2;

    let localX: number;
    let localY: number;
    const t = this.idlePathPhase;
    if (this.idlePathType === "figure8") {
      // Lissajous figure-8 (horizontal lemniscate of Gerono)
      localX = Math.sin(t) * this.idlePathSize;
      localY = Math.sin(t * 2) * this.idlePathSize * 0.5;
    } else if (this.idlePathType === "oval") {
      localX = Math.cos(t) * this.idlePathSize;
      localY = Math.sin(t) * this.idlePathSize * 0.55;
    } else {
      localX = Math.cos(t) * this.idlePathSize;
      localY = Math.sin(t) * this.idlePathSize;
    }

    const cosR = Math.cos(this.idleRotation);
    const sinR = Math.sin(this.idleRotation);
    const rotatedX = localX * cosR - localY * sinR;
    const rotatedY = localX * sinR + localY * cosR;
    const targetX = this.idleHomeX + rotatedX;
    const targetY = this.idleHomeY + rotatedY;

    // Lerp body toward the curve point — body trails the trajectory
    this.x += (targetX - this.x) * HUNTER_IDLE_LERP_FACTOR;
    this.y += (targetY - this.y) * HUNTER_IDLE_LERP_FACTOR;
    // Approximate velocity from remaining residual so trail samples
    // and angle calc see an instantaneous direction
    this.vx = (targetX - this.x) * 60;
    this.vy = (targetY - this.y) * 60;

    // Smoothed body heading along the trajectory tangent
    const desiredAngle = Math.atan2(targetY - this.y, targetX - this.x);
    let diff = desiredAngle - this.currentAngle;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    const ak = 1 - Math.pow(1 - HUNTER_IDLE_ANGLE_LERP, dt * 60);
    this.currentAngle += diff * ak;

    if (!this.ignoresWalls) {
      resolveEntityWallCollisions(this, ctxRoom.walls, HUNTER_HITBOX_RADIUS);
    }

    // Trail emission with idle-tuned interval / softer per-sample
    // params (sparser, dimmer, smaller glow than aggro).
    this.emitTrailSample(
      dt,
      HUNTER_IDLE_TRAIL_INTERVAL_SEC,
      HUNTER_IDLE_TRAIL_MAX_ALPHA,
      HUNTER_IDLE_TRAIL_GLOW_BLUR,
    );
  }

  /**
   * Emit a trail sample if the interval has elapsed AND the Hunter
   * has actually moved away from the last sample. The displacement
   * gate replaces the old velocity gate so the slow parametric idle
   * path (~28 px/s) still leaves a trail. Each sample carries its
   * own emission-time visual params (`maxAlpha`, `glowBlur`) so an
   * idle → aggro transition lets old soft ghosts fade while new
   * brighter ones spawn behind the charging body.
   */
  private emitTrailSample(
    dt: number,
    interval: number,
    maxAlpha: number,
    glowBlur: number,
  ): void {
    // In-place compaction — .filter() аллоцировал массив каждый кадр на
    // каждого хантера.
    {
      let w = 0;
      for (let i = 0; i < this.trailSamples.length; i++) {
        const sample = this.trailSamples[i];
        sample.age += dt;
        if (sample.age < HUNTER_TRAIL_MAX_AGE_SEC) {
          this.trailSamples[w++] = sample;
        }
      }
      this.trailSamples.length = w;
    }
    this.trailTimer += dt;
    if (this.trailTimer < interval) return;
    const dxLast = this.x - this.lastTrailX;
    const dyLast = this.y - this.lastTrailY;
    if (dxLast * dxLast + dyLast * dyLast < TRAIL_MIN_DISPLACEMENT_SQ) return;
    this.trailTimer = 0;
    this.trailSamples.push({
      x: this.x,
      y: this.y,
      angle: this.currentAngle,
      age: 0,
      maxAlpha,
      glowBlur,
    });
    this.lastTrailX = this.x;
    this.lastTrailY = this.y;
    if (this.trailSamples.length > HUNTER_TRAIL_BUFFER_SIZE) {
      this.trailSamples.shift();
    }
  }

  onContactDamage(): void {
    if (this.destroyed) return;
    this.vx *= CONTACT_BOUNCE_FACTOR;
    this.vy *= CONTACT_BOUNCE_FACTOR;
    this.contactSquashTime = CONTACT_SQUASH_SEC;
    // Snarl removed — Hunter is fully silent on approach + bounce.
    // The squash and bounce-back still carry the contact read.
    // audio.play.hunterSnarl();
  }

  private drawTrail(ctx: CanvasRenderingContext2D): void {
    const len = this.trailSamples.length;
    if (len === 0) return;
    // Iterate old → new so freshly-emitted ghosts overlay older ones,
    // matching the alpha ramp of i / len (0 = old / faint, 1 = fresh).
    // Each ghost is one drawImage of the cached hunter sprite —
    // replaces N × shadowBlur fills/strokes per frame (one per sample)
    // with N × drawImage. With trail length ≥ 6 and ≥1 hunter per
    // room, that's a dominant chunk of the rooms render budget gone.
    const sprite = getHunterSprite();
    for (let i = 0; i < len; i++) {
      const s = this.trailSamples[i];
      const t = i / len;
      const alpha = t * s.maxAlpha;
      const scale =
        HUNTER_TRAIL_MIN_SCALE +
        t * (HUNTER_TRAIL_MAX_SCALE - HUNTER_TRAIL_MIN_SCALE);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, -HUNTER_SPRITE_ANCHOR, -HUNTER_SPRITE_ANCHOR);
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

