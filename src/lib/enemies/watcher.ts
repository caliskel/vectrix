import { audio } from "../audio";
import { WATCHER_SPEED_FACTOR } from "../config";
import { drawNeon } from "../neon";
import type { Enemy, EnemyContext, EnemyType, Laser } from "./types";

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
const OUTER_RING_W = 5;
const IRIS_OUTER_R = 24;
const IRIS_MID_R = 19;
const IRIS_INNER_R = 14;
const IRIS_OUTER_COLOR = "#ff1744";
const IRIS_MID_COLOR = "#c8002a";
const IRIS_INNER_COLOR = "#6b0014";
const PUPIL_RADIUS = 6;
const PUPIL_HIGHLIGHT_R = 1.8;
const PUPIL_HIGHLIGHT_OFFSET = 1.5;
const GLOSS_OFFSET_Y = -16;
const GLOSS_W = 12;
const GLOSS_H = 5;
const GLOSS_ALPHA = 0.2;
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

    // Movement: freeze during aiming/firing so the laser is readable —
    // the player gets a clean stop-then-aim tell. Chase resumes in
    // cooldown/idle.
    const frozen = this.phase === "aiming" || this.phase === "firing";
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (frozen) {
      this.vx = 0;
      this.vy = 0;
    } else {
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
        const laser: Laser = {
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
