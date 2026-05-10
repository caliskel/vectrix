import type { Bullet } from "../bullets";
import type { FloatingText, Particle, Ring } from "../particles";
import type { Player } from "../player";
import type { Wall } from "../walls";

export type EnemyType = "turret" | "watcher" | "hunter";

/**
 * Awareness state for the per-enemy detection ramp:
 *   idle      — sleeping; no attacks, no chase, only ambient idle anim
 *   alerting  — player just entered detectionRadius; "!" telegraph and
 *               brief squash + glow boost over ALERT_DURATION_MS
 *   aggro     — combat behavior (the existing update logic)
 */
export type AwarenessState = "idle" | "alerting" | "aggro";

// Beam/laser entity owned by the room (not by any single enemy) so any
// enemy can stamp one into the room state. Self-expires by age.
//
// Origin tracks the owner enemy live so a moving owner's beam stays
// rooted in its eye. Direction is fixed at aim time (`aimAngle`,
// radians) — that's the dodge window. endX/endY are derived state,
// recomputed each frame as the ray's first wall intersection from the
// current owner position; so the beam always pierces the full room
// rather than stopping at the captured aim point.
export type Laser = {
  /** Unique per-instance id so per-laser dedup (player dodge bonus,
   *  friendly-fire damage application) doesn't cross between lasers. */
  id: number;
  ownerType: EnemyType;
  ownerEnemy: Enemy;
  aimAngle: number;
  endX: number;
  endY: number;
  chargingDuration: number; // seconds in charging phase (telegraph)
  firingDuration: number;   // seconds in firing phase (the actual hit)
  age: number;              // counts up; phase derived from this
  /** Once a dashing player crosses a firing laser this is set so the
   *  +50 dodge bonus only credits once per dash. */
  dodgedByDashId?: number;
};

// Context handed to Enemy.update so each enemy can spawn bullets,
// FX, etc. into the room's shared lists. No global state.
export type EnemyContext = {
  dt: number;
  player: Player;
  bullets: Bullet[];
  particles: Particle[];
  rings: Ring[];
  floatingTexts: FloatingText[];
  lasers: Laser[];
  bulletsConfig: { speed: number; size: number; color: string };
  playerHalfSize: number;
  playerMaxSpeed: number;
  /** Walls of the current room — moving enemies (Watcher, Hunter)
   *  resolve collisions against these so they don't clip through. */
  walls: Wall[];
};

export interface Enemy {
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  /** Representative color for impact FX (kill ring, particles). Each
   *  enemy publishes the most readable hue from its body palette. */
  readonly color: string;
  /** Seconds remaining for the white hit-flash overlay; ticked down
   *  outside the enemy's own update so a freshly-killed enemy can
   *  still flash for a frame after `destroyed` flips. */
  hitFlashTime: number;
  /** Seconds remaining of render-only knockback offset, plus the
   *  initial duration for the linear fade and the peak (px) per axis. */
  knockbackTime: number;
  knockbackDuration: number;
  knockbackPeakX: number;
  knockbackPeakY: number;
  isDead(): boolean;
  takeDamage(amount: number): void;
  update(ctx: EnemyContext): void;
  draw(ctx: CanvasRenderingContext2D): void;
  /** True if a player AABB at (px, py, half×half) overlaps the enemy body. */
  overlapsPlayer(px: number, py: number, half: number): boolean;
  /**
   * Try to deal dash-through damage. Returns true on the FIRST hit per
   * dash session; same dashId can't repeat. Implementations track
   * the last damaged dashId internally.
   */
  tryDashDamage(dashId: number, px: number, py: number, half: number): boolean;
  /**
   * Optional reaction when this enemy was the one that dealt contact
   * damage to the player — e.g. Hunter bouncing off so it doesn't
   * camp on the player while i-frames tick down.
   */
  onContactDamage?(): void;
  /** Marks this enemy as the one that drops the room's key on death.
   *  rooms-game checks the flag in the kill path; only a single key
   *  per room is supported for now. */
  dropsKey: boolean;
  /** Approximate bounding radius — used for laser/segment proximity
   *  checks (friendly fire, future area effects). overlapsPlayer
   *  remains the canonical dash/contact test. */
  hitboxRadius: number;
  /** Last Laser.id that successfully damaged this enemy. Stops the
   *  same firing beam from re-applying damage every frame across
   *  the firing window. */
  hitByLaserId: number;
  /** Awareness state machine (see AwarenessState above). Each enemy
   *  starts in `idle`; `updateEnemyAwareness` runs once per frame in
   *  rooms-game and handles transitions + audio. */
  awarenessState: AwarenessState;
  /** Detection radius in px — distance at which the player triggers
   *  the idle → alerting transition. Per archetype default lives in
   *  config.ts (`ENEMY_TURRET_DETECTION` etc). */
  detectionRadius: number;
  /** Seconds elapsed in the alerting phase. Drives the jitter ramp
   *  and the timed transition to aggro. */
  alertTimer: number;
}
