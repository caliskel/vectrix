import { makeBullet } from "../bullets";
import { drawNeon } from "../neon";
import { PALETTE } from "../palette";
import { applyEnemyKnockback, drawEnemyHitFlash } from "./fx";
import type { Enemy, EnemyContext, EnemyType } from "./types";

const TURRET_RADIUS = 25;
const TURRET_BARREL_LEN = 28;
const TURRET_BARREL_WIDTH = 12;
const SHOOT_INTERVAL = 1.4;
const TELEGRAPH_WINDOW = 0.3;
const AIM_LERP_RATE = 10; // frame-rate-independent (1 - exp(-rate*dt))
const TURRET_HP_MAX = 3;

export class Turret implements Enemy {
  readonly type: EnemyType = "turret";
  readonly color = PALETTE.playerDash;
  x: number;
  y: number;
  hp: number;
  hitFlashTime = 0;
  knockbackTime = 0;
  knockbackDuration = 0;
  knockbackPeakX = 0;
  knockbackPeakY = 0;
  private aimAngle: number;
  private shootTimer: number;
  private dashIdAlreadyDamaged = -1;
  private destroyed = false;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = TURRET_HP_MAX;
    this.aimAngle = 0;
    this.shootTimer = SHOOT_INTERVAL;
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
    const target = Math.atan2(
      ctxRoom.player.y - this.y,
      ctxRoom.player.x - this.x,
    );
    let diff = target - this.aimAngle;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    const k = 1 - Math.exp(-AIM_LERP_RATE * ctxRoom.dt);
    this.aimAngle += diff * k;

    this.shootTimer -= ctxRoom.dt;
    if (this.shootTimer <= 0) {
      this.shoot(ctxRoom);
      this.shootTimer += SHOOT_INTERVAL;
    }
  }

  private shoot(ctxRoom: EnemyContext): void {
    const speed = ctxRoom.bulletsConfig.speed;
    const off = TURRET_RADIUS + TURRET_BARREL_LEN * 0.6;
    const bx = this.x + Math.cos(this.aimAngle) * off;
    const by = this.y + Math.sin(this.aimAngle) * off;
    ctxRoom.bullets.push(
      makeBullet(
        bx,
        by,
        Math.cos(this.aimAngle) * speed,
        Math.sin(this.aimAngle) * speed,
        false, // bullets don't bounce in rooms
      ),
    );
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.destroyed) {
      drawEnemyHitFlash(ctx, this, () => {
        ctx.beginPath();
        ctx.arc(this.x, this.y, TURRET_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }
    const col = PALETTE.playerDash;
    ctx.save();
    applyEnemyKnockback(ctx, this);

    // body: double-stroke ring
    drawNeon(
      ctx,
      () => {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, TURRET_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, TURRET_RADIUS - 6, 0, Math.PI * 2);
        ctx.stroke();
      },
      col,
      22,
      8,
    );

    // core
    drawNeon(
      ctx,
      () => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 6, 0, Math.PI * 2);
        ctx.fill();
      },
      col,
      14,
      5,
    );

    // barrel — triangle pointing along aimAngle
    const telegraph =
      this.shootTimer > 0 && this.shootTimer < TELEGRAPH_WINDOW;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.aimAngle);
    drawNeon(
      ctx,
      () => {
        ctx.fillStyle = col;
        ctx.globalAlpha = telegraph ? 1.0 : 0.78;
        ctx.beginPath();
        ctx.moveTo(TURRET_RADIUS, -TURRET_BARREL_WIDTH / 2);
        ctx.lineTo(TURRET_RADIUS + TURRET_BARREL_LEN, 0);
        ctx.lineTo(TURRET_RADIUS, TURRET_BARREL_WIDTH / 2);
        ctx.closePath();
        ctx.fill();
      },
      col,
      telegraph ? 30 : 18,
      telegraph ? 12 : 7,
    );
    ctx.restore();

    // HP pips above the turret
    const dotSpacing = 10;
    const dotsY = this.y - TURRET_RADIUS - 14;
    const startX = this.x - (dotSpacing * (TURRET_HP_MAX - 1)) / 2;
    for (let i = 0; i < TURRET_HP_MAX; i++) {
      ctx.beginPath();
      ctx.fillStyle = i < this.hp ? col : "rgba(216, 180, 254, 0.22)";
      ctx.arc(startX + i * dotSpacing, dotsY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    drawEnemyHitFlash(ctx, this, () => {
      ctx.beginPath();
      ctx.arc(this.x, this.y, TURRET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  overlapsPlayer(px: number, py: number, half: number): boolean {
    if (this.destroyed) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    const reach = TURRET_RADIUS + half;
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

export const TURRET_RADIUS_PX = TURRET_RADIUS;
