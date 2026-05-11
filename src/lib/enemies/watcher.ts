import { audio } from "../audio";
import {
  ENEMY_WATCHER_DETECTION,
  WATCHER_ACCEL_LERP,
  WATCHER_BRAKE_RECOVERY_MS,
  WATCHER_BRAKE_SQUASH_DURATION_MS,
  WATCHER_BRAKE_SQUASH_X,
  WATCHER_BRAKE_STRETCH_Y,
  WATCHER_DECEL_FACTOR,
  WATCHER_IDLE_DRIFT_AMPLITUDE_X,
  WATCHER_IDLE_DRIFT_AMPLITUDE_Y,
  WATCHER_IDLE_DRIFT_LERP,
  WATCHER_IDLE_DRIFT_SPEED,
  WATCHER_IDLE_PUPIL_INTERVAL_MAX_MS,
  WATCHER_IDLE_PUPIL_INTERVAL_MIN_MS,
  WATCHER_IDLE_PUPIL_LERP,
  WATCHER_SPEED_FACTOR,
} from "../config";
import { drawNeon } from "../neon";
import { resolveEntityWallCollisions } from "../walls";
import { applyAwarenessJitter, initAwareness } from "./awareness";
import { applyEnemyKnockback, drawEnemyHitFlash } from "./fx";
import type {
  AwarenessState,
  Enemy,
  EnemyContext,
  EnemyType,
  Laser,
} from "./types";

// Layered eye visual. Outer ring is stroke-only so the dark gap
// between ring and iris reads as a real hole through the orb. Three
// solid concentric iris discs fake a gradient (bright red → deep
// burgundy) without needing canvas radial gradients. All iris layers
// must stay fully opaque — only the upper gloss highlight is
// translucent.
// Iris stack fills almost the whole interior of the outer ring (~3.5px
// dark gap), then steps inward in even 5px rings so the gradient reads
// as depth rather than a target. Pupil is large and visibly black on
// top of the burgundy core, with a tiny white catchlight.
const WATCHER_RADIUS = 30;        // outer ring radius
const OUTER_RING_W = 2.5;
const IRIS_OUTER_R = 24;
const IRIS_MID_R = 19;
const IRIS_INNER_R = 14;
const IRIS_OUTER_COLOR = "#ff1744";
const IRIS_MID_COLOR = "#c8002a";
const IRIS_INNER_COLOR = "#6b0014";
const PUPIL_RADIUS = 9;
const PUPIL_HIGHLIGHT_R = 2.5;
const PUPIL_HIGHLIGHT_OFFSET = 2;
const GLOSS_OFFSET_Y = -16;
const GLOSS_W = 12;
const GLOSS_H = 5;
const GLOSS_ALPHA = 0.2;
const PUPIL_LERP_RATE = 10;
const WATCHER_HP_MAX = 3;

const PHASE_IDLE_SEC = 1.5;
const PHASE_AIMING_SEC = 1.2;
const PHASE_FIRING_SEC = 0.25;
const PHASE_COOLDOWN_SEC = 0.8;

type WatcherPhase = "idle" | "aiming" | "firing" | "cooldown";

// Module-level laser id counter. Each spawned beam gets a unique id
// so per-laser dedup (player dodge bonus + friendly-fire damage)
// doesn't cross between firings.
let nextLaserId = 1;

const MAX_PUPIL_OFFSET = (IRIS_OUTER_R - PUPIL_RADIUS) * 0.7;
const VELOCITY_SNAP_THRESHOLD = 5; // px/s; below this we kill drift to 0
const BRAKE_SQUASH_SEC = WATCHER_BRAKE_SQUASH_DURATION_MS / 1000;
const BRAKE_RECOVERY_SEC = WATCHER_BRAKE_RECOVERY_MS / 1000;
const BRAKE_TOTAL_SEC = BRAKE_SQUASH_SEC + BRAKE_RECOVERY_SEC;

export class Watcher implements Enemy {
  readonly type: EnemyType = "watcher";
  readonly color = "#ff1744";
  x: number;
  y: number;
  hp: number;
  hitFlashTime = 0;
  knockbackTime = 0;
  knockbackDuration = 0;
  knockbackPeakX = 0;
  knockbackPeakY = 0;
  dropsKey = false;
  hitboxRadius = 30;
  hitByLaserId = 0;
  awarenessState: AwarenessState = "idle";
  detectionRadius = ENEMY_WATCHER_DETECTION;
  alertTimer = 0;
  canDeaggro = true;
  deAggroCooldownTimer = 0;
  // Idle posture — Watcher drifts in a slow figure-eight around its
  // home position while sleeping, and the pupil wanders idle-look
  // style instead of tracking the player.
  private prevAwarenessState: AwarenessState = "idle";
  private idleHomeX: number;
  private idleHomeY: number;
  private idleDriftPhase = 0;
  private idlePupilTimer: number;
  private idlePupilTargetX = 0;
  private idlePupilTargetY = 0;
  private destroyed = false;
  vx = 0;
  vy = 0;
  private pupilOffsetX = 0;
  private pupilOffsetY = 0;
  private pupilLockX = 0;
  private pupilLockY = 0;
  private phase: WatcherPhase = "idle";
  private phaseTimer = PHASE_IDLE_SEC;
  private dashIdAlreadyDamaged = -1;
  // Brake squash state — set on idle→aiming transition. brakeAge < 0
  // means inactive; otherwise it counts up in seconds and drives the
  // squash/stretch transform applied in draw().
  private brakeAge = -1;
  private brakeDirX = 1;
  private brakeDirY = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = WATCHER_HP_MAX;
    this.idleHomeX = x;
    this.idleHomeY = y;
    this.idlePupilTimer = randomIdlePupilInterval();
    initAwareness(this, ENEMY_WATCHER_DETECTION);
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
    // de-aggro returns the Watcher to wherever it was alerted, not
    // its original spawn point.
    if (
      this.prevAwarenessState === "idle" &&
      this.awarenessState !== "idle"
    ) {
      this.idleHomeX = this.x;
      this.idleHomeY = this.y;
      this.idleDriftPhase = 0;
    }
    // Symmetric re-anchor on aggro → idle (de-aggro): start the next
    // drift cycle from wherever the Watcher actually ended up rather
    // than snapping back to a stale alert-time home.
    if (
      this.prevAwarenessState === "aggro" &&
      this.awarenessState === "idle"
    ) {
      this.idleHomeX = this.x;
      this.idleHomeY = this.y;
      this.idleDriftPhase = 0;
    }
    this.prevAwarenessState = this.awarenessState;

    if (this.awarenessState !== "aggro") {
      this.vx = 0;
      this.vy = 0;
      if (this.awarenessState === "idle") {
        // Slow figure-eight drift. Y phase is multiplied by 0.7 so the
        // axes go out of sync over the cycle.
        this.idleDriftPhase += dt * 1000 * WATCHER_IDLE_DRIFT_SPEED;
        const driftX =
          Math.sin(this.idleDriftPhase) * WATCHER_IDLE_DRIFT_AMPLITUDE_X;
        const driftY =
          Math.sin(this.idleDriftPhase * 0.7) *
          WATCHER_IDLE_DRIFT_AMPLITUDE_Y;
        const targetX = this.idleHomeX + driftX;
        const targetY = this.idleHomeY + driftY;
        const k = 1 - Math.pow(1 - WATCHER_IDLE_DRIFT_LERP, dt * 60);
        this.x += (targetX - this.x) * k;
        this.y += (targetY - this.y) * k;
        resolveEntityWallCollisions(this, ctxRoom.walls, WATCHER_RADIUS);

        // Idle-look pupil — pick a new target every ~1.5 s; lerp
        // pupil offset toward it with WATCHER_IDLE_PUPIL_LERP.
        this.idlePupilTimer -= dt;
        if (this.idlePupilTimer <= 0) {
          const target = pickIdlePupilTarget(MAX_PUPIL_OFFSET);
          this.idlePupilTargetX = target.x;
          this.idlePupilTargetY = target.y;
          this.idlePupilTimer = randomIdlePupilInterval();
        }
        const kp = 1 - Math.pow(1 - WATCHER_IDLE_PUPIL_LERP, dt * 60);
        this.pupilOffsetX +=
          (this.idlePupilTargetX - this.pupilOffsetX) * kp;
        this.pupilOffsetY +=
          (this.idlePupilTargetY - this.pupilOffsetY) * kp;
      } else {
        // alerting — frozen body, but the pupil snaps onto the player
        // so the "I see you" read lines up with the "!" telegraph.
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const inv = 1 / Math.max(Math.hypot(dx, dy), 1e-6);
        const tx = dx * inv * MAX_PUPIL_OFFSET;
        const ty = dy * inv * MAX_PUPIL_OFFSET;
        const kp = 1 - Math.exp(-PUPIL_LERP_RATE * dt);
        this.pupilOffsetX += (tx - this.pupilOffsetX) * kp;
        this.pupilOffsetY += (ty - this.pupilOffsetY) * kp;
      }
      return;
    }

    // Movement model per phase:
    //   idle     — direct-set velocity toward player (full chase).
    //   aiming   — coast: each frame velocity *= DECEL_FACTOR (raised
    //              to dt*60 for frame-rate independence). Hard zero
    //              once below the snap threshold so float drift can't
    //              jiggle a "stopped" enemy.
    //   firing   — fully stopped.
    //   cooldown — accelerate back toward chase target via a lerp so
    //              by the time idle begins the velocity already matches
    //              the chase speed (no teleport-into-motion).
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    const chaseSpeed = ctxRoom.playerMaxSpeed * WATCHER_SPEED_FACTOR;
    let targetVx = 0;
    let targetVy = 0;
    if (dist > 1e-3) {
      const inv = 1 / dist;
      targetVx = dx * inv * chaseSpeed;
      targetVy = dy * inv * chaseSpeed;
    }

    switch (this.phase) {
      case "idle":
        this.vx = targetVx;
        this.vy = targetVy;
        break;
      case "aiming": {
        const decelStep = Math.pow(WATCHER_DECEL_FACTOR, dt * 60);
        this.vx *= decelStep;
        this.vy *= decelStep;
        if (
          this.vx * this.vx + this.vy * this.vy <
          VELOCITY_SNAP_THRESHOLD * VELOCITY_SNAP_THRESHOLD
        ) {
          this.vx = 0;
          this.vy = 0;
        }
        break;
      }
      case "firing":
        this.vx = 0;
        this.vy = 0;
        break;
      case "cooldown": {
        const k = 1 - Math.pow(1 - WATCHER_ACCEL_LERP, dt * 60);
        this.vx += (targetVx - this.vx) * k;
        this.vy += (targetVy - this.vy) * k;
        break;
      }
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Wall collisions — slide along the wall instead of clipping
    // through. Half-size matches the orb's outer ring radius.
    resolveEntityWallCollisions(this, ctxRoom.walls, WATCHER_RADIUS);

    // Tick brake squash timer
    if (this.brakeAge >= 0) {
      this.brakeAge += dt;
      if (this.brakeAge >= BRAKE_TOTAL_SEC) this.brakeAge = -1;
    }

    // Pupil tracking — locked during aiming/firing (the "captured target"),
    // smooth lerp during idle / cooldown.
    if (this.phase === "aiming" || this.phase === "firing") {
      this.pupilOffsetX = this.pupilLockX;
      this.pupilOffsetY = this.pupilLockY;
    } else {
      const inv = 1 / Math.max(dist, 1e-6);
      const tx = dx * inv * MAX_PUPIL_OFFSET;
      const ty = dy * inv * MAX_PUPIL_OFFSET;
      const k = 1 - Math.exp(-PUPIL_LERP_RATE * dt);
      this.pupilOffsetX += (tx - this.pupilOffsetX) * k;
      this.pupilOffsetY += (ty - this.pupilOffsetY) * k;
    }

    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) this.advancePhase(ctxRoom);
  }

  private advancePhase(ctxRoom: EnemyContext): void {
    switch (this.phase) {
      case "idle": {
        // Capture aim direction — the laser fires along this fixed
        // angle. endX/endY are filled in by the room sim each frame
        // via wall raycast, so the beam pierces the room.
        const px = ctxRoom.player.x;
        const py = ctxRoom.player.y;
        const dx = px - this.x;
        const dy = py - this.y;
        const inv = 1 / Math.max(Math.hypot(dx, dy), 1e-6);
        this.pupilLockX = dx * inv * MAX_PUPIL_OFFSET;
        this.pupilLockY = dy * inv * MAX_PUPIL_OFFSET;

        // Trigger brake squash. Direction is current motion (or fall
        // back to chase target if velocity is already zero) so the
        // squash axis aligns with the way the Watcher is "skidding".
        const speed = Math.hypot(this.vx, this.vy);
        if (speed > 1e-3) {
          this.brakeDirX = this.vx / speed;
          this.brakeDirY = this.vy / speed;
        } else {
          this.brakeDirX = dx * inv;
          this.brakeDirY = dy * inv;
        }
        this.brakeAge = 0;
        const laser: Laser = {
          id: nextLaserId++,
          ownerType: "watcher",
          ownerEnemy: this,
          aimAngle: Math.atan2(dy, dx),
          endX: px,
          endY: py,
          age: 0,
          chargingDuration: PHASE_AIMING_SEC,
          firingDuration: PHASE_FIRING_SEC,
        };
        ctxRoom.lasers.push(laser);
        this.phase = "aiming";
        this.phaseTimer += PHASE_AIMING_SEC;
        // Rising drone over the whole aiming window — pitch + filter
        // climb in lockstep, ends just as the beam commits.
        audio.play.watcherCharge();
        break;
      }
      case "aiming":
        // Visual transition (charging → firing) happens inside the laser
        // based on age; the audio cue fires here, at the moment of beam
        // commitment. Sharp downsweep "vweep" — cuts through the
        // charge tail.
        audio.play.watcherFire();
        this.phase = "firing";
        this.phaseTimer += PHASE_FIRING_SEC;
        break;
      case "firing":
        this.phase = "cooldown";
        this.phaseTimer += PHASE_COOLDOWN_SEC;
        break;
      case "cooldown":
        this.phase = "idle";
        this.phaseTimer += PHASE_IDLE_SEC;
        break;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.destroyed) {
      drawEnemyHitFlash(ctx, this, () => {
        ctx.beginPath();
        ctx.arc(this.x, this.y, WATCHER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    ctx.save();
    applyAwarenessJitter(ctx, this);
    applyEnemyKnockback(ctx, this);

    // Brake squash transform — held at full squash for the squash phase,
    // then linearly recovers toward 1.0 over the recovery phase. Axis
    // aligns with motion direction so the orb compresses along travel.
    const squashing = this.brakeAge >= 0;
    if (squashing) {
      let scaleAlong: number;
      let scalePerp: number;
      if (this.brakeAge < BRAKE_SQUASH_SEC) {
        scaleAlong = WATCHER_BRAKE_SQUASH_X;
        scalePerp = WATCHER_BRAKE_STRETCH_Y;
      } else {
        const t = (this.brakeAge - BRAKE_SQUASH_SEC) / BRAKE_RECOVERY_SEC;
        scaleAlong = WATCHER_BRAKE_SQUASH_X + (1 - WATCHER_BRAKE_SQUASH_X) * t;
        scalePerp = WATCHER_BRAKE_STRETCH_Y + (1 - WATCHER_BRAKE_STRETCH_Y) * t;
      }
      const angle = Math.atan2(this.brakeDirY, this.brakeDirX);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.scale(scaleAlong, scalePerp);
      ctx.rotate(-angle);
      ctx.translate(-this.x, -this.y);
    }

    // 1. Outer ring — stroke only (no fill). The unfilled annulus between
    //    ring and iris exposes the room background as a dark gap, which
    //    is what reads as the orb's "shell".
    drawNeon(
      ctx,
      () => {
        ctx.beginPath();
        ctx.arc(this.x, this.y, WATCHER_RADIUS, 0, Math.PI * 2);
        ctx.lineWidth = OUTER_RING_W;
        ctx.strokeStyle = "#f8fafc";
        ctx.stroke();
      },
      "#f8fafc",
      8,
      3,
    );

    // 2-4. Iris stack — three opaque solid discs. The illusion of depth
    //      comes from the colors fading toward burgundy at the center,
    //      not from alpha blending. Do NOT lower opacity on these.
    ctx.fillStyle = IRIS_OUTER_COLOR;
    ctx.beginPath();
    ctx.arc(this.x, this.y, IRIS_OUTER_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = IRIS_MID_COLOR;
    ctx.beginPath();
    ctx.arc(this.x, this.y, IRIS_MID_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = IRIS_INNER_COLOR;
    ctx.beginPath();
    ctx.arc(this.x, this.y, IRIS_INNER_R, 0, Math.PI * 2);
    ctx.fill();

    // 5. Pupil — solid black, follows pupil tracking offset
    ctx.fillStyle = "#0a0e1a";
    ctx.beginPath();
    ctx.arc(
      this.x + this.pupilOffsetX,
      this.y + this.pupilOffsetY,
      PUPIL_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // 6. Tiny upper-left highlight on the pupil
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(
      this.x + this.pupilOffsetX - PUPIL_HIGHLIGHT_OFFSET,
      this.y + this.pupilOffsetY - PUPIL_HIGHLIGHT_OFFSET,
      PUPIL_HIGHLIGHT_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // 7. Glossy iris highlight — translucent ellipse near the top edge,
    //    static (does not follow the pupil) so it reads as a fixed
    //    reflection on the orb.
    ctx.save();
    ctx.globalAlpha = GLOSS_ALPHA;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(
      this.x,
      this.y + GLOSS_OFFSET_Y,
      GLOSS_W,
      GLOSS_H,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();

    if (squashing) ctx.restore();

    // HP pips above the watcher (drawn outside the squash transform so
    // the UI overhead doesn't deform with the body)
    const dotSpacing = 10;
    const dotsY = this.y - WATCHER_RADIUS - 12;
    const startX = this.x - (dotSpacing * (WATCHER_HP_MAX - 1)) / 2;
    for (let i = 0; i < WATCHER_HP_MAX; i++) {
      ctx.beginPath();
      ctx.fillStyle = i < this.hp ? "#f8fafc" : "rgba(248,250,252,0.22)";
      ctx.arc(startX + i * dotSpacing, dotsY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    drawEnemyHitFlash(ctx, this, () => {
      ctx.beginPath();
      ctx.arc(this.x, this.y, WATCHER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  overlapsPlayer(px: number, py: number, half: number): boolean {
    if (this.destroyed) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    const reach = WATCHER_RADIUS + half;
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
}

function randomIdlePupilInterval(): number {
  const minSec = WATCHER_IDLE_PUPIL_INTERVAL_MIN_MS / 1000;
  const maxSec = WATCHER_IDLE_PUPIL_INTERVAL_MAX_MS / 1000;
  return minSec + Math.random() * (maxSec - minSec);
}

// 15 % chance the pupil snaps to dead-center; otherwise pick a random
// angle and a tier-weighted distance (60 % near, 30 % mid, 10 % far)
// within `maxOffset`.
function pickIdlePupilTarget(maxOffset: number): { x: number; y: number } {
  if (Math.random() < 0.15) return { x: 0, y: 0 };
  const tier = Math.random();
  let centerR: number;
  if (tier < 0.6) centerR = 0.3;
  else if (tier < 0.9) centerR = 0.6;
  else centerR = 0.9;
  const angle = Math.random() * Math.PI * 2;
  const dist = centerR * maxOffset;
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
}
