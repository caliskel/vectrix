import { acquireBullet } from "../bullets";
import { ENEMY_TURRET_DETECTION } from "../config";
import { PALETTE } from "../palette";
import { applyAwarenessJitter, initAwareness } from "./awareness";
import { applyEnemyKnockback, drawEnemyHitFlash } from "./fx";
import {
  BARREL_ANCHOR_X,
  BARREL_ANCHOR_Y,
  BODY_ANCHOR,
  getTurretBarrelSprite,
  getTurretBodySprite,
} from "./turret-sprite";
import type { AwarenessState, Enemy, EnemyContext, EnemyType } from "./types";

const TURRET_RADIUS = 25;
const TURRET_BARREL_LEN = 28;
const SHOOT_INTERVAL = 1.0;
const TELEGRAPH_WINDOW = 0.3;
const AIM_LERP_RATE = 10; // frame-rate-independent (1 - exp(-rate*dt))
const IDLE_AIM_LERP_RATE = 1.5; // slower drift while sleeping
const IDLE_AIM_RETARGET_MIN_SEC = 2.5;
const IDLE_AIM_RETARGET_MAX_SEC = 3.5;
const TURRET_HP_MAX = 2;

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
  dropsKey = false;
  hitboxRadius = 25;
  hitByLaserId = 0;
  awarenessState: AwarenessState = "idle";
  detectionRadius = ENEMY_TURRET_DETECTION;
  alertTimer = 0;
  canDeaggro = true;
  deAggroCooldownTimer = 0;
  /** Seconds remaining on the post-spawn invuln window. While > 0
   *  the turret can't be damaged and won't shoot. Used by the
   *  Sentinel phase-3 corner-turret spawn so each turret animates
   *  in over 700 ms before becoming a live threat. Zero for
   *  turrets constructed without `spawnInvulnerableSec`. */
  spawnInvulnerableTime = 0;
  private aimAngle: number;
  private idleTargetAngle: number;
  private idleRetargetTimer: number;
  private shootTimer: number;
  private dashIdAlreadyDamaged = -1;
  private destroyed = false;
  /** Per-instance fire interval — overrides the file-level
   *  `SHOOT_INTERVAL`. Defaults to SHOOT_INTERVAL when not
   *  supplied via constructor opts. */
  private fireIntervalSec: number = SHOOT_INTERVAL;
  /** Per-instance bullet speed (px/s). When null, fall back to
   *  `ctxRoom.bulletsConfig.speed`. Sentinel corner turrets pin
   *  this lower than the room default so the player can read four
   *  parallel streams against the rest of phase-3 chaos. */
  private bulletSpeedOverride: number | null = null;
  /** Full duration of the spawn-invuln window — needed by `draw`
   *  to map the remaining time to a scale ramp. */
  private spawnInvulnerableTotalSec = 0;

  constructor(
    x: number,
    y: number,
    opts: {
      startsAggressive?: boolean;
      fireIntervalSec?: number;
      bulletSpeed?: number;
      spawnInvulnerableSec?: number;
    } = {},
  ) {
    this.x = x;
    this.y = y;
    this.hp = TURRET_HP_MAX;
    this.aimAngle = Math.random() * Math.PI * 2;
    this.idleTargetAngle = this.aimAngle;
    this.idleRetargetTimer = randomIdleRetarget();
    if (opts.fireIntervalSec !== undefined) {
      this.fireIntervalSec = opts.fireIntervalSec;
    }
    this.shootTimer = this.fireIntervalSec;
    initAwareness(this, ENEMY_TURRET_DETECTION);
    if (opts.startsAggressive) {
      // Skip the idle / alerting telegraph entirely — the turret is
      // pre-aggro on spawn (Sentinel's corner turrets activate
      // already-engaged because the spawn ring is itself the
      // telegraph). canDeaggro stays false so they never go back
      // to sleep mid-fight.
      this.awarenessState = "aggro";
      this.canDeaggro = false;
    }
    if (opts.bulletSpeed !== undefined) {
      this.bulletSpeedOverride = opts.bulletSpeed;
    }
    if (opts.spawnInvulnerableSec !== undefined) {
      this.spawnInvulnerableTime = opts.spawnInvulnerableSec;
      this.spawnInvulnerableTotalSec = opts.spawnInvulnerableSec;
    }
  }

  isDead(): boolean {
    return this.destroyed;
  }

  takeDamage(amount: number): void {
    if (this.destroyed) return;
    // Spawn-invuln window — the turret is materialising and can't be
    // hit. Mostly relevant for the Sentinel phase-3 corner spawn so
    // players can't insta-kill a turret on its first visible frame.
    if (this.spawnInvulnerableTime > 0) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroyed = true;
    }
  }

  update(ctxRoom: EnemyContext): void {
    if (this.destroyed) return;
    if (this.spawnInvulnerableTime > 0) {
      // Materialising — tick the invuln timer, but don't aim or
      // shoot. The barrel sits at the random spawn angle, which is
      // fine because the scale ramp in draw() makes the body too
      // small to read anyway.
      this.spawnInvulnerableTime = Math.max(
        0,
        this.spawnInvulnerableTime - ctxRoom.dt,
      );
      return;
    }
    if (this.awarenessState !== "aggro") {
      // Idle / alerting — slowly drift the barrel to a random heading
      // every ~3 s so the turret reads as awake but not engaged. No
      // shooting; alerting is a pure visual telegraph.
      this.idleRetargetTimer -= ctxRoom.dt;
      if (this.idleRetargetTimer <= 0) {
        this.idleTargetAngle = Math.random() * Math.PI * 2;
        this.idleRetargetTimer = randomIdleRetarget();
      }
      let diff = this.idleTargetAngle - this.aimAngle;
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (diff < -Math.PI) diff += Math.PI * 2;
      const k = 1 - Math.exp(-IDLE_AIM_LERP_RATE * ctxRoom.dt);
      this.aimAngle += diff * k;
      // Reset shoot timer so the first volley after waking up still
      // gets the full telegraph, instead of firing on tick zero.
      this.shootTimer = SHOOT_INTERVAL;
      return;
    }
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
      this.shootTimer += this.fireIntervalSec;
    }
  }

  private shoot(ctxRoom: EnemyContext): void {
    const speed = this.bulletSpeedOverride ?? ctxRoom.bulletsConfig.speed;
    const off = TURRET_RADIUS + TURRET_BARREL_LEN * 0.6;
    const bx = this.x + Math.cos(this.aimAngle) * off;
    const by = this.y + Math.sin(this.aimAngle) * off;
    ctxRoom.bullets.push(
      acquireBullet(
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
    applyAwarenessJitter(ctx, this);
    applyEnemyKnockback(ctx, this);

    // Spawn-invuln scale-in — first 200 ms of the window the
    // turret stays invisible (matches the Sentinel spec), then
    // scales 0 → 1 over the remaining 500 ms so it "materialises"
    // from the spawn ring rather than popping in solid. Skipped
    // for turrets without a spawn-invuln window (constructed via
    // the legacy zero-arg path).
    if (this.spawnInvulnerableTotalSec > 0) {
      const u =
        1 - this.spawnInvulnerableTime / this.spawnInvulnerableTotalSec;
      const invisibleFrac =
        0.2 / Math.max(0.0001, this.spawnInvulnerableTotalSec);
      const denom = Math.max(0.0001, 1 - invisibleFrac);
      const scale = u < invisibleFrac ? 0 : (u - invisibleFrac) / denom;
      if (scale <= 0) {
        ctx.restore();
        return;
      }
      ctx.translate(this.x, this.y);
      ctx.scale(scale, scale);
      ctx.translate(-this.x, -this.y);
    }

    // body + core — cached as a single sprite with the layered glow
    // baked in. Replaces two drawNeon calls (4 shadowBlur ops) with
    // one drawImage per turret per frame.
    const body = getTurretBodySprite();
    ctx.drawImage(body, this.x - BODY_ANCHOR, this.y - BODY_ANCHOR);

    // barrel — same trick, plus a separate cached sprite for the
    // telegraph variant so the brighter glow flashes in without a
    // live shadowBlur cost.
    const telegraph =
      this.shootTimer > 0 && this.shootTimer < TELEGRAPH_WINDOW;
    const barrel = getTurretBarrelSprite(telegraph);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.aimAngle);
    ctx.drawImage(barrel, -BARREL_ANCHOR_X, -BARREL_ANCHOR_Y);
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

function randomIdleRetarget(): number {
  return (
    IDLE_AIM_RETARGET_MIN_SEC +
    Math.random() * (IDLE_AIM_RETARGET_MAX_SEC - IDLE_AIM_RETARGET_MIN_SEC)
  );
}

export const TURRET_RADIUS_PX = TURRET_RADIUS;
