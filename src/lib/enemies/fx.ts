import { IMPACT_ENEMY_DAMAGE_FLASH_MS } from "../config";
import type { Enemy } from "./types";

const HIT_FLASH_DURATION_SEC = IMPACT_ENEMY_DAMAGE_FLASH_MS / 1000;

/**
 * Apply the active knockback offset to the current ctx. Caller should
 * `ctx.save()` before and `ctx.restore()` after the body draw — this
 * helper just emits the translate. The peak offset linearly fades to
 * 0 across `knockbackDuration`, so a fresh hit feels punchy and the
 * return is smooth.
 */
export function applyEnemyKnockback(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
): void {
  if (e.knockbackTime <= 0 || e.knockbackDuration <= 0) return;
  const k = e.knockbackTime / e.knockbackDuration;
  const offX = e.knockbackPeakX * k;
  const offY = e.knockbackPeakY * k;
  if (offX !== 0 || offY !== 0) ctx.translate(offX, offY);
}

/**
 * Draw a white silhouette overlay on top of the enemy body while the
 * hit flash window is active. `bodyPath` should issue a single path
 * (no stroke / fill calls) describing the silhouette in world coords;
 * this helper fills it with white at an intensity that fades over
 * the flash duration. Knockback is honored implicitly because the
 * caller invokes this inside the same translated transform as the
 * body draw.
 */
export function drawEnemyHitFlash(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  bodyPath: () => void,
): void {
  if (e.hitFlashTime <= 0) return;
  const intensity = Math.min(1, e.hitFlashTime / HIT_FLASH_DURATION_SEC);
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = intensity;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 18 * intensity;
  bodyPath();
  ctx.restore();
}
