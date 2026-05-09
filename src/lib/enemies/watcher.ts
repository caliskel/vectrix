import { audio } from "../audio";
import { drawNeon } from "../neon";
import { PALETTE } from "../palette";
import type { Enemy, EnemyContext, EnemyType, Laser } from "./types";

const WATCHER_RADIUS = 30;
const IRIS_RADIUS = 24;
const PUPIL_RADIUS = 9;
const HIGHLIGHT_RADIUS = 3;
const PUPIL_LERP_RATE = 10;
const WATCHER_HP_MAX = 2;
const WATCHER_SPEED = 220; // ≈ 0.5 × default player.maxSpeed (440)
const STOP_DISTANCE_PADDING = 20;

const PHASE_IDLE_SEC = 1.5;
const PHASE_AIMING_SEC = 1.2;
const PHASE_FIRING_SEC = 0.25;
const PHASE_COOLDOWN_SEC = 0.8;

type WatcherPhase = "idle" | "aiming" | "firing" | "cooldown";

const MAX_PUPIL_OFFSET = (IRIS_RADIUS - PUPIL_RADIUS) * 0.7;

export class Watcher implements Enemy {
  readonly type: EnemyType = "watcher";
  x: number;
  y: number;
  hp: number;
  private destroyed = false;
  private vx = 0;
  private vy = 0;
  private pupilOffsetX = 0;
  private pupilOffsetY = 0;
  private pupilLockX = 0;
  private pupilLockY = 0;
  private phase: WatcherPhase = "idle";
  private phaseTimer = PHASE_IDLE_SEC;
  private dashIdAlreadyDamaged = -1;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = WATCHER_HP_MAX;
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

    // Movement: chase the player. Stop when too close so the eye doesn't
    // shove the player around — pure positional pressure.
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    const stopDist =
      WATCHER_RADIUS + ctxRoom.playerHalfSize + STOP_DISTANCE_PADDING;
    if (dist > stopDist) {
      const inv = 1 / Math.max(dist, 1e-6);
      this.vx = dx * inv * WATCHER_SPEED;
      this.vy = dy * inv * WATCHER_SPEED;
    } else {
      this.vx = 0;
      this.vy = 0;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

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
        // Capture target — both pupil lock and laser endpoint freeze at
        // the player's current world position. Watcher may still drift
        // afterwards but the laser doesn't follow.
        const px = ctxRoom.player.x;
        const py = ctxRoom.player.y;
        const dx = px - this.x;
        const dy = py - this.y;
        const inv = 1 / Math.max(Math.hypot(dx, dy), 1e-6);
        this.pupilLockX = dx * inv * MAX_PUPIL_OFFSET;
        this.pupilLockY = dy * inv * MAX_PUPIL_OFFSET;
        const laser: Laser = {
          ownerType: "watcher",
          startX: this.x,
          startY: this.y,
          endX: px,
          endY: py,
          age: 0,
          chargingDuration: PHASE_AIMING_SEC,
          firingDuration: PHASE_FIRING_SEC,
        };
        ctxRoom.lasers.push(laser);
        this.phase = "aiming";
        this.phaseTimer += PHASE_AIMING_SEC;
        break;
      }
      case "aiming":
        // Visual transition (charging → firing) happens inside the laser
        // based on age; the audio cue fires here, at the moment of beam
        // commitment.
        audio.play.bulletBreak();
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
    if (this.destroyed) return;

    // outer ring — bright neon white for the threat read
    drawNeon(
      ctx,
      () => {
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, WATCHER_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
      },
      "#f8fafc",
      22,
      8,
    );

    // iris — translucent red disc
    ctx.save();
    ctx.fillStyle = PALETTE.bullet;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(this.x, this.y, IRIS_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // pupil
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

    // pupil highlight
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(
      this.x + this.pupilOffsetX - 2,
      this.y + this.pupilOffsetY - 2,
      HIGHLIGHT_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // HP pips
    const dotSpacing = 10;
    const dotsY = this.y - WATCHER_RADIUS - 12;
    const startX = this.x - (dotSpacing * (WATCHER_HP_MAX - 1)) / 2;
    for (let i = 0; i < WATCHER_HP_MAX; i++) {
      ctx.beginPath();
      ctx.fillStyle = i < this.hp ? "#f8fafc" : "rgba(248,250,252,0.22)";
      ctx.arc(startX + i * dotSpacing, dotsY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
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
