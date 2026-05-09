import { audio } from "../lib/audio";
import { type Bullet, pushTrailSample } from "../lib/bullets";
import {
  PARTICLE_BASE_SPEED_MAX,
  PARTICLE_BASE_SPEED_MIN,
  PARTICLE_DASH_SPAWN_INTERVAL_MS,
  PARTICLE_DASH_SPEED_MULTIPLIER,
  PARTICLE_DRAG,
  PARTICLE_LATERAL_JITTER,
  PARTICLE_LIFETIME_MS,
  PARTICLE_SIZE_MAX_FACTOR,
  PARTICLE_SIZE_MIN_FACTOR,
  PARTICLE_SPAWN_INTERVAL_MS,
  PARTICLE_TRAIL_MIN_SPEED,
  loadSettings,
  saveSettings,
  type Settings,
} from "../lib/config";
import { drawDoor, playerOverlapsDoor } from "../lib/door";
import type { Enemy } from "../lib/enemies/types";
import { drawNeon } from "../lib/neon";
import { PALETTE } from "../lib/palette";
import {
  type FloatingText,
  type Particle,
  type Ring,
  addFloatingText,
  addRing,
} from "../lib/particles";
import {
  type PlayerProfile,
  createPlayer,
  dashSpeed,
  drawPlayerEye,
  eyeOnHit,
  eyeStartClosing,
  findNearestThreat,
  inputDirection,
  loadPlayerProfile,
  resetEyeState,
  updateEye,
} from "../lib/player";
import { createMenu } from "../lib/settings-menu";
import { type Bounds, hitBounds } from "../lib/types";
import {
  bulletInsideWall,
  drawWalls,
  resolvePlayerWallCollisions,
} from "../lib/walls";
import { buildRoom1, ROOM_H_PX, ROOM_W_PX } from "./room1";
import { buildRoom2 } from "./room2";
import type { Room } from "./room";

const ACCEL_FACTOR = 9;
const FRICTION = 8.0;
const HIT_IFRAME = 1.0;
const HIT_VIGNETTE = 0.2;
const TURRET_KILL_SCORE = 500;
const ROOM_TOTAL = 2;
const ROOM_CLEAR_FLASH = 0.2;
const ROOMS_BEST_KEY = "dash-proto:rooms-best";

type RunState = "playing" | "failed";

type FailedSnapshot = {
  score: number;
  bestScore: number | null;
  newBest: boolean;
};

type GameState = {
  runState: RunState;
  hp: number;
  score: number;
  hitIframe: number;
  hitVignette: number;
  dashId: number;
  particleSpawnTimer: number;
  clearedRoomIds: Set<string>;
  clearFlash: number; // counts down 0.2 → 0 after a fresh clear
  failedSnapshot: FailedSnapshot | null;
};

export function start(canvas: HTMLCanvasElement): void {
  const rawCtx = canvas.getContext("2d");
  if (!rawCtx) return;
  const ctx: CanvasRenderingContext2D = rawCtx;

  const settings: Settings = loadSettings();
  const save = () => saveSettings(settings);

  audio.setMasterVolume(settings.audio.master);
  audio.setSfxVolume(settings.audio.sfx);
  audio.setMusicVolume(settings.audio.music);

  // Player profile from the landing-page editor (saved in localStorage).
  // Loaded once at start; the editor lives on a different page so a
  // change implies a navigation back, which re-runs start().
  const profile: PlayerProfile = loadPlayerProfile();

  // Canvas / layout state
  let dpr = window.devicePixelRatio || 1;
  let viewW = 0;
  let viewH = 0;
  // letterbox: integer scale factor mapping room space to screen
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function recomputeLayout() {
    scale = Math.min(viewW / ROOM_W_PX, viewH / ROOM_H_PX);
    offsetX = (viewW - ROOM_W_PX * scale) / 2;
    offsetY = (viewH - ROOM_H_PX * scale) / 2;
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    recomputeLayout();
  }
  resize();
  window.addEventListener("resize", resize);

  // ------- game state -------
  const player = createPlayer();
  let bullets: Bullet[] = [];
  let particles: Particle[] = [];
  let rings: Ring[] = [];
  let floatingTexts: FloatingText[] = [];

  const rooms = new Map<string, Room>();
  rooms.set("room1", buildRoom1());
  rooms.set("room2", buildRoom2());

  const state: GameState = {
    runState: "playing",
    hp: 3,
    score: 0,
    hitIframe: 0,
    hitVignette: 0,
    dashId: 0,
    particleSpawnTimer: 0,
    clearedRoomIds: new Set(),
    clearFlash: 0,
    failedSnapshot: null,
  };

  let currentRoom: Room = rooms.get("room1")!;

  // overlay button bounds (CSS pixel space)
  let tryAgainBounds: Bounds | null = null;

  // ------- helpers -------

  function spawnPlayerInCurrentRoom() {
    player.x = currentRoom.spawnX;
    player.y = currentRoom.spawnY;
    player.vx = 0;
    player.vy = 0;
    player.facingX = 1;
    player.facingY = 0;
    player.dashTime = 0;
    player.dashIframeTime = 0;
    player.cooldown = 0;
  }
  spawnPlayerInCurrentRoom();

  function rebuildAllRooms() {
    rooms.set("room1", buildRoom1());
    rooms.set("room2", buildRoom2());
  }

  function restartRun() {
    rebuildAllRooms();
    currentRoom = rooms.get("room1")!;
    state.runState = "playing";
    state.hp = 3;
    state.score = 0;
    state.hitIframe = 0;
    state.hitVignette = 0;
    state.dashId = 0;
    state.particleSpawnTimer = 0;
    state.clearedRoomIds = new Set();
    state.clearFlash = 0;
    state.failedSnapshot = null;
    bullets = [];
    particles = [];
    rings = [];
    floatingTexts = [];
    tryAgainBounds = null;
    spawnPlayerInCurrentRoom();
    resetEyeState(player);
  }

  function transitionToRoom(id: string) {
    const next = rooms.get(id);
    if (!next) return;
    currentRoom = next;
    bullets = [];
    rings = [];
    floatingTexts = [];
    spawnPlayerInCurrentRoom();
  }

  // ------- input / menu -------

  const keys = new Set<string>();
  const menu = createMenu(settings, save, () => {
    restartRun();
  });

  function normalizeCode(code: string): string {
    switch (code) {
      case "ShiftLeft":
      case "ShiftRight":
        return "Shift";
      case "ControlLeft":
      case "ControlRight":
        return "Control";
      case "AltLeft":
      case "AltRight":
        return "Alt";
      case "MetaLeft":
      case "MetaRight":
        return "Meta";
    }
    return code;
  }

  function isBoundKey(k: string): boolean {
    for (const v of Object.values(settings.bindings)) if (v === k) return true;
    return false;
  }

  window.addEventListener("keydown", (e) => {
    audio.init();
    const code = normalizeCode(e.code);

    if (menu.isCapturing()) {
      e.preventDefault();
      if (code === "Escape") menu.cancelCapture();
      else menu.acceptCapturedKey(code);
      return;
    }

    if (
      code === settings.bindings.menu1 ||
      code === settings.bindings.menu2
    ) {
      e.preventDefault();
      menu.toggle();
      keys.clear();
      return;
    }

    if (menu.isOpen()) return;

    if (state.runState === "failed") {
      if (code === "Enter") {
        e.preventDefault();
        restartRun();
      }
      return;
    }

    keys.add(code);
    if (isBoundKey(code)) e.preventDefault();
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(normalizeCode(e.code));
  });
  window.addEventListener("blur", () => keys.clear());

  canvas.addEventListener("click", (e) => {
    audio.init();
    if (menu.isOpen()) return;
    if (state.runState !== "failed") return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (hitBounds(tryAgainBounds, x, y)) {
      restartRun();
    }
  });

  // ------- player + dash -------

  function tryStartDash() {
    if (player.dashTime > 0 || player.cooldown > 0) return;
    const input = inputDirection(keys, settings.bindings);
    let dx: number;
    let dy: number;
    if (input.x !== 0 || input.y !== 0) {
      dx = input.x;
      dy = input.y;
    } else {
      const speed = Math.hypot(player.vx, player.vy);
      if (speed > 1) {
        dx = player.vx / speed;
        dy = player.vy / speed;
      } else {
        dx = player.facingX;
        dy = player.facingY;
      }
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    player.dashDirX = dx;
    player.dashDirY = dy;
    player.dashTime = settings.dash.durationMs / 1000;
    player.dashIframeTime = settings.dash.iframesMs / 1000;
    const v = dashSpeed(settings.dash.distance, settings.dash.durationMs);
    player.vx = dx * v;
    player.vy = dy * v;
    state.dashId++;
    audio.play.dash();
  }

  function abortDash() {
    if (player.dashTime <= 0) return;
    player.dashTime = 0;
    player.dashIframeTime = 0;
    player.cooldown = settings.dash.cooldownMs / 1000;
    player.vx *= 0.35;
    player.vy *= 0.35;
  }

  function spawnTrailParticles(speed: number, isDash: boolean) {
    const dirX = speed > 0 ? -player.vx / speed : 0;
    const dirY = speed > 0 ? -player.vy / speed : 0;
    const perpX = -dirY;
    const perpY = dirX;

    let color: string;
    if (player.dashTime > 0 || player.dashIframeTime > 0) {
      color = settings.player.colorDash;
    } else if (keys.has(settings.bindings.walk)) {
      color = settings.player.colorWalk;
    } else {
      color = settings.player.colorIdle;
    }

    const speedMul = isDash ? PARTICLE_DASH_SPEED_MULTIPLIER : 1;
    const baseMin = PARTICLE_BASE_SPEED_MIN * speedMul;
    const baseRange =
      (PARTICLE_BASE_SPEED_MAX - PARTICLE_BASE_SPEED_MIN) * speedMul;
    const lateralMag = PARTICLE_LATERAL_JITTER * speedMul;
    const count = isDash
      ? 2 + Math.floor(Math.random() * 2)
      : 1 + Math.floor(Math.random() * 2);
    const lifetime = PARTICLE_LIFETIME_MS / 1000;

    for (let i = 0; i < count; i++) {
      const back = baseMin + Math.random() * baseRange;
      const lateral = (Math.random() * 2 - 1) * lateralMag;
      const upDrift = -(20 + Math.random() * 30);
      const vx = dirX * back + perpX * lateral;
      const vy = dirY * back + perpY * lateral + upDrift;
      const sizeFactor =
        PARTICLE_SIZE_MIN_FACTOR +
        Math.random() *
          (PARTICLE_SIZE_MAX_FACTOR - PARTICLE_SIZE_MIN_FACTOR);
      particles.push({
        x: player.x,
        y: player.y,
        vx,
        vy,
        initialSize: settings.player.size * sizeFactor,
        color,
        age: 0,
        lifetime,
        glowStrong: isDash ? 15 : 8,
        glowSoft: isDash ? 6 : 3,
        drag: PARTICLE_DRAG,
      });
    }
  }

  function takeHit() {
    if (state.runState !== "playing") return;
    if (state.hitIframe > 0) return;
    if (player.dashIframeTime > 0) return;
    audio.play.hit();
    state.hp -= 1;
    state.hitIframe = HIT_IFRAME;
    state.hitVignette = HIT_VIGNETTE;
    eyeOnHit(player);
    if (state.hp <= 0) failRun();
  }

  function failRun() {
    if (state.runState === "failed") return;
    state.runState = "failed";
    eyeStartClosing(player);
    audio.play.runEnd();
    const prev = Number.parseFloat(
      localStorage.getItem(ROOMS_BEST_KEY) ?? "0",
    );
    const prevBest = Number.isFinite(prev) && prev > 0 ? prev : null;
    let newBest = false;
    if (state.score > (prevBest ?? 0)) {
      localStorage.setItem(ROOMS_BEST_KEY, String(state.score));
      newBest = true;
    }
    state.failedSnapshot = {
      score: state.score,
      bestScore: newBest ? state.score : prevBest,
      newBest,
    };
  }

  function destroyEnemy(enemy: Enemy) {
    state.score += TURRET_KILL_SCORE;
    audio.play.bulletBreak();
    addFloatingText(floatingTexts, `+${TURRET_KILL_SCORE}`, enemy.x, enemy.y - 18, {
      size: 22,
      color: PALETTE.playerDash,
      lifetime: 0.7,
    });
    addRing(rings, enemy.x, enemy.y, {
      startR: 8,
      endR: 120,
      color: PALETTE.playerDash,
      lifetime: 0.4,
    });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 250 + Math.random() * 150;
      particles.push({
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        initialSize: 4,
        color: PALETTE.playerDash,
        age: 0,
        lifetime: 0.8,
        glowStrong: 14,
        glowSoft: 5,
        drag: 0.96,
      });
    }
    console.log("Turret destroyed");
  }

  function aliveEnemies(): Enemy[] {
    return currentRoom.enemies.filter((e) => !e.isDead());
  }

  function checkRoomCleared() {
    if (state.clearedRoomIds.has(currentRoom.id)) return;
    if (currentRoom.enemies.length === 0) return; // empty rooms (room2) — skip
    if (aliveEnemies().length > 0) return;
    state.clearedRoomIds.add(currentRoom.id);
    state.clearFlash = ROOM_CLEAR_FLASH;
    if (currentRoom.door) currentRoom.door.state = "open";
    audio.play.multUp(5); // placeholder sting
  }

  // ------- frame loop -------

  let lastTime = performance.now();

  function frame(now: number) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (menu.isOpen()) {
      render();
      requestAnimationFrame(frame);
      return;
    }

    // age FX always so they finish out even after fail
    for (const t of floatingTexts) {
      t.age += dt;
      t.y += t.vy * dt;
    }
    floatingTexts = floatingTexts.filter((t) => t.age < t.lifetime);
    for (const r of rings) r.age += dt;
    rings = rings.filter((r) => r.age < r.lifetime);
    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.drag !== 1) {
        const k = Math.pow(p.drag, dt * 60);
        p.vx *= k;
        p.vy *= k;
      }
    }
    particles = particles.filter((p) => p.age < p.lifetime);

    if (state.clearFlash > 0) {
      state.clearFlash = Math.max(0, state.clearFlash - dt);
    }

    if (currentRoom.door && currentRoom.door.state === "open") {
      currentRoom.door.pulse += dt;
    }

    if (state.runState === "failed") {
      if (state.hitVignette > 0) {
        state.hitVignette = Math.max(0, state.hitVignette - dt);
      }
      // keep the eye animation alive (closing, blink decay) while overlay is up
      updateEye(player, dt, {
        threat: null,
        size: settings.player.size,
        dashDurationSec: settings.dash.durationMs / 1000,
      });
      render();
      requestAnimationFrame(frame);
      return;
    }

    // -------- running --------

    if (keys.has(settings.bindings.dash)) {
      tryStartDash();
      keys.delete(settings.bindings.dash);
    }

    if (player.dashTime > 0) {
      player.dashTime -= dt;
      const v = dashSpeed(settings.dash.distance, settings.dash.durationMs);
      player.vx = player.dashDirX * v;
      player.vy = player.dashDirY * v;
      if (player.dashTime <= 0) {
        player.dashTime = 0;
        player.cooldown = settings.dash.cooldownMs / 1000;
        player.vx *= 0.35;
        player.vy *= 0.35;
      }
    } else {
      const input = inputDirection(keys, settings.bindings);
      if (input.x !== 0 || input.y !== 0) {
        player.facingX = input.x;
        player.facingY = input.y;
      }
      const accel = settings.player.maxSpeed * ACCEL_FACTOR;
      player.vx += input.x * accel * dt;
      player.vy += input.y * accel * dt;
      const damp = Math.exp(-FRICTION * dt);
      player.vx *= damp;
      player.vy *= damp;
      const cap = keys.has(settings.bindings.walk)
        ? settings.player.maxSpeed * settings.player.walkFactor
        : settings.player.maxSpeed;
      const sp = Math.hypot(player.vx, player.vy);
      if (sp > cap) {
        const k = cap / sp;
        player.vx *= k;
        player.vy *= k;
      }
    }

    if (player.dashIframeTime > 0)
      player.dashIframeTime = Math.max(0, player.dashIframeTime - dt);
    if (player.cooldown > 0)
      player.cooldown = Math.max(0, player.cooldown - dt);
    if (state.hitIframe > 0)
      state.hitIframe = Math.max(0, state.hitIframe - dt);
    if (state.hitVignette > 0)
      state.hitVignette = Math.max(0, state.hitVignette - dt);

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const half = settings.player.size / 2;
    const wasDashing = player.dashTime > 0;
    const collisionResult = resolvePlayerWallCollisions(
      player,
      currentRoom.walls,
      half,
    );
    if (
      wasDashing &&
      (collisionResult.stoppedX || collisionResult.stoppedY)
    ) {
      abortDash();
    }

    // also clamp by the closed door (acts like a wall)
    if (currentRoom.door && currentRoom.door.state === "closed") {
      const d = currentRoom.door;
      const doorWall = {
        x: d.x - d.w / 2,
        y: d.y - d.h / 2,
        w: d.w,
        h: d.h,
      };
      const r2 = resolvePlayerWallCollisions(player, [doorWall], half);
      if (wasDashing && (r2.stoppedX || r2.stoppedY)) abortDash();
    }

    // trail particle spawn
    {
      const speed = Math.hypot(player.vx, player.vy);
      const isDash = player.dashTime > 0;
      if (!isDash && speed < PARTICLE_TRAIL_MIN_SPEED) {
        state.particleSpawnTimer = 0;
      } else {
        const intervalMs = isDash
          ? PARTICLE_DASH_SPAWN_INTERVAL_MS
          : PARTICLE_SPAWN_INTERVAL_MS;
        const interval = intervalMs / 1000;
        state.particleSpawnTimer += dt;
        while (state.particleSpawnTimer >= interval) {
          state.particleSpawnTimer -= interval;
          spawnTrailParticles(speed, isDash);
        }
      }
    }

    // enemies update
    const enemyCtx = {
      dt,
      player,
      bullets,
      particles,
      rings,
      floatingTexts,
      bulletsConfig: {
        speed: settings.bullets.speed,
        size: settings.bullets.size,
        color: settings.bullets.color,
      },
    };
    for (const e of currentRoom.enemies) e.update(enemyCtx);

    // bullet movement + wall expiry (no bouncing in rooms)
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      pushTrailSample(b);
    }
    bullets = bullets.filter((b) => {
      if (b.x < -40 || b.x > ROOM_W_PX + 40) return false;
      if (b.y < -40 || b.y > ROOM_H_PX + 40) return false;
      if (bulletInsideWall(b.x, b.y, currentRoom.walls)) return false;
      return true;
    });

    // bullet vs player (no scoring, just damage)
    if (state.hitIframe <= 0 && player.dashIframeTime <= 0) {
      const ph = settings.player.size / 2;
      const bh = settings.bullets.size / 2;
      for (const b of bullets) {
        if (
          Math.abs(b.x - player.x) < ph + bh &&
          Math.abs(b.y - player.y) < ph + bh
        ) {
          takeHit();
          break;
        }
      }
    }

    // dash damage to enemies
    if (player.dashIframeTime > 0) {
      for (const e of currentRoom.enemies) {
        const wasDead = e.isDead();
        const hit = e.tryDashDamage(state.dashId, player.x, player.y, half);
        if (hit && !wasDead && e.isDead()) destroyEnemy(e);
      }
    }

    // contact damage from un-dashed enemies
    if (state.hitIframe <= 0 && player.dashIframeTime <= 0) {
      for (const e of currentRoom.enemies) {
        if (e.overlapsPlayer(player.x, player.y, half)) {
          takeHit();
          break;
        }
      }
    }

    checkRoomCleared();

    // eye state: pupil tracks the closest threat in the room, dash ghosts
    // also spawn here while dashing
    updateEye(player, dt, {
      threat: findNearestThreat(
        player.x,
        player.y,
        bullets,
        currentRoom.enemies,
      ),
      size: settings.player.size,
      dashDurationSec: settings.dash.durationMs / 1000,
    });

    // door overlap → transition
    if (
      currentRoom.door &&
      currentRoom.door.state === "open" &&
      currentRoom.nextRoomId &&
      playerOverlapsDoor(currentRoom.door, player.x, player.y, half)
    ) {
      transitionToRoom(currentRoom.nextRoomId);
    }

    render();
    requestAnimationFrame(frame);
  }

  // ------- render -------

  function render() {
    // letterbox: clear in CSS pixels, then transform into room space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);

    // room background (slightly lighter so the play field stands apart
    // from letterbox bars)
    ctx.fillStyle = "#0d1326";
    ctx.fillRect(0, 0, ROOM_W_PX, ROOM_H_PX);

    drawWalls(ctx, currentRoom.walls);
    if (currentRoom.door) drawDoor(ctx, currentRoom.door);

    // enemies
    for (const e of currentRoom.enemies) e.draw(ctx);

    // bullets (trail then live)
    const bSize = settings.bullets.size;
    const bColor = settings.bullets.color;
    for (const b of bullets) {
      if (b.trailCount > 0) {
        const start = b.trailCount === 5 ? b.trailIdx : 0;
        for (let i = 0; i < b.trailCount; i++) {
          const j = (start + i) % 5;
          const t = b.trailCount === 1 ? 1 : i / (b.trailCount - 1);
          const sz = bSize * (0.5 + 0.5 * t);
          const alpha = 0.1 + 0.4 * t;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = bColor;
          ctx.fillRect(b.trailX[j] - sz / 2, b.trailY[j] - sz / 2, sz, sz);
          ctx.restore();
        }
      }
      drawNeon(
        ctx,
        () => {
          ctx.fillStyle = bColor;
          ctx.fillRect(b.x - bSize / 2, b.y - bSize / 2, bSize, bSize);
        },
        bColor,
        20,
        8,
      );
    }

    // particles
    const useNeon = particles.length < 50;
    for (const p of particles) {
      const t = p.age / p.lifetime;
      const alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
      const sz = Math.max(0.5, p.initialSize * (1 - t));
      ctx.save();
      ctx.globalAlpha = alpha;
      if (useNeon) {
        drawNeon(
          ctx,
          () => {
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
          },
          p.color,
          p.glowStrong,
          p.glowSoft,
        );
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      ctx.restore();
    }

    // player
    const pSize = settings.player.size;
    const dashing = player.dashTime > 0;
    const dashIframe = player.dashIframeTime > 0;
    const walking = keys.has(settings.bindings.walk);

    let drawPlayer = true;
    if (state.hitIframe > 0) {
      drawPlayer = Math.floor(state.hitIframe * 10) % 2 === 0;
    }

    if (drawPlayer) {
      let ringColor: string;
      if (dashing || dashIframe) ringColor = settings.player.colorDash;
      else if (walking) ringColor = settings.player.colorWalk;
      else ringColor = settings.player.colorIdle;
      const pupilColor =
        dashing || dashIframe ? settings.player.colorDash : "#ffffff";
      drawPlayerEye(ctx, player, pSize, {
        ringColor,
        glowColor: ringColor,
        pupilColor,
        ghostColor: profile.dashColor,
        dashDurationSec: settings.dash.durationMs / 1000,
        profile,
      });
    }

    // rings
    for (const ring of rings) {
      const t = ring.age / ring.lifetime;
      const r = ring.startR + (ring.endR - ring.startR) * t;
      const alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // floating texts
    for (const ft of floatingTexts) {
      const alpha = 1 - ft.age / ft.lifetime;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `600 ${ft.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      drawNeon(
        ctx,
        () => {
          ctx.fillStyle = ft.color;
          ctx.fillText(ft.text, ft.x, ft.y);
        },
        ft.color,
        15,
        4,
      );
      ctx.restore();
    }

    // room placeholder text
    if (currentRoom.message) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      drawNeon(
        ctx,
        () => {
          ctx.fillStyle = PALETTE.playerDash;
          ctx.font = "500 28px system-ui, -apple-system, sans-serif";
          ctx.fillText(currentRoom.message!, ROOM_W_PX / 2, ROOM_H_PX / 2);
        },
        PALETTE.playerDash,
        20,
        7,
      );
      ctx.restore();
    }

    // back to CSS pixels for full-screen overlays + HUD
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // hit vignette
    if (state.hitVignette > 0) {
      const t = state.hitVignette / HIT_VIGNETTE;
      const grad = ctx.createRadialGradient(
        viewW / 2,
        viewH / 2,
        Math.min(viewW, viewH) * 0.25,
        viewW / 2,
        viewH / 2,
        Math.max(viewW, viewH) * 0.65,
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(60,0,0,${0.7 * t})`);
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    // ambient corner vignette
    {
      const grad = ctx.createRadialGradient(
        viewW / 2,
        viewH / 2,
        Math.min(viewW, viewH) * 0.3,
        viewW / 2,
        viewH / 2,
        Math.max(viewW, viewH) * 0.7,
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    // room-cleared flash
    if (state.clearFlash > 0) {
      const a = (state.clearFlash / ROOM_CLEAR_FLASH) * 0.15;
      ctx.save();
      ctx.fillStyle = PALETTE.pickupHP;
      ctx.globalAlpha = a;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    drawHUD();

    if (state.runState === "failed") drawFailedOverlay();
  }

  function drawHUD() {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const cx = viewW / 2;
    const colA = cx - 100;
    const colB = cx + 100;
    const y0 = 18;

    ctx.font = "500 11px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#7d8590";
    ctx.fillText("ROOM", colA, y0);
    ctx.fillText("ENEMIES", colB, y0);

    ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#ffffff";
    const roomNum = currentRoom.id === "room1" ? 1 : currentRoom.id === "room2" ? 2 : 1;
    ctx.fillText(`${roomNum} / ${ROOM_TOTAL}`, colA, y0 + 14);

    const alive = aliveEnemies().length;
    if (alive > 0) {
      ctx.fillText(`${alive}`, colB, y0 + 14);
    } else {
      ctx.fillStyle = PALETTE.pickupHP;
      ctx.font = "600 18px system-ui, -apple-system, sans-serif";
      ctx.fillText("CLEARED", colB, y0 + 16);
    }

    const y1 = y0 + 50;
    ctx.font = "500 11px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#7d8590";
    ctx.fillText("HP", colA, y1);
    ctx.fillText("SCORE", colB, y1);

    // hearts row
    ctx.font = "600 22px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    const heartsY = y1 + 14;
    const heartSpacing = 22;
    const heartsStart = colA - heartSpacing;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < state.hp ? "#ef4444" : "rgba(239,68,68,0.18)";
      ctx.fillText("♥", heartsStart + i * heartSpacing, heartsY);
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(state.score.toLocaleString("en-US"), colB, heartsY);

    ctx.restore();
  }

  function drawFailedOverlay() {
    const snap = state.failedSnapshot;
    if (!snap) return;
    const w = 460;
    const h = 280;
    const x = Math.round((viewW - w) / 2);
    const y = Math.round((viewH - h) / 2 - 30);

    ctx.save();
    ctx.fillStyle = "rgba(15,15,18,0.95)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    ctx.fillStyle = "#ff8b8b";
    ctx.font = "600 14px system-ui, -apple-system, sans-serif";
    ctx.fillText("RUN FAILED", x + w / 2, y + 22);

    ctx.fillStyle = "#7d8590";
    ctx.font = "500 11px system-ui, -apple-system, sans-serif";
    ctx.fillText("SCORE", x + w / 2, y + 50);

    ctx.fillStyle = "#ffffff";
    ctx.font = "600 48px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(snap.score.toLocaleString("en-US"), x + w / 2, y + 70);

    if (snap.bestScore != null) {
      ctx.fillStyle = snap.newBest ? "#facc15" : "#cccccc";
      ctx.font = "500 13px system-ui, -apple-system, sans-serif";
      ctx.fillText(
        snap.newBest
          ? `New best: ${snap.bestScore.toLocaleString("en-US")}`
          : `Best: ${snap.bestScore.toLocaleString("en-US")}`,
        x + w / 2,
        y + 142,
      );
    }

    const btnW = 200;
    const btnH = 44;
    const btnX = x + (w - btnW) / 2;
    const btnY = y + h - 76;
    tryAgainBounds = { x: btnX, y: btnY, w: btnW, h: btnH };

    ctx.fillStyle = "rgba(0,229,255,0.18)";
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.strokeStyle = "rgba(0,229,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(btnX + 0.5, btnY + 0.5, btnW - 1, btnH - 1);

    ctx.fillStyle = "#22d3ee";
    ctx.font = "600 13px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("TRY AGAIN ↵", btnX + btnW / 2, btnY + btnH / 2);

    ctx.restore();
  }

  requestAnimationFrame((t) => {
    lastTime = t;
    requestAnimationFrame(frame);
  });
}
