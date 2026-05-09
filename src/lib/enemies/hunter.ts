import { drawNeon } from "../neon";
import type { Enemy, EnemyContext, EnemyType } from "./types";

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

export class Hunter implements Enemy {
  readonly type: EnemyType = "hunter";
  x: number;
  y: number;
  hp: number;
  private destroyed = false;
  private vx = 0;
  private vy = 0;
  private dashIdAlreadyDamaged = -1;
  private contactSquashTime = 0;
  // Cached so draw() can scale glow / speed lines without an EnemyContext
  private maxSpeed = 528; // 1.2 * 440 default; refreshed in update()

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = HUNTER_HP_MAX;
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
    if (this.contactSquashTime > 0) {
      this.contactSquashTime = Math.max(0, this.contactSquashTime - dt);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.destroyed) return;
    const speed = Math.hypot(this.vx, this.vy);
    const angle = speed > 0.01 ? Math.atan2(this.vy, this.vx) : 0;
    const speedNorm =
      this.maxSpeed > 0 ? Math.min(1, speed / this.maxSpeed) : 0;
    const glowBlur =
      GLOW_BLUR_MIN + (GLOW_BLUR_MAX - GLOW_BLUR_MIN) * speedNorm;

    ctx.save();
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
    // behind the polygon (negative X in local space).
    const lines = speed > SPEED_LINE_THRESHOLD ? SPEED_LINES_HIGH : SPEED_LINES_LOW;
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

  onContactDamage(): void {
    if (this.destroyed) return;
    this.vx *= CONTACT_BOUNCE_FACTOR;
    this.vy *= CONTACT_BOUNCE_FACTOR;
    this.contactSquashTime = CONTACT_SQUASH_SEC;
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
