import { audio } from "../audio";
import {
  ALERT_BURST_PARTICLE_COUNT,
  ALERT_BURST_PARTICLE_LIFETIME_MS,
  ALERT_BURST_PARTICLE_SPEED_MAX,
  ALERT_BURST_PARTICLE_SPEED_MIN,
  ALERT_DURATION_MS,
  ALERT_JITTER_END_INTENSITY,
  ALERT_JITTER_INTENSITY_PEAK,
  ALERT_JITTER_PEAK_TIME,
  ALERT_RING_DURATION_MS,
  ALERT_RING_END_RADIUS_OFFSET,
  ALERT_RING_START_LINEWIDTH,
} from "../config";
import { addRing, type Particle, type Ring } from "../particles";
import type { Enemy } from "./types";

const ALERT_DURATION_SEC = ALERT_DURATION_MS / 1000;
const ALERT_RING_DURATION_SEC = ALERT_RING_DURATION_MS / 1000;
const ALERT_BURST_PARTICLE_LIFETIME_SEC = ALERT_BURST_PARTICLE_LIFETIME_MS / 1000;
const RING_DASH: [number, number] = [4, 6];
const RING_LINE_WIDTH = 1.5;
const RING_ALPHA_MAX = 0.3;
const RING_VISIBILITY_FAR_FACTOR = 1.3;
const RING_VISIBILITY_RAMP_FACTOR = 0.5;
const RING_COLOR_IDLE = "#3a4a6a";
const RING_COLOR_ALERTING = "#fb923c";

/**
 * Caller plumbing for the one-shot alert burst (ring + particles).
 * `updateEnemyAwareness` only needs this on the idle → alerting
 * transition, but the type is small enough that callers can build it
 * once per frame and reuse.
 */
export type AwarenessTriggerCtx = {
  particles: Particle[];
  rings: Ring[];
};

/**
 * Tick the per-enemy awareness state machine. Plays the alert ping
 * + spawns a ring-burst on idle → alerting; alerting auto-graduates
 * to aggro after ALERT_DURATION_SEC. Once in aggro the enemy stays
 * there.
 */
export function updateEnemyAwareness(
  enemy: Enemy,
  px: number,
  py: number,
  dt: number,
  trigger?: AwarenessTriggerCtx,
): void {
  if (enemy.isDead()) return;

  if (enemy.awarenessState === "idle") {
    const dx = px - enemy.x;
    const dy = py - enemy.y;
    if (dx * dx + dy * dy < enemy.detectionRadius * enemy.detectionRadius) {
      enemy.awarenessState = "alerting";
      enemy.alertTimer = 0;
      audio.play.alert();
      if (trigger) emitAlertBurst(trigger, enemy);
    }
  } else if (enemy.awarenessState === "alerting") {
    enemy.alertTimer += dt;
    if (enemy.alertTimer >= ALERT_DURATION_SEC) {
      enemy.awarenessState = "aggro";
    }
  }
}

/**
 * Apply the alert-phase jitter to ctx — random translation that ramps
 * up to ALERT_JITTER_INTENSITY_PEAK at ALERT_JITTER_PEAK_TIME and
 * eases back to ALERT_JITTER_END_INTENSITY by the end of the window.
 * Caller is responsible for being inside its own `ctx.save()` (each
 * enemy already does this in its draw method).
 */
export function applyAwarenessJitter(
  ctx: CanvasRenderingContext2D,
  enemy: Enemy,
): void {
  if (enemy.awarenessState !== "alerting") return;
  if (enemy.isDead()) return;
  const t = Math.max(0, Math.min(1, enemy.alertTimer / ALERT_DURATION_SEC));
  const intensity = jitterIntensity(t);
  if (intensity <= 0) return;
  const jx = (Math.random() - 0.5) * intensity * 2;
  const jy = (Math.random() - 0.5) * intensity * 2;
  ctx.translate(jx, jy);
}

function jitterIntensity(t: number): number {
  // Triangle ramp: 1 → peak (at PEAK_TIME) → end intensity at t=1.
  const peakT = ALERT_JITTER_PEAK_TIME;
  if (t < peakT) {
    const u = t / peakT;
    return 1 + (ALERT_JITTER_INTENSITY_PEAK - 1) * u;
  }
  const u = (t - peakT) / (1 - peakT);
  return (
    ALERT_JITTER_INTENSITY_PEAK +
    (ALERT_JITTER_END_INTENSITY - ALERT_JITTER_INTENSITY_PEAK) * u
  );
}

function emitAlertBurst(ctx: AwarenessTriggerCtx, enemy: Enemy): void {
  const r0 = enemy.hitboxRadius + 5;
  const r1 = enemy.hitboxRadius * 2 + ALERT_RING_END_RADIUS_OFFSET;
  addRing(ctx.rings, enemy.x, enemy.y, {
    startR: r0,
    endR: r1,
    color: enemy.color,
    lifetime: ALERT_RING_DURATION_SEC,
    startLineWidth: ALERT_RING_START_LINEWIDTH,
    endLineWidth: 1,
    glowBlur: 18,
  });
  for (let i = 0; i < ALERT_BURST_PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed =
      ALERT_BURST_PARTICLE_SPEED_MIN +
      Math.random() *
        (ALERT_BURST_PARTICLE_SPEED_MAX - ALERT_BURST_PARTICLE_SPEED_MIN);
    ctx.particles.push({
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      initialSize: 3,
      color: enemy.color,
      age: 0,
      lifetime: ALERT_BURST_PARTICLE_LIFETIME_SEC,
      glowStrong: 10,
      glowSoft: 4,
      drag: 0.94,
    });
  }
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
  const visibility =
    ramp > 0 ? Math.max(0, Math.min(1, (farLimit - dist) / ramp)) : 0;
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
 * Default initializer the enemy classes call from their constructors.
 * Centralises the "fresh enemy is sleeping" rule so a future enemy
 * can't forget to reset awareness state.
 */
export function initAwareness(enemy: Enemy, detectionRadius: number): void {
  enemy.awarenessState = "idle";
  enemy.detectionRadius = detectionRadius;
  enemy.alertTimer = 0;
}

/**
 * Apply a per-instance detectionRadius override after construction.
 * Used by encounter authoring (Room 4 staggers turret radii so the
 * corridor wakes them up one by one) without changing the archetype
 * default for other rooms.
 */
export function setDetectionRadius(enemy: Enemy, radius: number): void {
  enemy.detectionRadius = radius;
}
