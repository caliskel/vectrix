import { audio } from "../audio";
import { WATCHER_SPEED_FACTOR } from "../config";
import { drawNeon } from "../neon";
import type { Enemy, EnemyContext, EnemyType, Laser } from "./types";

const WATCHER_RADIUS = 30;        // outer ring radius
const OUTER_RING_W = 4;
const IRIS_OUTER_R = 21;          // ~5 px gap from outer ring
const IRIS_MID_R = 16;
const IRIS_INNER_R = 11;
const PUPIL_RADIUS = 7;
const PUPIL_HIGHLIGHT_R = 2.5;
const PUPIL_HIGHLIGHT_OFFSET = 1.5;
const CRESCENT_W = 8;
const CRESCENT_H = 4;
const CRESCENT_OFFSET_Y = -10;
const PUPIL_LERP_RATE = 10;
const WATCHER_HP_MAX = 2;

const PHASE_IDLE_SEC = 1.5;
const PHASE_AIMING_SEC = 1.2;
const PHASE_FIRING_SEC = 0.25;
const PHASE_COOLDOWN_SEC = 0.8;

type WatcherPhase = "idle" | "aiming" | "firing" | "cooldown";

const MAX_PUPIL_OFFSET = (IRIS_OUTER_R - PUPIL_RADIUS) * 0.7;

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

    // Chase the player straight — no stop distance. Contact deals
    // damage via the room's enemy-overlap check; if the player is in
    // dash i-frames, it's dash-through damage to the Watcher instead.
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    const speed = ctxRoom.playerMaxSpeed * WATCHER_SPEED_FACTOR;
    if (dist > 1e-3) {
      const inv = 1 / dist;
      this.vx = dx * inv * speed;
      this.vy = dy * inv * speed;
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

    // 1. Outer ring — thick white with neon halo. The dark gap between
    //    ring and iris reads against the room background.
    drawNeon(
      ctx,
      () => {
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = OUTER_RING_W;
        ctx.beginPath();
        ctx.arc(this.x, this.y, WATCHER_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
      },
      "#f8fafc",
      22,
      8,
    );

    // 2. Iris — three concentric reds for a depth gradient
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ff1744";
    ctx.beginPath();
    ctx.arc(this.x, this.y, IRIS_OUTER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#cc1133";
    ctx.beginPath();
    ctx.arc(this.x, this.y, IRIS_MID_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#88001a";
    ctx.beginPath();
    ctx.arc(this.x, this.y, IRIS_INNER_R, 0, Math.PI * 2);
    ctx.fill();

    // 3. Crescent highlight on top of iris — fakes a curved-glass sheen
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(
      this.x,
      this.y + CRESCENT_OFFSET_Y,
      CRESCENT_W,
      CRESCENT_H,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();

    // 4. Pupil — solid black
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

    // 5. Pupil highlight — tiny upper-left white dot
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(
      this.x + this.pupilOffsetX - PUPIL_HIGHLIGHT_OFFSET,
      this.y + this.pupilOffsetY - PUPIL_HIGHLIGHT_OFFSET,
      PUPIL_HIGHLIGHT_R,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // HP pips above the watcher
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
