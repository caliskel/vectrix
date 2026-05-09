import type { Bullet } from "../bullets";
import type { FloatingText, Particle, Ring } from "../particles";
import type { Player } from "../player";

export type EnemyType = "turret" | "watcher";

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
};

export interface Enemy {
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
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
}
