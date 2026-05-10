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
// Mid-air construct. Three nested hexagonal shells rotating around a
// central red eye, with six small triangular fragments orbiting the
// outer ring in the opposite direction. Drifts on a slow orbit
// around a lerped player-tracking centre so the boss "circles" the
// player without lunging. Single attack in this iteration: a 12-bullet
// radial burst on a 2.5 s cadence with a 0.4 s telegraph and a 0.3 s
// recovery beat.
//
// HP 30, dies on dash-through hits only (no friendly fire in the
// boss room — only the player damages the boss).

const SENTINEL_COLOR = "#ff2d55";
const SENTINEL_HP_MAX = 30;
const SENTINEL_HITBOX_RADIUS = 110;

// Idle anim
const ROTATION_RATE = 0.25; // rad/s
const FRAGMENT_ROTATION_RATE = -0.4; // rad/s — counter-rotates
const PULSE_PERIOD_SEC = 2.0;
const PULSE_AMPLITUDE = 0.05;
const EYE_PULSE_PERIOD_SEC = 1.5;
const EYE_PULSE_AMPLITUDE = 0.05;

// Movement: orbit around a lerped player-tracking anchor
const ORBIT_CENTER_LERP = 0.02;
const ORBIT_RX = 400;
const ORBIT_RY = 300;
const ORBIT_PHASE_RATE = 0.45; // rad/s
const POSITION_LERP = 0.05;

// Attack — radial burst
const ATTACK_PERIOD_SEC = 2.5;
const TELEGRAPH_SEC = 0.4;
const BURST_FIRE_SEC = 0.05; // single-frame burst, but small window
const RECOVERY_SEC = 0.3;
const BURST_BULLET_COUNT = 12;
const BURST_BULLET_SPEED = 350;

// Hexagon vertex sets (local space), used both for shell outlines and
// for the fragment positions (one per outer-shell vertex).
const OUTER_VERTS = hexVerts(110);
const MIDDLE_VERTS = hexVerts(85);
const INNER_VERTS = hexVerts(60);

function hexVerts(r: number): { x: number; y: number }[] {
  // Pointy-top hexagon: top vertex at -r on the y axis, then every 60°
  // clockwise. Matches the spec's vertex list.
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * (Math.PI / 3);
    verts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return verts;
}

type AttackPhase = "idle" | "telegraph" | "burst" | "recovery";

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
  detectionRadius = 0; // unused — Sentinel always combat-active
  alertTimer = 0;
  deAggroCooldownTimer = 0;
  vx = 0;
  vy = 0;

  // anim
  private rotation = 0;
  private fragmentRotation = 0;
  private pulsePhase = Math.random() * Math.PI * 2;
  private eyePulsePhase = Math.random() * Math.PI * 2;

  // movement
  private orbitCenterX: number;
  private orbitCenterY: number;
  private orbitPhase: number;

  // attack
  private attackPhase: AttackPhase = "idle";
  private attackTimer = 0; // seconds in current phase
  private cycleTimer = 0; // total cycle time, fires telegraph at PERIOD

  // damage / death
  private destroyed = false;
  private dashIdAlreadyDamaged = -1;

  // intro spawn — scaled in by the rooms-game intro sequence. Caller
  // sets this to a fraction in [0..1]; the body draws at that scale.
  spawnScale = 1;
  // attacks paused while spawnScale < 1 so the intro reads as a calm
  // "I exist now" beat before the first burst.
  attacksEnabled = true;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = SENTINEL_HP_MAX;
    this.orbitCenterX = x;
    this.orbitCenterY = y;
    this.orbitPhase = Math.random() * Math.PI * 2;
    initAwareness(this, 0);
    this.awarenessState = "aggro"; // always combat-active
  }

  isDead(): boolean {
    return this.destroyed;
  }

  takeDamage(amount: number): void {
    if (this.destroyed) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.destroyed = true;
    }
  }

  update(ctxRoom: EnemyContext): void {
    if (this.destroyed) return;
    const { dt, player } = ctxRoom;

    // Idle anims tick regardless of attack phase.
    this.rotation += ROTATION_RATE * dt;
    this.fragmentRotation += FRAGMENT_ROTATION_RATE * dt;
    this.pulsePhase += (Math.PI * 2 * dt) / PULSE_PERIOD_SEC;
    this.eyePulsePhase += (Math.PI * 2 * dt) / EYE_PULSE_PERIOD_SEC;

    // Orbital movement — orbitCenter lerps toward the player slowly
    // so the orbit drifts after them but doesn't snap.
    this.orbitCenterX += (player.x - this.orbitCenterX) * ORBIT_CENTER_LERP;
    this.orbitCenterY += (player.y - this.orbitCenterY) * ORBIT_CENTER_LERP;
    this.orbitPhase += ORBIT_PHASE_RATE * dt;
    const targetX =
      this.orbitCenterX + Math.cos(this.orbitPhase) * ORBIT_RX;
    const targetY =
      this.orbitCenterY + Math.sin(this.orbitPhase) * ORBIT_RY;
    this.x += (targetX - this.x) * POSITION_LERP;
    this.y += (targetY - this.y) * POSITION_LERP;
    // Velocity is reported for any future systems that read it
    // (impacts knockback uses peak fields, not vx/vy).
    this.vx = (targetX - this.x) * POSITION_LERP * 60;
    this.vy = (targetY - this.y) * POSITION_LERP * 60;

    if (!this.attacksEnabled) return;

    // Attack cycle. cycleTimer counts up across all phases; we read
    // attackPhase/attackTimer to decide what to do.
    this.cycleTimer += dt;
    this.attackTimer += dt;
    switch (this.attackPhase) {
      case "idle": {
        if (this.cycleTimer >= ATTACK_PERIOD_SEC) {
          this.attackPhase = "telegraph";
          this.attackTimer = 0;
        }
        break;
      }
      case "telegraph": {
        if (this.attackTimer >= TELEGRAPH_SEC) {
          this.attackPhase = "burst";
          this.attackTimer = 0;
          this.fireBurst(ctxRoom);
        }
        break;
      }
      case "burst": {
        if (this.attackTimer >= BURST_FIRE_SEC) {
          this.attackPhase = "recovery";
          this.attackTimer = 0;
        }
        break;
      }
      case "recovery": {
        if (this.attackTimer >= RECOVERY_SEC) {
          this.attackPhase = "idle";
          this.attackTimer = 0;
          this.cycleTimer = 0;
        }
        break;
      }
    }
  }

  private fireBurst(ctxRoom: EnemyContext): void {
    const speed = BURST_BULLET_SPEED;
    for (let i = 0; i < BURST_BULLET_COUNT; i++) {
      const a = (i / BURST_BULLET_COUNT) * Math.PI * 2;
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

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.destroyed) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.spawnScale !== 1) {
      ctx.scale(this.spawnScale, this.spawnScale);
    }
    // Telegraph jitter — small random offset while charging the burst.
    if (this.attackPhase === "telegraph") {
      const t = Math.min(1, this.attackTimer / TELEGRAPH_SEC);
      const intensity = 2 * t;
      ctx.translate(
        (Math.random() - 0.5) * intensity * 2,
        (Math.random() - 0.5) * intensity * 2,
      );
    }

    const pulseScale = 1 + Math.sin(this.pulsePhase) * PULSE_AMPLITUDE;
    const eyePulseScale =
      1 + Math.sin(this.eyePulsePhase) * EYE_PULSE_AMPLITUDE;

    // Hexagon shells. Outer ring gets a neon halo; middle / inner are
    // flat strokes.
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
      this.attackPhase === "telegraph" ? 40 : 22,
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

    // Fragments — six small triangles orbiting the outer vertices
    // counter to the main rotation.
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

    // Central eye — three concentric circles + white pupil. Pupil
    // grows during telegraph to amplify the "about to fire" cue.
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
      this.attackPhase === "telegraph"
        ? 6 + 6 * Math.min(1, this.attackTimer / TELEGRAPH_SEC)
        : 6;
    circle(ctx, 0, 0, pupilR);

    // Hit flash — white silhouette overlay so dash-throughs read.
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

  overlapsPlayer(px: number, py: number, half: number): boolean {
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
    if (this.destroyed) return false;
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

export const SENTINEL_HP_MAX_EXPORT = SENTINEL_HP_MAX;
