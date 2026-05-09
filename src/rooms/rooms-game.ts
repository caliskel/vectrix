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
  type Settings,
} from "../lib/config";
import { drawDoor, playerOverlapsDoor } from "../lib/door";
import type { Enemy, Laser } from "../lib/enemies/types";
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
import { createPauseMenu } from "./pause-menu";
import { type Bounds, hitBounds } from "../lib/types";
import {
  bulletInsideWall,
  drawWalls,
  resolvePlayerWallCollisions,
  type Wall,
} from "../lib/walls";
import { buildRoom1, ROOM_H_PX, ROOM_W_PX } from "./room1";
import { buildRoom2 } from "./room2";
import { buildRoom3 } from "./room3";
import type { Room } from "./room";

const ACCEL_FACTOR = 9;
const FRICTION = 8.0;
const HIT_IFRAME = 1.0;
const HIT_VIGNETTE = 0.2;
const TURRET_KILL_SCORE = 500;
const WATCHER_KILL_SCORE = 800;
const LASER_DODGE_SCORE = 50;
const LASER_HIT_PADDING = 6; // px added to player half for laser collision
const SCREEN_SHAKE_DURATION_SEC = 0.2;
const SCREEN_SHAKE_PX = 4;
const ROOM_TOTAL = 3;
const ROOM_CLEAR_FLASH = 0.2;
const ROOMS_BEST_KEY = "dash-proto:rooms-best";

function pointSegmentDistanceSq(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - x1;
    const ey = py - y1;
    return ex * ex + ey * ey;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

const LASER_CHEVRON_SPACING_PX = 220; // density-based; one chevron per N px
const LASER_CHEVRON_SPEED = 200; // px/s along the beam
const LASER_CHEVRON_SIZE = 7;
const LASER_IMPACT_RADIUS = 8;
const LASER_RAYCAST_FALLBACK = 4000; // far enough to leave any plausible room

// Cast a ray from (ox, oy) along `angle` and return the first wall AABB
// intersection. Each wall contributes the standard slab-test t-interval;
// the laser stops at the smallest positive t. Watcher always lives
// inside the walled room so a hit is guaranteed in practice; the
// fallback keeps the math defined if a ray ever escapes.
function raycastWalls(
  ox: number,
  oy: number,
  angle: number,
  walls: Wall[],
): { x: number; y: number } {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  let bestT = Infinity;
  for (const w of walls) {
    const x1 = w.x;
    const x2 = w.x + w.w;
    const y1 = w.y;
    const y2 = w.y + w.h;

    let txMin: number;
    let txMax: number;
    if (Math.abs(cosA) < 1e-9) {
      if (ox < x1 || ox > x2) continue;
      txMin = -Infinity;
      txMax = Infinity;
    } else {
      const tA = (x1 - ox) / cosA;
      const tB = (x2 - ox) / cosA;
      txMin = Math.min(tA, tB);
      txMax = Math.max(tA, tB);
    }

    let tyMin: number;
    let tyMax: number;
    if (Math.abs(sinA) < 1e-9) {
      if (oy < y1 || oy > y2) continue;
      tyMin = -Infinity;
      tyMax = Infinity;
    } else {
      const tA = (y1 - oy) / sinA;
      const tB = (y2 - oy) / sinA;
      tyMin = Math.min(tA, tB);
      tyMax = Math.max(tA, tB);
    }

    const tEnter = Math.max(txMin, tyMin);
    const tExit = Math.min(txMax, tyMax);
    if (tEnter > tExit) continue;
    if (tExit < 1e-6) continue;
    // origin can be just inside a wall (Watcher near a wall); pick the
    // exit if entry is non-positive
    const t = tEnter > 1e-6 ? tEnter : tExit;
    if (t < bestT) bestT = t;
  }
  if (!isFinite(bestT)) bestT = LASER_RAYCAST_FALLBACK;
  return { x: ox + cosA * bestT, y: oy + sinA * bestT };
}

function refreshLaserEndpoints(lasers: Laser[], walls: Wall[]): void {
  for (const l of lasers) {
    const hit = raycastWalls(
      l.ownerEnemy.x,
      l.ownerEnemy.y,
      l.aimAngle,
      walls,
    );
    l.endX = hit.x;
    l.endY = hit.y;
  }
}

function drawLaser(ctx: CanvasRenderingContext2D, l: Laser): void {
  const charging = l.age < l.chargingDuration;
  // Origin tracks the owner each frame so a moving Watcher's beam stays
  // rooted in the eye; end is fixed at aim time.
  const startX = l.ownerEnemy.x;
  const startY = l.ownerEnemy.y;
  const dx = l.endX - startX;
  const dy = l.endY - startY;
  const lineLen = Math.hypot(dx, dy);
  if (lineLen <= 0) return;
  const dirX = dx / lineLen;
  const dirY = dy / lineLen;
  const perpX = -dirY;
  const perpY = dirX;

  ctx.save();
  if (charging) {
    const p = l.age / l.chargingDuration;
    const baseAlpha = 0.15 + (0.7 - 0.15) * p;
    const flicker = Math.sin(l.age * 15) * 0.1;
    ctx.globalAlpha = Math.max(0, Math.min(1, baseAlpha + flicker));
    ctx.strokeStyle = PALETTE.bullet;
    ctx.lineWidth = 1 + 3 * p;
    ctx.shadowColor = PALETTE.bullet;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(l.endX, l.endY);
    ctx.stroke();

    // chevrons sliding along the beam — tells the player the attack is
    // loading rather than a static red line. Density-based count so a
    // long arena-spanning beam still feels populated.
    const chevronCount = Math.max(2, Math.round(lineLen / LASER_CHEVRON_SPACING_PX));
    const spacing = lineLen / chevronCount;
    const advance = (l.age * LASER_CHEVRON_SPEED) % spacing;
    ctx.fillStyle = PALETTE.bullet;
    ctx.globalAlpha = Math.max(0, Math.min(1, 0.6 + flicker * 0.5));
    for (let i = 0; i < chevronCount; i++) {
      const distAlong = i * spacing + advance;
      if (distAlong >= lineLen) continue;
      const cx = startX + dirX * distAlong;
      const cy = startY + dirY * distAlong;
      const tipX = cx + dirX * LASER_CHEVRON_SIZE;
      const tipY = cy + dirY * LASER_CHEVRON_SIZE;
      const baseLeftX =
        cx - dirX * LASER_CHEVRON_SIZE + perpX * LASER_CHEVRON_SIZE * 0.55;
      const baseLeftY =
        cy - dirY * LASER_CHEVRON_SIZE + perpY * LASER_CHEVRON_SIZE * 0.55;
      const baseRightX =
        cx - dirX * LASER_CHEVRON_SIZE - perpX * LASER_CHEVRON_SIZE * 0.55;
      const baseRightY =
        cy - dirY * LASER_CHEVRON_SIZE - perpY * LASER_CHEVRON_SIZE * 0.55;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(baseLeftX, baseLeftY);
      ctx.lineTo(baseRightX, baseRightY);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // firing — full bright beam with a hot white core
    ctx.shadowColor = PALETTE.bullet;
    ctx.shadowBlur = 35;
    ctx.strokeStyle = PALETTE.bullet;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(l.endX, l.endY);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(l.endX, l.endY);
    ctx.stroke();

    // impact glow at the wall hit point — sells the beam as a real ray
    const pulse = 0.55 + Math.sin(l.age * 30) * 0.15;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.bullet;
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.arc(l.endX, l.endY, LASER_IMPACT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

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
  screenShake: number; // counts down for laser-hit shake
  failedSnapshot: FailedSnapshot | null;
};

export function start(canvas: HTMLCanvasElement): void {
  const rawCtx = canvas.getContext("2d");
  if (!rawCtx) return;
  const ctx: CanvasRenderingContext2D = rawCtx;

  const settings: Settings = loadSettings();

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
  let lasers: Laser[] = [];

  const rooms = new Map<string, Room>();
  rooms.set("room1", buildRoom1());
  rooms.set("room2", buildRoom2());
  rooms.set("room3", buildRoom3());

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
    screenShake: 0,
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
    rooms.set("room3", buildRoom3());
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
    state.screenShake = 0;
    state.failedSnapshot = null;
    bullets = [];
    particles = [];
    rings = [];
    floatingTexts = [];
    lasers = [];
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
    lasers = [];
    spawnPlayerInCurrentRoom();
  }

  // ------- input / menu -------

  const keys = new Set<string>();
  // Rooms uses a pause menu instead of the settings overlay. Settings live
  // in the sandbox build only — see the Settings only available in Sandbox
  // mode footer in the pause panel.
  const menu = createPauseMenu({
    onResume: () => {
      // dt is recomputed each frame from lastTime; setting it to "now"
      // prevents a deltaTime jump after a long pause
      lastTime = performance.now();
    },
    onRestart: () => {
      restartRun();
      lastTime = performance.now();
    },
    onQuit: () => {
      window.location.href = "/";
    },
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

    // Pause menu has no key-rebinding capture flow (settings live in
    // sandbox), so we go straight to the toggle test.
    if (
      code === settings.bindings.menu1 ||
      code === settings.bindings.menu2
    ) {
      e.preventDefault();
      menu.toggle();
      if (!menu.isOpen()) lastTime = performance.now();
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
      // dash sparks pull from the player's profile (the only customization
      // path that actually changes during dash); idle/walk stay on settings.
      color = profile.dashParticles;
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
    audio.play.bulletBreak();
    if (enemy.type === "watcher") {
      state.score += WATCHER_KILL_SCORE;
      addFloatingText(
        floatingTexts,
        `+${WATCHER_KILL_SCORE}`,
        enemy.x,
        enemy.y - 18,
        {
          size: 24,
          color: PALETTE.bullet,
          lifetime: 0.7,
        },
      );
      // double ring — outer red, inner white
      addRing(rings, enemy.x, enemy.y, {
        startR: 8,
        endR: 120,
        color: PALETTE.bullet,
        lifetime: 0.4,
      });
      addRing(rings, enemy.x, enemy.y, {
        startR: 6,
        endR: 100,
        color: "#ffffff",
        lifetime: 0.45,
      });
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 200 + Math.random() * 150;
        const isRed = i % 2 === 0;
        particles.push({
          x: enemy.x,
          y: enemy.y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          initialSize: 4,
          color: isRed ? PALETTE.bullet : "#ffffff",
          age: 0,
          lifetime: 0.7,
          glowStrong: 12,
          glowSoft: 4,
          drag: 0.96,
        });
      }
      console.log("Watcher destroyed");
    } else {
      state.score += TURRET_KILL_SCORE;
      addFloatingText(
        floatingTexts,
        `+${TURRET_KILL_SCORE}`,
        enemy.x,
        enemy.y - 18,
        {
          size: 22,
          color: PALETTE.playerDash,
          lifetime: 0.7,
        },
      );
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
    if (state.screenShake > 0)
      state.screenShake = Math.max(0, state.screenShake - dt);

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
      lasers,
      bulletsConfig: {
        speed: settings.bullets.speed,
        size: settings.bullets.size,
        color: settings.bullets.color,
      },
      playerHalfSize: settings.player.size / 2,
      playerMaxSpeed: settings.player.maxSpeed,
    };
    for (const e of currentRoom.enemies) e.update(enemyCtx);

    // age + cull lasers (self-expire by total duration)
    for (const l of lasers) l.age += dt;
    lasers = lasers.filter(
      (l) => l.age < l.chargingDuration + l.firingDuration,
    );

    // recompute laser endpoints from current owner position + fixed
    // aimAngle, hitting the first wall along the ray. Has to run after
    // enemy update (owner may have moved) and before hit detection +
    // render (both consume endX/endY).
    refreshLaserEndpoints(lasers, currentRoom.walls);

    // player vs lasers (only the firing window)
    if (state.runState === "playing") {
      const halfPlus = settings.player.size / 2 + LASER_HIT_PADDING;
      const halfPlus2 = halfPlus * halfPlus;
      for (const l of lasers) {
        if (l.age < l.chargingDuration) continue;
        if (l.age >= l.chargingDuration + l.firingDuration) continue;
        const d2 = pointSegmentDistanceSq(
          player.x,
          player.y,
          l.ownerEnemy.x,
          l.ownerEnemy.y,
          l.endX,
          l.endY,
        );
        if (d2 >= halfPlus2) continue;
        if (player.dashIframeTime > 0) {
          // dashed through the beam — credit a one-time dodge bonus per
          // laser, no damage
          if (l.dodgedByDashId !== state.dashId) {
            l.dodgedByDashId = state.dashId;
            state.score += LASER_DODGE_SCORE;
            addFloatingText(
              floatingTexts,
              `+${LASER_DODGE_SCORE}`,
              player.x,
              player.y - settings.player.size,
              {
                size: 16,
                color: "#facc15",
                lifetime: 0.5,
              },
            );
          }
        } else if (state.hitIframe > 0) {
          // already in post-hit i-frame, ignore
        } else {
          state.screenShake = SCREEN_SHAKE_DURATION_SEC;
          takeHit();
          break;
        }
      }
    }

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

    // screen shake — applied to the room transform only so HUD stays put
    let shakeX = 0;
    let shakeY = 0;
    if (state.screenShake > 0) {
      const t = state.screenShake / SCREEN_SHAKE_DURATION_SEC;
      shakeX = (Math.random() * 2 - 1) * SCREEN_SHAKE_PX * t;
      shakeY = (Math.random() * 2 - 1) * SCREEN_SHAKE_PX * t;
    }
    ctx.setTransform(
      scale * dpr,
      0,
      0,
      scale * dpr,
      (offsetX + shakeX) * dpr,
      (offsetY + shakeY) * dpr,
    );

    // room background (slightly lighter so the play field stands apart
    // from letterbox bars)
    ctx.fillStyle = "#0d1326";
    ctx.fillRect(0, 0, ROOM_W_PX, ROOM_H_PX);

    drawWalls(ctx, currentRoom.walls);
    if (currentRoom.door) drawDoor(ctx, currentRoom.door);

    // lasers (under enemies so the beam appears to emerge from behind)
    for (const l of lasers) drawLaser(ctx, l);

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
        ghostColor: settings.player.colorDash,
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
    const roomNum =
      currentRoom.id === "room1"
        ? 1
        : currentRoom.id === "room2"
          ? 2
          : currentRoom.id === "room3"
            ? 3
            : 1;
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
