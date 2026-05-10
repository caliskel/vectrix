import { drawNeon } from "../neon";
import { PALETTE } from "../palette";
import { applyAwarenessJitter, initAwareness } from "./awareness";
import { applyEnemyKnockback, drawEnemyHitFlash } from "./fx";
import type { AwarenessState, Enemy, EnemyContext, EnemyType } from "./types";

// Tutorial training dummy — a stationary, non-shooting target the
// player practices dash-throughs on. Reuses the standard impact
// feedback (knockback, hit flash, kill burst) so the cue language is
// identical to live combat. Detection radius is 0 so the awareness
// state machine never alerts; speed and AI are nil.
const DUMMY_RADIUS = 25;
const DUMMY_HP_MAX = 3;
const DUMMY_OUTLINE_WIDTH = 2;

export class TrainingDummy implements Enemy {
  readonly type: EnemyType = "training-dummy";
  readonly color = "#ffffff";
  x: number;
  y: number;
  hp: number;
  hitFlashTime = 0;
  knockbackTime = 0;
  knockbackDuration = 0;
  knockbackPeakX = 0;
  knockbackPeakY = 0;
  hitboxRadius = DUMMY_RADIUS;
  hitByLaserId = 0;
  awarenessState: AwarenessState = "idle";
  detectionRadius = 0; // never alerts — dummy is just a target
  alertTimer = 0;
  dropsKey = false;
  vx = 0;
  vy = 0;
  private destroyed = false;
  private dashIdAlreadyDamaged = -1;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.hp = DUMMY_HP_MAX;
    initAwareness(this, 0);
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

  update(_ctxRoom: EnemyContext): void {
    // No movement, no AI. The awareness tick from the room loop
    // never flips state because detectionRadius = 0.
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.destroyed) {
      drawEnemyHitFlash(ctx, this, () => {
        ctx.beginPath();
        ctx.arc(this.x, this.y, DUMMY_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    ctx.save();
    applyAwarenessJitter(ctx, this);
    applyEnemyKnockback(ctx, this);

    // Body — neutral grey fill so it reads as a target, not a live
    // enemy, with a thick white neon outline.
    drawNeon(
      ctx,
      () => {
        ctx.fillStyle = PALETTE.bgGrid;
        ctx.beginPath();
        ctx.arc(this.x, this.y, DUMMY_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = DUMMY_OUTLINE_WIDTH;
        ctx.stroke();
      },
      "#ffffff",
      14,
      4,
    );

    // Faint X mark — visual hint that this is a practice target
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.x - 8, this.y - 8);
    ctx.lineTo(this.x + 8, this.y + 8);
    ctx.moveTo(this.x + 8, this.y - 8);
    ctx.lineTo(this.x - 8, this.y + 8);
    ctx.stroke();

    // HP pips above the dummy
    const dotSpacing = 10;
    const dotsY = this.y - DUMMY_RADIUS - 12;
    const startX = this.x - (dotSpacing * (DUMMY_HP_MAX - 1)) / 2;
    for (let i = 0; i < DUMMY_HP_MAX; i++) {
      ctx.beginPath();
      ctx.fillStyle = i < this.hp ? "#ffffff" : "rgba(255,255,255,0.18)";
      ctx.arc(startX + i * dotSpacing, dotsY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    drawEnemyHitFlash(ctx, this, () => {
      ctx.beginPath();
      ctx.arc(this.x, this.y, DUMMY_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  overlapsPlayer(px: number, py: number, half: number): boolean {
    if (this.destroyed) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    const reach = DUMMY_RADIUS + half;
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
