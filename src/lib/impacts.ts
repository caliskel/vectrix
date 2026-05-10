import { audio } from "./audio";
import {
  IMPACT_BULLET_FLASH_MS,
  IMPACT_BULLET_FLASH_RADIUS,
  IMPACT_BULLET_PARTICLE_COUNT,
  IMPACT_ENEMY_DAMAGE_FLASH_MS,
  IMPACT_ENEMY_DAMAGE_KNOCKBACK_MS,
  IMPACT_ENEMY_DAMAGE_KNOCKBACK_PX,
  IMPACT_ENEMY_DAMAGE_PARTICLE_COUNT,
  IMPACT_ENEMY_DAMAGE_RING_DURATION_MS,
  IMPACT_ENEMY_DAMAGE_RING_END_R,
  IMPACT_ENEMY_DAMAGE_RING_START_R,
  IMPACT_ENEMY_DAMAGE_SHAKE_AMOUNT,
  IMPACT_ENEMY_DAMAGE_SHAKE_DURATION_MS,
  IMPACT_ENEMY_KILL_FLASH_MS,
  IMPACT_ENEMY_KILL_FLASH_OPACITY,
  IMPACT_ENEMY_KILL_PARTICLE_COUNT,
  IMPACT_ENEMY_KILL_RING_INNER_DURATION_MS,
  IMPACT_ENEMY_KILL_RING_INNER_END_R,
  IMPACT_ENEMY_KILL_RING_INNER_START_R,
  IMPACT_ENEMY_KILL_RING_OUTER_DURATION_MS,
  IMPACT_ENEMY_KILL_RING_OUTER_END_R,
  IMPACT_ENEMY_KILL_RING_OUTER_START_R,
  IMPACT_ENEMY_KILL_SCREEN_FLASH_MS,
  IMPACT_ENEMY_KILL_SHAKE_AMOUNT,
  IMPACT_ENEMY_KILL_SHAKE_DURATION_MS,
  IMPACT_ENEMY_KILL_WHITE_PARTICLE_COUNT,
} from "./config";
import type { Enemy } from "./enemies/types";
import { addRing, type Particle, type Ring } from "./particles";

/**
 * Caller plumbing for impact emission. Particles + rings live in the
 * caller's per-room/per-run state; shake and screen flash are
 * delegated so each mode (sandbox / rooms) can wire them to its own
 * shake / overlay system. Sandbox passes no-op shake/flash because
 * arena bullets are the only LIGHT-tier event there.
 */
export type ImpactContext = {
  particles: Particle[];
  rings: Ring[];
  triggerShake: (amount: number, durationSec: number) => void;
  triggerScreenFlash: (durationSec: number, opacity: number) => void;
};

const IMPACT_BULLET_FLASH_SEC = IMPACT_BULLET_FLASH_MS / 1000;
const IMPACT_ENEMY_DAMAGE_RING_SEC = IMPACT_ENEMY_DAMAGE_RING_DURATION_MS / 1000;
const IMPACT_ENEMY_KILL_INNER_SEC = IMPACT_ENEMY_KILL_RING_INNER_DURATION_MS / 1000;
const IMPACT_ENEMY_KILL_OUTER_SEC = IMPACT_ENEMY_KILL_RING_OUTER_DURATION_MS / 1000;
const IMPACT_ENEMY_DAMAGE_SHAKE_SEC = IMPACT_ENEMY_DAMAGE_SHAKE_DURATION_MS / 1000;
const IMPACT_ENEMY_KILL_SHAKE_SEC = IMPACT_ENEMY_KILL_SHAKE_DURATION_MS / 1000;
const IMPACT_ENEMY_KILL_SCREEN_FLASH_SEC = IMPACT_ENEMY_KILL_SCREEN_FLASH_MS / 1000;
const IMPACT_ENEMY_DAMAGE_FLASH_SEC = IMPACT_ENEMY_DAMAGE_FLASH_MS / 1000;
const IMPACT_ENEMY_KILL_HIT_FLASH_SEC = IMPACT_ENEMY_KILL_FLASH_MS / 1000;
const IMPACT_ENEMY_DAMAGE_KNOCKBACK_SEC =
  IMPACT_ENEMY_DAMAGE_KNOCKBACK_MS / 1000;

/**
 * LIGHT-tier impact: dash-through pellet hit. Tiny white ring, a
 * handful of bullet-color particles, a high "tic" from the bit-crushed
 * triangle synth. No screen shake or screen flash — these fire often.
 */
export function emitBulletHit(
  ctx: ImpactContext,
  x: number,
  y: number,
  bulletColor: string,
): void {
  addRing(ctx.rings, x, y, {
    startR: 4,
    endR: IMPACT_BULLET_FLASH_RADIUS,
    color: "#ffffff",
    lifetime: IMPACT_BULLET_FLASH_SEC,
  });
  for (let i = 0; i < IMPACT_BULLET_PARTICLE_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 200 + Math.random() * 200;
    ctx.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      initialSize: 3,
      color: bulletColor,
      age: 0,
      lifetime: 0.35,
      glowStrong: 8,
      glowSoft: 3,
      drag: 0.95,
    });
  }
  audio.play.hitLight();
}

/**
 * MEDIUM-tier impact: dash-through landed but the enemy is still alive.
 * Hit-flash + render-only knockback on the enemy, an enemy-color ring,
 * a small particle burst, light screen shake, and the medium hit synth.
 * `fromX/fromY` should be the player position so knockback direction
 * comes out as "from player → away".
 */
export function emitEnemyDamage(
  ctx: ImpactContext,
  enemy: Enemy,
  fromX: number,
  fromY: number,
): void {
  enemy.hitFlashTime = IMPACT_ENEMY_DAMAGE_FLASH_SEC;
  const dx = enemy.x - fromX;
  const dy = enemy.y - fromY;
  const len = Math.hypot(dx, dy);
  const ndx = len > 1e-3 ? dx / len : 1;
  const ndy = len > 1e-3 ? dy / len : 0;
  enemy.knockbackPeakX = ndx * IMPACT_ENEMY_DAMAGE_KNOCKBACK_PX;
  enemy.knockbackPeakY = ndy * IMPACT_ENEMY_DAMAGE_KNOCKBACK_PX;
  enemy.knockbackTime = IMPACT_ENEMY_DAMAGE_KNOCKBACK_SEC;
  enemy.knockbackDuration = IMPACT_ENEMY_DAMAGE_KNOCKBACK_SEC;
  addRing(ctx.rings, enemy.x, enemy.y, {
    startR: IMPACT_ENEMY_DAMAGE_RING_START_R,
    endR: IMPACT_ENEMY_DAMAGE_RING_END_R,
    color: enemy.color,
    lifetime: IMPACT_ENEMY_DAMAGE_RING_SEC,
  });
  for (let i = 0; i < IMPACT_ENEMY_DAMAGE_PARTICLE_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 250 + Math.random() * 200;
    ctx.particles.push({
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      initialSize: 4,
      color: enemy.color,
      age: 0,
      lifetime: 0.5,
      glowStrong: 10,
      glowSoft: 4,
      drag: 0.95,
    });
  }
  ctx.triggerShake(
    IMPACT_ENEMY_DAMAGE_SHAKE_AMOUNT,
    IMPACT_ENEMY_DAMAGE_SHAKE_SEC,
  );
  audio.play.hitMedium();
}

/**
 * HEAVY-tier impact: kill blow. Two concentric rings (white inside,
 * enemy-color outside), 16 enemy + 8 white particles, big screen
 * shake, brief global white flash, and the layered membrane+noise
 * heavy synth. Also stamps a final hit flash on the enemy so the
 * white silhouette flashes once before the burst lands.
 */
export function emitEnemyKill(ctx: ImpactContext, enemy: Enemy): void {
  enemy.hitFlashTime = IMPACT_ENEMY_KILL_HIT_FLASH_SEC;
  addRing(ctx.rings, enemy.x, enemy.y, {
    startR: IMPACT_ENEMY_KILL_RING_INNER_START_R,
    endR: IMPACT_ENEMY_KILL_RING_INNER_END_R,
    color: "#ffffff",
    lifetime: IMPACT_ENEMY_KILL_INNER_SEC,
  });
  addRing(ctx.rings, enemy.x, enemy.y, {
    startR: IMPACT_ENEMY_KILL_RING_OUTER_START_R,
    endR: IMPACT_ENEMY_KILL_RING_OUTER_END_R,
    color: enemy.color,
    lifetime: IMPACT_ENEMY_KILL_OUTER_SEC,
  });
  for (let i = 0; i < IMPACT_ENEMY_KILL_PARTICLE_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 300 + Math.random() * 300;
    ctx.particles.push({
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      initialSize: 4,
      color: enemy.color,
      age: 0,
      lifetime: 0.7,
      glowStrong: 14,
      glowSoft: 5,
      drag: 0.96,
    });
  }
  for (let i = 0; i < IMPACT_ENEMY_KILL_WHITE_PARTICLE_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 300 + Math.random() * 300;
    ctx.particles.push({
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      initialSize: 4,
      color: "#ffffff",
      age: 0,
      lifetime: 0.7,
      glowStrong: 14,
      glowSoft: 5,
      drag: 0.96,
    });
  }
  ctx.triggerShake(
    IMPACT_ENEMY_KILL_SHAKE_AMOUNT,
    IMPACT_ENEMY_KILL_SHAKE_SEC,
  );
  ctx.triggerScreenFlash(
    IMPACT_ENEMY_KILL_SCREEN_FLASH_SEC,
    IMPACT_ENEMY_KILL_FLASH_OPACITY,
  );
  audio.play.hitHeavy();
}
