import type { Bullet } from "../bullets";
import type { FloatingText, Particle, Ring } from "../particles";
import type { Player } from "../player";

// Context handed to Enemy.update so each enemy can spawn bullets,
// FX, etc. into the room's shared lists. No global state.
export type EnemyContext = {
  dt: number;
  player: Player;
  bullets: Bullet[];
  particles: Particle[];
  rings: Ring[];
  floatingTexts: FloatingText[];
  bulletsConfig: { speed: number; size: number; color: string };
};

export interface Enemy {
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
