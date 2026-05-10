import { audio } from "../audio";
import {
  ALERT_DURATION_MS,
  AWARENESS_GLOW_BOOST_DURATION_MS,
  AWARENESS_GLOW_BOOST_MUL,
  AWARENESS_SQUASH_AMOUNT,
  AWARENESS_SQUASH_DURATION_MS,
} from "../config";
import type { Enemy } from "./types";

const ALERT_DURATION_SEC = ALERT_DURATION_MS / 1000;
const AWARENESS_SQUASH_SEC = AWARENESS_SQUASH_DURATION_MS / 1000;
const AWARENESS_GLOW_BOOST_SEC = AWARENESS_GLOW_BOOST_DURATION_MS / 1000;
// "Sticky" aggro radius — once the enemy is in aggro, it stays aggro.
// We don't ramp back to idle in this version (per spec it's optional);
// keeping the constant here makes future changes obvious.
const RING_DASH: [number, number] = [4, 6];
const RING_LINE_WIDTH = 1.5;
const RING_ALPHA_MAX = 0.3;
const RING_VISIBILITY_FAR_FACTOR = 1.3;
const RING_VISIBILITY_RAMP_FACTOR = 0.5;
const RING_COLOR_IDLE = "#3a4a6a";
const RING_COLOR_ALERTING = "#fb923c";
const EXCLAMATION_RISE_DURATION_SEC = 0.2;
const EXCLAMATION_BASE_OFFSET = -30;
const EXCLAMATION_RISE_PX = 5;
const EXCLAMATION_FADE_OUT_SEC = 0.05;

/**
 * Tick the per-enemy awareness state machine. Plays the alert ping
 * on idle → alerting transitions; alerting auto-graduates to aggro
 * after ALERT_DURATION_SEC. Once in aggro the enemy stays there.
 */
export function updateEnemyAwareness(
  enemy: Enemy,
  px: number,
  py: number,
  dt: number,
): void {
  if (enemy.isDead()) return;
  if (enemy.awarenessSquashTime > 0)
    enemy.awarenessSquashTime = Math.max(0, enemy.awarenessSquashTime - dt);
  if (enemy.awarenessGlowBoost > 0)
    enemy.awarenessGlowBoost = Math.max(0, enemy.awarenessGlowBoost - dt);

  if (enemy.awarenessState === "idle") {
    const dx = px - enemy.x;
    const dy = py - enemy.y;
    if (dx * dx + dy * dy < enemy.detectionRadius * enemy.detectionRadius) {
      enemy.awarenessState = "alerting";
      enemy.alertTimer = 0;
      enemy.awarenessSquashTime = AWARENESS_SQUASH_SEC;
      audio.play.alert();
    }
  } else if (enemy.awarenessState === "alerting") {
    enemy.alertTimer += dt;
    if (enemy.alertTimer >= ALERT_DURATION_SEC) {
      enemy.awarenessState = "aggro";
      enemy.awarenessGlowBoost = AWARENESS_GLOW_BOOST_SEC;
    }
  }
}

/** Multiplier on glow blur during the post-alert boost (1.0 normally). */
export function awarenessGlowMul(enemy: Enemy): number {
  if (enemy.awarenessGlowBoost <= 0) return 1;
  const t = enemy.awarenessGlowBoost / AWARENESS_GLOW_BOOST_SEC;
  return 1 + (AWARENESS_GLOW_BOOST_MUL - 1) * t;
}

/** Uniform scale (≤ 1) for the brief jolt on idle → alerting. */
export function awarenessSquashScale(enemy: Enemy): number {
  if (enemy.awarenessSquashTime <= 0) return 1;
  const t = enemy.awarenessSquashTime / AWARENESS_SQUASH_SEC;
  return 1 - (1 - AWARENESS_SQUASH_AMOUNT) * t;
}

/**
 * Faint dashed ring around the enemy at its detection radius. Visible
 * only when the player is close enough; intensity ramps in over the
 * last 50 % of the radius. Color reflects the state — muted slate in
 * idle, alert orange while alerting, the enemy's combat color in
 * aggro. Skipped on dead enemies.
 */
export function drawEnemyDetection(
  ctx: CanvasRenderingContext2D,
  enemy: Enemy,
  px: number,
  py: number,
): void {
  if (enemy.isDead()) return;
  const dx = px - enemy.x;
  const dy = py - enemy.y;
  const dist = Math.hypot(dx, dy);
  const farLimit = enemy.detectionRadius * RING_VISIBILITY_FAR_FACTOR;
  const ramp = enemy.detectionRadius * RING_VISIBILITY_RAMP_FACTOR;
  const visibility = ramp > 0 ? Math.max(0, Math.min(1, (farLimit - dist) / ramp)) : 0;
  if (visibility <= 0) return;

  const color =
    enemy.awarenessState === "aggro"
      ? enemy.color
      : enemy.awarenessState === "alerting"
        ? RING_COLOR_ALERTING
        : RING_COLOR_IDLE;

  ctx.save();
  ctx.globalAlpha = visibility * RING_ALPHA_MAX;
  ctx.strokeStyle = color;
  ctx.lineWidth = RING_LINE_WIDTH;
  ctx.setLineDash(RING_DASH);
  ctx.beginPath();
  ctx.arc(enemy.x, enemy.y, enemy.detectionRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Red exclamation mark above the enemy during the alerting phase.
 * Rises 5 px over 200 ms, holds, fades out in the last 50 ms before
 * graduating to aggro.
 */
export function drawAwarenessExclamation(
  ctx: CanvasRenderingContext2D,
  enemy: Enemy,
): void {
  if (enemy.awarenessState !== "alerting") return;
  if (enemy.isDead()) return;
  const riseT = Math.min(1, enemy.alertTimer / EXCLAMATION_RISE_DURATION_SEC);
  const liftY = EXCLAMATION_BASE_OFFSET - riseT * EXCLAMATION_RISE_PX;
  const fadeRemaining =
    ALERT_DURATION_SEC - enemy.alertTimer;
  const alpha =
    fadeRemaining > EXCLAMATION_FADE_OUT_SEC
      ? 1
      : Math.max(0, fadeRemaining / EXCLAMATION_FADE_OUT_SEC);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "bold 26px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ff2d55";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ff2d55";
  ctx.fillText("!", enemy.x, enemy.y + liftY);
  ctx.restore();
}

/**
 * Default initializer the enemy classes call from their constructors.
 * Centralises the "fresh enemy is sleeping" rule so a future enemy
 * can't forget to reset awareness state.
 */
export function initAwareness(enemy: Enemy, detectionRadius: number): void {
  enemy.awarenessState = "idle";
  enemy.detectionRadius = detectionRadius;
  enemy.alertTimer = 0;
  enemy.awarenessSquashTime = 0;
  enemy.awarenessGlowBoost = 0;
}
