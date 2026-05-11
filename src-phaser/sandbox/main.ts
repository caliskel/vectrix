// Phaser 4 pilot — a deliberately minimal port of the sandbox to
// validate three things before committing to a full rewrite:
//   1. Visual: does the neon look survive on WebGL?
//   2. Performance: how does the WebGL renderer cope with 200+
//      bullets vs the Canvas 2D version that chokes around 100?
//   3. Feel: do the dash/walk/i-frame timings still feel right when
//      driven by Phaser's update loop?
//
// Nothing about the original code is touched — this file lives next
// to it in src-phaser/ and ships as a separate Vite entry. If the
// pilot is rejected we delete this folder and the entry from
// vite.config.ts; the rest of the game is untouched.

import Phaser from "phaser";

// Match the in-game constants so the pilot feels identical to the
// Canvas 2D sandbox. These literals are duplicated rather than
// imported so the pilot has zero coupling back to the original code
// — easier to throw away if the experiment fails.
const PLAYER_SIZE = 32;
const PLAYER_MAX_SPEED = 440;
const PLAYER_WALK_FACTOR = 0.4;
const ACCEL_FACTOR = 9;
const FRICTION = 8.0;
const DASH_DISTANCE = 220;
const DASH_DURATION_MS = 140;
const DASH_IFRAMES_MS = DASH_DURATION_MS + 80;
const DASH_COOLDOWN_MS = 800;

const BULLET_SIZE = 9;
const BULLET_SPEED = 250;
const BULLET_SPAWN_MS = 1200;
const BULLET_MAX = 30;
// Initial fill ramp — same 40 ms / 4-per-tick the Canvas sandbox uses
// to get the screen busy quickly at run start.
const INITIAL_FILL_INTERVAL_MS = 40;
const INITIAL_FILL_PER_TICK = 4;

const ARENA_W = 1200;
const ARENA_H = 800;

const COLOR_PLAYER = 0xffffff;
const COLOR_PLAYER_DASH = 0x00e5ff;
const COLOR_BULLET = 0xff2d55;
const COLOR_GRID = 0x00e5ff;
const COLOR_BG = 0x04060a;

class SandboxScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container;
  private playerRing!: Phaser.GameObjects.Arc;
  private playerIris!: Phaser.GameObjects.Arc;
  private playerPupil!: Phaser.GameObjects.Arc;
  private playerVx = 0;
  private playerVy = 0;
  private dashTimeMs = 0;
  private dashIframeMs = 0;
  private dashCooldownMs = 0;
  private dashDirX = 0;
  private dashDirY = 0;
  private hp = 3;
  private hitIframeMs = 0;

  private bullets: Phaser.GameObjects.Arc[] = [];
  private bulletVx: number[] = [];
  private bulletVy: number[] = [];
  private bulletNearMissed: boolean[] = [];
  private bulletDashHit: number[] = []; // dashId that already hit this bullet
  private spawnTimerMs = 0;
  private hitFirstCap = false;
  private fillTimerMs = 0;

  // Score / multiplier — kept simple for the pilot, matches the
  // gameplay tuning in score.ts.
  private score = 0;
  private multiplier = 1.0;
  private multiplierIdleMs = 0;
  private dashId = 0;
  private currentDashHits = 0;

  // HUD — DOM text overlay over Phaser canvas, kept simple for the
  // pilot. A proper HUD pass would use Phaser's text/bitmap text.
  private hudText!: Phaser.GameObjects.Text;
  private fpsText!: Phaser.GameObjects.Text;
  private bulletCountText!: Phaser.GameObjects.Text;

  // Inputs
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private dashKey!: Phaser.Input.Keyboard.Key;
  private walkKey!: Phaser.Input.Keyboard.Key;
  private spawnBoostKey!: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: "SandboxScene" });
  }

  create(): void {
    const cam = this.cameras.main;
    cam.setBackgroundColor(COLOR_BG);

    // Grid backdrop — drawn ONCE into a Graphics object, no per-frame
    // re-draw. WebGL caches this as a texture so it's effectively free.
    const grid = this.add.graphics();
    grid.lineStyle(1, COLOR_GRID, 0.05);
    const step = 40;
    for (let x = 0; x <= ARENA_W; x += step) {
      grid.beginPath();
      grid.moveTo(x, 0);
      grid.lineTo(x, ARENA_H);
      grid.strokePath();
    }
    for (let y = 0; y <= ARENA_H; y += step) {
      grid.beginPath();
      grid.moveTo(0, y);
      grid.lineTo(ARENA_W, y);
      grid.strokePath();
    }

    // Arena perimeter — thin cyan line; mostly so the play area reads
    // as a defined space rather than infinite void.
    const border = this.add.graphics();
    border.lineStyle(2, COLOR_GRID, 0.18);
    border.strokeRect(0, 0, ARENA_W, ARENA_H);

    // Player — Container with three nested Arcs (ring, iris, pupil),
    // mirroring the most basic version of drawPlayerEye. Glow comes
    // from Phaser's built-in postPipeline (Bloom filter) added below.
    const ringR = PLAYER_SIZE / 2;
    const irisR = PLAYER_SIZE * 0.42;
    const pupilR = PLAYER_SIZE * 0.18;
    this.playerRing = this.add.circle(0, 0, ringR, COLOR_PLAYER);
    this.playerIris = this.add.circle(0, 0, irisR, COLOR_BG);
    this.playerPupil = this.add.circle(0, 0, pupilR, COLOR_PLAYER);
    this.player = this.add.container(ARENA_W / 2, ARENA_H / 2, [
      this.playerRing,
      this.playerIris,
      this.playerPupil,
    ]);
    this.player.setDepth(10);

    // Cap the camera to the arena so it doesn't show the void around
    // smaller windows. Phaser handles letterboxing automatically when
    // the game's mode is FIT.
    cam.setBounds(0, 0, ARENA_W, ARENA_H);
    cam.centerOn(ARENA_W / 2, ARENA_H / 2);

    // Input bindings.
    const kb = this.input.keyboard!;
    this.wasd = kb.addKeys("W,A,S,D") as {
      W: Phaser.Input.Keyboard.Key;
      A: Phaser.Input.Keyboard.Key;
      S: Phaser.Input.Keyboard.Key;
      D: Phaser.Input.Keyboard.Key;
    };
    this.dashKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.walkKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.spawnBoostKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    // Single-fire trigger — Phaser fires JustDown once per actual press.
    this.dashKey.on("down", () => this.tryStartDash());

    // HUD — three lines top-right with Score / FPS / bullet count.
    // setScrollFactor(0) pins them to the viewport regardless of the
    // (eventually) follow camera. Plain Text for the pilot.
    const hudStyle = {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "14px",
      color: "#ffffff",
    } as const;
    this.hudText = this.add
      .text(ARENA_W - 12, 12, "", hudStyle)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.fpsText = this.add
      .text(ARENA_W - 12, 32, "", hudStyle)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.bulletCountText = this.add
      .text(ARENA_W - 12, 52, "", hudStyle)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);
  }

  update(_time: number, delta: number): void {
    const dtSec = delta / 1000;

    // Multiplier decay — same 2 s grace, then 0.5/s decay.
    if (this.currentDashHits === 0) {
      this.multiplierIdleMs += delta;
      if (this.multiplierIdleMs > 2000) {
        this.multiplier = Math.max(1.0, this.multiplier - 0.5 * dtSec);
      }
    }

    // Player physics — same accel/friction/cap model as the Canvas
    // sandbox so the feel carries 1:1.
    if (this.dashTimeMs > 0) {
      this.dashTimeMs -= delta;
      const v = (DASH_DISTANCE / (DASH_DURATION_MS / 1000));
      this.playerVx = this.dashDirX * v;
      this.playerVy = this.dashDirY * v;
      if (this.dashTimeMs <= 0) {
        this.dashTimeMs = 0;
        this.dashCooldownMs = DASH_COOLDOWN_MS;
        this.playerVx *= 0.35;
        this.playerVy *= 0.35;
        this.currentDashHits = 0;
      }
    } else {
      const ix = (this.wasd.D.isDown ? 1 : 0) - (this.wasd.A.isDown ? 1 : 0);
      const iy = (this.wasd.S.isDown ? 1 : 0) - (this.wasd.W.isDown ? 1 : 0);
      const len = Math.hypot(ix, iy);
      const dx = len > 0 ? ix / len : 0;
      const dy = len > 0 ? iy / len : 0;
      const accel = PLAYER_MAX_SPEED * ACCEL_FACTOR;
      this.playerVx += dx * accel * dtSec;
      this.playerVy += dy * accel * dtSec;
      const damp = Math.exp(-FRICTION * dtSec);
      this.playerVx *= damp;
      this.playerVy *= damp;
      const cap = this.walkKey.isDown
        ? PLAYER_MAX_SPEED * PLAYER_WALK_FACTOR
        : PLAYER_MAX_SPEED;
      const sp = Math.hypot(this.playerVx, this.playerVy);
      if (sp > cap) {
        const k = cap / sp;
        this.playerVx *= k;
        this.playerVy *= k;
      }
    }
    if (this.dashIframeMs > 0) this.dashIframeMs -= delta;
    if (this.dashCooldownMs > 0) this.dashCooldownMs -= delta;
    if (this.hitIframeMs > 0) this.hitIframeMs -= delta;

    this.player.x += this.playerVx * dtSec;
    this.player.y += this.playerVy * dtSec;

    // Arena clamp.
    const half = PLAYER_SIZE / 2;
    if (this.player.x < half) { this.player.x = half; if (this.playerVx < 0) this.playerVx = 0; }
    if (this.player.x > ARENA_W - half) { this.player.x = ARENA_W - half; if (this.playerVx > 0) this.playerVx = 0; }
    if (this.player.y < half) { this.player.y = half; if (this.playerVy < 0) this.playerVy = 0; }
    if (this.player.y > ARENA_H - half) { this.player.y = ARENA_H - half; if (this.playerVy > 0) this.playerVy = 0; }

    // Dash visual — flip ring colour during the dash window.
    const dashing = this.dashTimeMs > 0 || this.dashIframeMs > 0;
    this.playerRing.fillColor = dashing ? COLOR_PLAYER_DASH : COLOR_PLAYER;
    this.playerPupil.fillColor = dashing ? COLOR_PLAYER_DASH : COLOR_PLAYER;

    // Bullet hit i-frame blink — alpha pulse during the 1 s window
    // after a hit, same cue the Canvas sandbox uses.
    if (this.hitIframeMs > 0) {
      this.player.alpha = 0.5 + 0.5 * Math.sin(this.hitIframeMs * 0.03);
    } else {
      this.player.alpha = 1;
    }

    // Bullet spawn cadence. Two regimes:
    //   - initial fill: tight 40 ms cadence with 4 bullets per tick
    //     until the cap is hit for the first time
    //   - steady: 1200 ms cadence, single bullet per tick
    // Manual spawn-boost via B for stress-testing perf.
    if (!this.hitFirstCap) {
      this.fillTimerMs += delta;
      while (this.fillTimerMs >= INITIAL_FILL_INTERVAL_MS && this.bullets.length < BULLET_MAX) {
        this.fillTimerMs -= INITIAL_FILL_INTERVAL_MS;
        for (let i = 0; i < INITIAL_FILL_PER_TICK && this.bullets.length < BULLET_MAX; i++) {
          this.spawnBullet();
        }
      }
      if (this.bullets.length >= BULLET_MAX) this.hitFirstCap = true;
    } else {
      this.spawnTimerMs += delta;
      while (this.spawnTimerMs >= BULLET_SPAWN_MS && this.bullets.length < BULLET_MAX) {
        this.spawnTimerMs -= BULLET_SPAWN_MS;
        this.spawnBullet();
      }
    }
    if (this.spawnBoostKey.isDown) {
      for (let i = 0; i < 4; i++) this.spawnBullet();
    }

    // Bullet sim + collision.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += this.bulletVx[i] * dtSec;
      b.y += this.bulletVy[i] * dtSec;
      const margin = 60;
      if (
        b.x < -margin ||
        b.x > ARENA_W + margin ||
        b.y < -margin ||
        b.y > ARENA_H + margin
      ) {
        this.destroyBulletAt(i);
        continue;
      }
      const dx = b.x - this.player.x;
      const dy = b.y - this.player.y;
      const dist = Math.hypot(dx, dy);

      // Dash-through scoring — same exponential reward stack the
      // Canvas sandbox uses (100 → 200 → 400 → 800).
      if (this.dashIframeMs > 0 && this.bulletDashHit[i] !== this.dashId) {
        if (dist < half + BULLET_SIZE) {
          this.bulletDashHit[i] = this.dashId;
          const base = 100 * Math.pow(2, this.currentDashHits);
          this.currentDashHits++;
          this.score += Math.floor(base * this.multiplier);
          this.multiplier = Math.min(10, this.multiplier + 0.2);
          this.multiplierIdleMs = 0;
          this.destroyBulletAt(i);
          continue;
        }
      } else if (this.hitIframeMs <= 0 && this.dashIframeMs <= 0) {
        if (dist < half + BULLET_SIZE * 0.8) {
          this.hp -= 1;
          this.hitIframeMs = 1000;
          this.multiplier = 1.0;
          this.destroyBulletAt(i);
          continue;
        }
      }
      // Near-miss: enters the +20 px radius once, scores 50 × mult.
      if (
        !this.bulletNearMissed[i] &&
        this.dashIframeMs <= 0 &&
        dist < half + BULLET_SIZE + 20 &&
        Math.hypot(this.playerVx, this.playerVy) > 50
      ) {
        this.bulletNearMissed[i] = true;
        this.score += Math.floor(50 * this.multiplier);
        this.multiplier = Math.min(10, this.multiplier + 0.2);
        this.multiplierIdleMs = 0;
      }
    }

    // HUD refresh — once per frame, no measurable cost.
    this.hudText.setText(
      `SCORE  ${this.score}\nMULT   ×${this.multiplier.toFixed(1)}\nHP     ${this.hp}`,
    );
    this.fpsText.setText(`FPS    ${Math.round(this.game.loop.actualFps)}`);
    this.bulletCountText.setText(
      `BULLETS ${this.bullets.length}/${BULLET_MAX}  (hold B to flood)`,
    );

    if (this.hp <= 0) {
      this.hp = 3;
      this.score = 0;
      this.multiplier = 1.0;
      this.player.x = ARENA_W / 2;
      this.player.y = ARENA_H / 2;
      this.playerVx = 0;
      this.playerVy = 0;
      for (let i = this.bullets.length - 1; i >= 0; i--) this.destroyBulletAt(i);
      this.hitFirstCap = false;
    }
  }

  private destroyBulletAt(i: number): void {
    this.bullets[i].destroy();
    this.bullets.splice(i, 1);
    this.bulletVx.splice(i, 1);
    this.bulletVy.splice(i, 1);
    this.bulletNearMissed.splice(i, 1);
    this.bulletDashHit.splice(i, 1);
  }

  private spawnBullet(): void {
    // Same edge-spawn pattern the Canvas sandbox uses: pick a random
    // edge, random point along it, fire toward an interior direction
    // with a ±60° spread.
    const edge = Math.floor(Math.random() * 4);
    let x = 0;
    let y = 0;
    let baseAngle = 0;
    if (edge === 0) {
      x = Math.random() * ARENA_W;
      y = -BULLET_SIZE;
      baseAngle = Math.PI / 2;
    } else if (edge === 1) {
      x = ARENA_W + BULLET_SIZE;
      y = Math.random() * ARENA_H;
      baseAngle = Math.PI;
    } else if (edge === 2) {
      x = Math.random() * ARENA_W;
      y = ARENA_H + BULLET_SIZE;
      baseAngle = -Math.PI / 2;
    } else {
      x = -BULLET_SIZE;
      y = Math.random() * ARENA_H;
      baseAngle = 0;
    }
    const spread = (Math.random() - 0.5) * (Math.PI / 3 * 2);
    const angle = baseAngle + spread;
    const b = this.add.circle(x, y, BULLET_SIZE, COLOR_BULLET);
    b.setDepth(5);
    this.bullets.push(b);
    this.bulletVx.push(Math.cos(angle) * BULLET_SPEED);
    this.bulletVy.push(Math.sin(angle) * BULLET_SPEED);
    this.bulletNearMissed.push(false);
    this.bulletDashHit.push(-1);
  }

  private tryStartDash(): void {
    if (this.dashTimeMs > 0 || this.dashCooldownMs > 0) return;
    const ix = (this.wasd.D.isDown ? 1 : 0) - (this.wasd.A.isDown ? 1 : 0);
    const iy = (this.wasd.S.isDown ? 1 : 0) - (this.wasd.W.isDown ? 1 : 0);
    let dx: number, dy: number;
    if (ix !== 0 || iy !== 0) {
      const len = Math.hypot(ix, iy);
      dx = ix / len;
      dy = iy / len;
    } else {
      const sp = Math.hypot(this.playerVx, this.playerVy);
      if (sp > 1) {
        dx = this.playerVx / sp;
        dy = this.playerVy / sp;
      } else {
        dx = 1;
        dy = 0;
      }
    }
    this.dashDirX = dx;
    this.dashDirY = dy;
    this.dashTimeMs = DASH_DURATION_MS;
    this.dashIframeMs = DASH_IFRAMES_MS;
    this.dashId++;
    this.currentDashHits = 0;
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "app",
  backgroundColor: COLOR_BG,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: ARENA_W,
    height: ARENA_H,
  },
  // Anti-alias on for the smooth-circle look. Off would be a single
  // toggle if we want pixel-art vibe later.
  render: {
    antialias: true,
    pixelArt: false,
  },
  scene: [SandboxScene],
});
