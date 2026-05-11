import { audio } from "../lib/audio";
import { createDevMenu, type DevMenu } from "../lib/dev-menu";
import { drawFpsOverlay, recordFrame } from "../lib/fps-meter";
import {
  drawGodModeBadge,
  isGodMode,
  setGodMode,
} from "../lib/god-mode";
import { type Bullet, pushTrailSample } from "../lib/bullets";
import {
  getBulletSprite,
  getBulletSpriteOffset,
} from "../lib/bullet-sprite";
import {
  createCamera,
  snapCamera,
  updateCamera,
  type Camera,
  type WorldBounds,
} from "../lib/camera";
import {
  checkKeyPickup,
  createKey,
  drawKey,
  drawKeyHudIcon,
  type Key,
  updateKey,
} from "../lib/keys";
import {
  DASH_COOLDOWN_MS,
  DASH_DISTANCE,
  DASH_DURATION_MS,
  DASH_IFRAMES_MS,
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
  PLAYER_MAX_SPEED,
  PLAYER_SIZE,
  PLAYER_WALK_FACTOR,
  loadSettings,
  type Settings,
} from "../lib/config";
import { drawDoor, playerOverlapsDoor } from "../lib/door";
import {
  consumeAction,
  isActionPressed,
  isAnyBoundCode,
  loadKeybinds,
  type KeybindProfile,
} from "../lib/keybinds";
import {
  drawEnemyDetection,
  updateEnemyAwareness,
} from "../lib/enemies/awareness";
import {
  Sentinel,
  type SentinelState,
  SENTINEL_HP_MAX_EXPORT as SENTINEL_HP_MAX,
  SENTINEL_PHASE_HP_BOUNDARY_1_TO_2,
  SENTINEL_PHASE_HP_BOUNDARY_2_TO_3,
} from "../lib/enemies/sentinel";
import type { Enemy, Laser } from "../lib/enemies/types";
import {
  emitBulletHit,
  emitEnemyDamage,
  emitEnemyKill,
  type ImpactContext,
} from "../lib/impacts";
import { drawRoomGrid } from "../lib/grid";
import { drawNeon } from "../lib/neon";
import { PALETTE } from "../lib/palette";
import {
  type FloatingText,
  type Particle,
  type Ring,
  addFloatingText,
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
  triggerPlayerSmash,
  updateEye,
} from "../lib/player";
import {
  createGameCompleteMenu,
  createPauseMenu,
} from "../lib/pause-menu";
import { type Bounds, hitBounds } from "../lib/types";
import {
  bulletInsideWall,
  drawWalls,
  resolvePlayerWallCollisions,
  type Wall,
} from "../lib/walls";
import { buildRoom1 } from "./room1";
import { buildRoom2 } from "./room2";
import { buildRoom3 } from "./room3";
import { buildRoom4 } from "./room4";
import { buildRoom5 } from "./room5";
import type { Room } from "../lib/room";

// Canonical letterbox viewport (constant across all rooms; camera-
// rooms scroll a wider/taller world inside this frame).
const ROOM_W_PX = 1200;
const ROOM_H_PX = 800;

const ACCEL_FACTOR = 9;
const FRICTION = 8.0;
const HIT_IFRAME = 1.0;
const HIT_VIGNETTE = 0.2;
const TURRET_KILL_SCORE = 500;
const WATCHER_KILL_SCORE = 800;
const HUNTER_KILL_SCORE = 600;
// HP doubled (30 → 60) means the fight is ~2× as long; the kill
// reward scales 3× to compensate, since the player also has to
// keep their multiplier alive across more attacks.
const SENTINEL_KILL_SCORE = 15000;
// Boss HP bar layout — pinned to the viewport bottom with
// BOSS_HP_BAR_BOTTOM_PADDING_PX of breathing room from the edge,
// SENTINEL label sitting BOSS_HP_LABEL_GAP_PX above the bar.
const BOSS_HP_BAR_BOTTOM_PADDING_PX = 36;
const BOSS_HP_LABEL_GAP_PX = 6;
const LASER_DODGE_SCORE = 50;
const LASER_HIT_PADDING = 6; // px added to player half for laser collision
const LASER_FRIENDLY_FIRE_HALF_WIDTH = 8; // matches firing-beam visual width
const FRIENDLY_FIRE_BONUS = 200;
const SCREEN_SHAKE_DURATION_SEC = 0.2;
const SCREEN_SHAKE_PX = 4;
// Campaign currently has Room 4 (corridor) + Room 5 placeholder. The
// HUD displays them as 1 / 2 since rooms 1–3 moved to the tutorial.
const ROOM_TOTAL = 5;
const TUTORIAL_COMPLETED_KEY = "dash-proto:tutorial-completed";
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

type RunState = "playing" | "failed" | "completed";

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
  // Screen shake — variable amount/duration so different impacts can
  // shake harder. Remaining is the live countdown; Initial is the
  // full duration captured at trigger so render can fade by t.
  screenShakeRemaining: number;
  screenShakeInitial: number;
  screenShakeAmount: number;
  // Brief global white flash overlay used by HEAVY-tier impacts.
  screenFlashRemaining: number;
  screenFlashInitial: number;
  screenFlashOpacity: number;
  failedSnapshot: FailedSnapshot | null;
  /** Cumulative time the campaign run has been "playing" — paused
   *  while the Sentinel cinematic phases (intro / dying) freeze the
   *  world, and while the failed/completed overlays are up. Read by
   *  the Game Complete overlay. */
  elapsed: number;
  /** Tracked across frames so we can credit the kill score on the
   *  combat → dying transition and pop Game Complete on dying →
   *  defeated. Equals "none" while the player isn't in Room 5. */
  prevSentinelState: SentinelState | "none";
  /** Tracked across frames so the music system can crossfade to the
   *  next boss-phase track exactly when the Sentinel's bossPhase flips
   *  (HP 60 → 40 → 20 boundaries, fired inside the 2 s transition
   *  cinematic). 0 while the player isn't in Room 5. */
  prevBossPhase: 0 | 1 | 2 | 3;
};

export function start(canvas: HTMLCanvasElement): void {
  const rawCtx = canvas.getContext("2d");
  if (!rawCtx) return;
  const ctx: CanvasRenderingContext2D = rawCtx;

  // Story-mode lock — players must clear the tutorial before
  // unlocking the campaign. Render a "complete tutorial first"
  // overlay and don't start the game loop. The button takes them
  // straight to /tutorial.html.
  if (localStorage.getItem(TUTORIAL_COMPLETED_KEY) !== "true") {
    showTutorialLockOverlay(canvas, ctx);
    return;
  }

  const settings: Settings = loadSettings();
  // Keybind profile lives in its own localStorage key (set via the
  // Controls overlay on the landing page) and is shared across all
  // three modes. Re-read on the `storage` event so a rebind in
  // another tab propagates here without a reload.
  let keybinds: KeybindProfile = loadKeybinds();
  window.addEventListener("storage", () => {
    keybinds = loadKeybinds();
  });

  audio.setMasterVolume(settings.audio.master);
  audio.setSfxVolume(settings.audio.sfx);
  audio.setMusicVolume(settings.audio.music);
  // Story-mode music. Four tracks: "rooms" plays through rooms 1–4,
  // then crossfades to the three boss-phase tracks as the Sentinel's
  // bossPhase advances. Files live in public/audio/ (Vite serves
  // /audio/ from there). Load is deferred until audio.init() fires on
  // the first user gesture (the keydown / click handlers below);
  // crossfades are kicked from reconcileBossMusic().
  audio.setMusicTrack("rooms", encodeURI("/audio/Glass Under Ice.mp3"));
  audio.setMusicTrack("boss-1", "/audio/boss-phase-1.mp3");
  audio.setMusicTrack("boss-2", "/audio/boss-phase-2.mp3");
  audio.setMusicTrack("boss-3", "/audio/boss-phase-3.mp3");

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
  // Per-run key state. Camera is created once and snapped to each
  // room's bounds on entry. currentKey lives at the kill site of the
  // enemy flagged dropsKey; keyHeld flips when the player walks over
  // it. Both reset per room transition.
  const camera: Camera = createCamera();
  let currentKey: Key | null = null;
  let keyHeld = false;

  const rooms = new Map<string, Room>();
  rooms.set("room1", buildRoom1());
  rooms.set("room2", buildRoom2());
  rooms.set("room3", buildRoom3());
  rooms.set("room4", buildRoom4());
  rooms.set("room5", buildRoom5());

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
    screenShakeRemaining: 0,
    screenShakeInitial: 0,
    screenShakeAmount: 0,
    screenFlashRemaining: 0,
    screenFlashInitial: 0,
    screenFlashOpacity: 0,
    failedSnapshot: null,
    elapsed: 0,
    prevSentinelState: "none",
    prevBossPhase: 0,
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

  function applyInitialKey() {
    // Pre-placed key on the floor (Room 4). Seeded fresh on every
    // entry to the room so a restart or back-track recreates the
    // pickup. Mutually exclusive with `dropsKey` enemy spawns.
    if (currentRoom.initialKey) {
      currentKey = createKey(
        currentRoom.initialKey.x,
        currentRoom.initialKey.y,
      );
    }
  }

  spawnPlayerInCurrentRoom();
  applyInitialKey();
  snapCameraToRoom();

  function rebuildAllRooms() {
    rooms.set("room1", buildRoom1());
    rooms.set("room2", buildRoom2());
    rooms.set("room3", buildRoom3());
    rooms.set("room4", buildRoom4());
    rooms.set("room5", buildRoom5());
  }

  function restartRun() {
    audio.silence();
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
    state.screenShakeRemaining = 0;
    state.screenShakeInitial = 0;
    state.screenShakeAmount = 0;
    state.screenFlashRemaining = 0;
    state.screenFlashInitial = 0;
    state.screenFlashOpacity = 0;
    state.failedSnapshot = null;
    state.elapsed = 0;
    state.prevSentinelState = "none";
    state.prevBossPhase = 0;
    bullets = [];
    particles = [];
    rings = [];
    floatingTexts = [];
    lasers = [];
    currentKey = null;
    keyHeld = false;
    tryAgainBounds = null;
    spawnPlayerInCurrentRoom();
    applyInitialKey();
    resetEyeState(player);
    snapCameraToRoom();
  }

  function transitionToRoom(id: string) {
    const next = rooms.get(id);
    if (!next) return;
    currentRoom = next;
    bullets = [];
    rings = [];
    floatingTexts = [];
    lasers = [];
    currentKey = null;
    keyHeld = false;
    spawnPlayerInCurrentRoom();
    applyInitialKey();
    snapCameraToRoom();
    // Sentinel owns its own intro state — entering Room 5 lands the
    // boss in `state: "intro"` from the constructor; no external
    // priming is needed.
    state.prevSentinelState = currentRoom.id === "room5" ? "intro" : "none";
    // Music swap follows room id. Crossfade is long enough (1.5 s) to
    // overlap the door arrow / fade beat without a hard cut.
    if (currentRoom.id === "room5") {
      state.prevBossPhase = 1;
      audio.playMusic("boss-1", 1.5);
    } else {
      state.prevBossPhase = 0;
      audio.playMusic("rooms", 1.5);
    }
  }

  function roomBounds(): WorldBounds {
    return {
      minX: 0,
      minY: 0,
      maxX: currentRoom.width ?? ROOM_W_PX,
      maxY: currentRoom.height ?? ROOM_H_PX,
    };
  }

  function snapCameraToRoom(): void {
    if (!currentRoom.useCamera) {
      camera.x = 0;
      camera.y = 0;
      camera.targetX = 0;
      camera.targetY = 0;
      return;
    }
    updateCamera(
      camera,
      player.x,
      player.y,
      ROOM_W_PX,
      ROOM_H_PX,
      roomBounds(),
      1,
    );
    snapCamera(camera);
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

  // Game-complete DOM overlay shown after the boss-death sequence
  // finishes. The frame loop calls `completeMenu.show(...)` once with
  // the final score + elapsed time when sentinel.state hits "defeated".
  const completeMenu = createGameCompleteMenu({
    onPlayAgain: () => {
      restartRun();
      lastTime = performance.now();
    },
    onQuit: () => {
      window.location.href = "/";
    },
  });

  // Dev menu — F1 opens an overlay with a god-mode toggle and a
  // teleport-to-room list. transitionToRoom handles the heavy
  // lifting (camera snap, room rebuild, etc.) so the dev menu just
  // routes a click into it. Teleport disabled while the failed
  // overlay is up so the dev tool can't sneak past run state.
  const devMenu: DevMenu = createDevMenu({
    getGodMode: () => isGodMode(),
    setGodMode: (v) => setGodMode(v),
    getCurrentRoomId: () => currentRoom.id,
    isTeleportLocked: () =>
      state.runState !== "playing",
    teleportToRoom: (id) => {
      transitionToRoom(id);
      lastTime = performance.now();
    },
    rooms: [
      { id: "room1", label: "Room 1 — Corridor" },
      { id: "room3", label: "Room 2 — Trap" },
      { id: "room2", label: "Room 3 — Arena" },
      { id: "room4", label: "Room 4 — Phase Corridor" },
      { id: "room5", label: "Room 5 — Boss" },
    ],
  });

  window.addEventListener("keydown", (e) => {
    audio.init();
    pickInitialMusic();
    const code = e.code;

    // Dev menu owns its own F1 / Esc handling. Short-circuit our
    // game-side keydown while it's open so Esc doesn't also pop the
    // pause overlay underneath, etc.
    if (devMenu.isOpen()) return;

    // Esc / Tab are SYSTEM keys — hardcoded pause toggle (not
    // rebindable; the Controls overlay rejects them).
    if (code === "Escape" || code === "Tab") {
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
    if (isAnyBoundCode(code, keybinds)) e.preventDefault();
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
  });
  window.addEventListener("blur", () => keys.clear());

  canvas.addEventListener("click", (e) => {
    audio.init();
    pickInitialMusic();
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
    const input = inputDirection(keys, keybinds);
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
    player.dashTime = DASH_DURATION_MS / 1000;
    player.dashIframeTime = DASH_IFRAMES_MS / 1000;
    const v = dashSpeed(DASH_DISTANCE, DASH_DURATION_MS);
    player.vx = dx * v;
    player.vy = dy * v;
    state.dashId++;
    audio.play.dash();
  }

  function abortDash() {
    if (player.dashTime <= 0) return;
    player.dashTime = 0;
    player.dashIframeTime = 0;
    player.cooldown = DASH_COOLDOWN_MS / 1000;
    player.vx *= 0.35;
    player.vy *= 0.35;
  }

  function spawnTrailParticles(speed: number, isDash: boolean) {
    const dirX = speed > 0 ? -player.vx / speed : 0;
    const dirY = speed > 0 ? -player.vy / speed : 0;
    const perpX = -dirY;
    const perpY = dirX;

    // Dash sparks → profile.dashParticles. Idle / walk trails follow
    // the orb's ring colour from the profile so customisation drives
    // the whole non-dash trail look.
    let color: string;
    if (player.dashTime > 0 || player.dashIframeTime > 0) {
      color = profile.dashParticles;
    } else {
      color = profile.outerRing;
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
        initialSize: PLAYER_SIZE * sizeFactor,
        color,
        age: 0,
        lifetime,
        glowStrong: isDash ? 15 : 8,
        glowSoft: isDash ? 6 : 3,
        drag: PARTICLE_DRAG,
      });
    }
  }

  function triggerShake(amount: number, durationSec: number): void {
    // Take whichever is louder so a small shake can't override a big
    // one mid-decay; preserve the longer remaining time.
    if (durationSec > state.screenShakeRemaining) {
      state.screenShakeRemaining = durationSec;
      state.screenShakeInitial = durationSec;
      state.screenShakeAmount = amount;
    } else if (amount > state.screenShakeAmount) {
      state.screenShakeAmount = amount;
    }
  }

  function triggerScreenFlash(durationSec: number, opacity: number): void {
    state.screenFlashRemaining = durationSec;
    state.screenFlashInitial = durationSec;
    state.screenFlashOpacity = opacity;
  }

  function makeImpactCtx(): ImpactContext {
    // Live references to the current particles / rings arrays.
    // Construct fresh each call so reassignments earlier in the frame
    // (filter() in the age loop) don't leave us pushing into a stale
    // array.
    return { particles, rings, triggerShake, triggerScreenFlash };
  }

  function takeHit(amount: number = 1) {
    if (state.runState !== "playing") return;
    if (state.hitIframe > 0) return;
    if (player.dashIframeTime > 0) return;
    if (isGodMode()) return;
    // Player invuln during boss cinematic phases — leftover bullets
    // from the last burst can't kill them mid-VICTORY.
    {
      const sentinelGuard = findSentinel();
      if (
        sentinelGuard &&
        (sentinelGuard.state === "intro" ||
          sentinelGuard.state === "dying" ||
          sentinelGuard.state === "defeated")
      ) {
        return;
      }
    }
    audio.play.hit();
    state.hp = Math.max(0, state.hp - amount);
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
    // FX (rings, particles, sound, screen shake, screen flash) live in
    // emitEnemyKill — this function only credits score and floats the
    // "+N" tag.
    let scoreAmount: number;
    let textColor: string;
    let textSize: number;
    if (enemy.type === "hunter") {
      scoreAmount = HUNTER_KILL_SCORE;
      textColor = "#fb923c";
      textSize = 22;
    } else if (enemy.type === "watcher") {
      scoreAmount = WATCHER_KILL_SCORE;
      textColor = PALETTE.bullet;
      textSize = 24;
    } else if (enemy.type === "sentinel") {
      scoreAmount = SENTINEL_KILL_SCORE;
      textColor = PALETTE.bullet;
      textSize = 32;
    } else {
      scoreAmount = TURRET_KILL_SCORE;
      textColor = PALETTE.playerDash;
      textSize = 22;
    }
    state.score += scoreAmount;
    addFloatingText(
      floatingTexts,
      `+${scoreAmount}`,
      enemy.x,
      enemy.y - 18,
      {
        size: textSize,
        color: textColor,
        lifetime: 0.7,
      },
    );
    // Key drop happens here so it's independent of how the enemy
    // died — dash-through, friendly fire, or any future kill source
    // routes through destroyEnemy and gets the same drop. Only one
    // key per room.
    if (enemy.dropsKey && !currentKey) {
      currentKey = createKey(enemy.x, enemy.y);
    }
  }

  function aliveEnemies(): Enemy[] {
    return currentRoom.enemies.filter((e) => !e.isDead());
  }

  function findSentinel(): Sentinel | null {
    for (const e of currentRoom.enemies) {
      if (e instanceof Sentinel) return e;
    }
    return null;
  }

  // Drains Sentinel.pendingShake* into rooms-game's shake state so
  // the boss can request screen shake without a direct reference to
  // triggerShake, and dispatches the contact-damage takeHit() when
  // the boss flags it. Polled each frame after Sentinel.update.
  function consumeSentinelEffects(sentinel: Sentinel): void {
    if (sentinel.pendingShakePx > 0 && sentinel.pendingShakeSec > 0) {
      triggerShake(sentinel.pendingShakePx, sentinel.pendingShakeSec);
      sentinel.pendingShakePx = 0;
      sentinel.pendingShakeSec = 0;
    }
    if (sentinel.requestPlayerHit) {
      sentinel.requestPlayerHit = false;
      const dmg = sentinel.requestedPlayerHitDamage;
      sentinel.requestedPlayerHitDamage = 1;
      // takeHit gates by hitIframe, dashIframe, godMode, and the
      // boss-cinematic guard internally — no extra checks needed.
      takeHit(dmg);
    }
  }

  // Watches sentinel state transitions so kill score lands at the
  // dying entry, and Game Complete pops at the dying → defeated
  // boundary. Runs once per frame after Sentinel.update.
  function reconcileSentinelTransitions(sentinel: Sentinel): void {
    const prev = state.prevSentinelState;
    const cur = sentinel.state;
    if (prev === cur) return;
    if (
      (prev === "idle" || prev === "attacking") &&
      cur === "dying"
    ) {
      // Final hit landed — credit score + a "+N" floater.
      state.score += SENTINEL_KILL_SCORE;
      addFloatingText(
        floatingTexts,
        `+${SENTINEL_KILL_SCORE}`,
        sentinel.x,
        sentinel.y - 40,
        { size: 30, color: PALETTE.bullet, lifetime: 1.0, vy: -20 },
      );
    }
    if (prev === "dying" && cur === "defeated") {
      completeMenu.show({
        score: state.score,
        time: state.elapsed,
      });
      state.runState = "completed";
    }
    // Music: boss enters dying → drop the boss track entirely. The
    // VICTORY hold + force waves play under quiet, then "BACK TO MAIN
    // MENU" navigates away.
    if (
      (prev === "idle" || prev === "attacking") &&
      cur === "dying"
    ) {
      audio.stopMusic(2.0);
    }
    state.prevSentinelState = cur;
  }

  // Crossfade the active boss-phase track when the Sentinel's
  // bossPhase flips (1 → 2 → 3). Fired from the same frame-loop slot
  // as reconcileSentinelTransitions, right after sentinel.update.
  function reconcileBossMusic(sentinel: Sentinel): void {
    const phase = sentinel.bossPhase;
    if (state.prevBossPhase === phase) return;
    state.prevBossPhase = phase;
    // The phase-transition cinematic runs 2 s with timeScale slowed —
    // a slower crossfade (2.5 s) matches that pacing better than the
    // 1.5 s used for room entries.
    audio.playMusic(`boss-${phase}`, 2.5);
  }

  // First-user-gesture music kick. Routes to "boss-1" if the player
  // is already in Room 5, otherwise the standard "rooms" track. Idempotent
  // — playMusic is a no-op for the already-active key.
  function pickInitialMusic(): void {
    const key = currentRoom.id === "room5" ? "boss-1" : "rooms";
    audio.playMusic(key, 1.0);
  }

  function checkRoomCleared() {
    if (state.clearedRoomIds.has(currentRoom.id)) return;
    const door = currentRoom.door;
    if (!door) return; // no door, nothing to open
    // Two unlock rules:
    //  - requiresKey doors open on the key alone (the key still has to
    //    be earned by killing the carrier, but stragglers don't
    //    block the exit).
    //  - non-key doors require every enemy in the room to be dead.
    if (door.requiresKey) {
      if (!keyHeld) return;
    } else {
      if (currentRoom.enemies.length === 0) return; // empty rooms — skip
      if (aliveEnemies().length > 0) return;
    }
    state.clearedRoomIds.add(currentRoom.id);
    state.clearFlash = ROOM_CLEAR_FLASH;
    door.state = "open";
    audio.play.multUp(5); // placeholder sting
  }

  // ------- frame loop -------

  let lastTime = performance.now();

  function frame(now: number) {
    recordFrame(now);
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (menu.isOpen() || devMenu.isOpen()) {
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

    if (state.runState === "failed" || state.runState === "completed") {
      if (state.hitVignette > 0) {
        state.hitVignette = Math.max(0, state.hitVignette - dt);
      }
      // keep the eye animation alive (closing, blink decay) while overlay is up
      updateEye(player, dt, {
        threat: null,
        size: PLAYER_SIZE,
        dashDurationSec: DASH_DURATION_MS / 1000,
      });
      render();
      requestAnimationFrame(frame);
      return;
    }

    // Sentinel cinematic phases (intro / dying) freeze the world —
    // player input is suppressed and combat sim is skipped, but the
    // boss itself still ticks (its own state machine drives the
    // cinematic timers off `unscaledDt`).
    const sentinel = findSentinel();
    if (sentinel && sentinel.shouldFreezeWorld()) {
      keys.clear();
      sentinel.update({
        dt,
        unscaledDt: dt,
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
        playerHalfSize: PLAYER_SIZE / 2,
        playerMaxSpeed: PLAYER_MAX_SPEED,
        walls: currentRoom.walls,
      });
      consumeSentinelEffects(sentinel);
      reconcileSentinelTransitions(sentinel);
      reconcileBossMusic(sentinel);
      // Particles + rings spawned by the boss (materialization burst,
      // dying cinder) keep ticking even while the rest of the world
      // is frozen.
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
      // Player coast — keep the body alive so it doesn't freeze
      // mid-dash / mid-squash when the boss death cinematic kicks
      // in. Inputs are already cleared above; what we tick here is
      // just the dash-completion path, friction, position, the
      // visual timers (dashIframeTime / cooldown / hitIframe) so
      // the colour returns to neutral, and a perimeter clamp (no
      // smash audio — feels weird mid-VICTORY). Wall + bullet
      // collisions are intentionally skipped: combat is over.
      if (player.dashTime > 0) {
        player.dashTime -= dt;
        const v = dashSpeed(DASH_DISTANCE, DASH_DURATION_MS);
        player.vx = player.dashDirX * v;
        player.vy = player.dashDirY * v;
        if (player.dashTime <= 0) {
          player.dashTime = 0;
          player.cooldown = DASH_COOLDOWN_MS / 1000;
          player.vx *= 0.35;
          player.vy *= 0.35;
        }
      } else {
        const damp = Math.exp(-FRICTION * dt);
        player.vx *= damp;
        player.vy *= damp;
      }
      if (player.dashIframeTime > 0)
        player.dashIframeTime = Math.max(0, player.dashIframeTime - dt);
      if (player.cooldown > 0)
        player.cooldown = Math.max(0, player.cooldown - dt);
      if (state.hitIframe > 0)
        state.hitIframe = Math.max(0, state.hitIframe - dt);
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      {
        const half = PLAYER_SIZE / 2;
        const perimW = currentRoom.width ?? ROOM_W_PX;
        const perimH = currentRoom.height ?? ROOM_H_PX;
        const PERIMETER_T = 30;
        const minX = PERIMETER_T + half;
        const maxX = perimW - PERIMETER_T - half;
        const minY = PERIMETER_T + half;
        const maxY = perimH - PERIMETER_T - half;
        if (player.x < minX) {
          player.x = minX;
          player.vx = 0;
        }
        if (player.y < minY) {
          player.y = minY;
          player.vy = 0;
        }
        if (player.x > maxX) {
          player.x = maxX;
          player.vx = 0;
        }
        if (player.y > maxY) {
          player.y = maxY;
          player.vy = 0;
        }
      }
      // Player eye still animates so the orb breathes during the
      // cinematic.
      updateEye(player, dt, {
        threat: null,
        size: PLAYER_SIZE,
        dashDurationSec: DASH_DURATION_MS / 1000,
      });
      if (state.screenShakeRemaining > 0) {
        state.screenShakeRemaining = Math.max(
          0,
          state.screenShakeRemaining - dt,
        );
      }
      if (state.screenFlashRemaining > 0) {
        state.screenFlashRemaining = Math.max(
          0,
          state.screenFlashRemaining - dt,
        );
      }
      render();
      requestAnimationFrame(frame);
      return;
    }

    // Run-time ticks only when neither cinematic nor overlay is
    // pausing the sim.
    if (state.runState === "playing") {
      state.elapsed += dt;
    }

    // -------- running --------

    if (isActionPressed("dash", keys, keybinds)) {
      tryStartDash();
      consumeAction("dash", keys, keybinds);
    }

    if (player.dashTime > 0) {
      player.dashTime -= dt;
      const v = dashSpeed(DASH_DISTANCE, DASH_DURATION_MS);
      player.vx = player.dashDirX * v;
      player.vy = player.dashDirY * v;
      if (player.dashTime <= 0) {
        player.dashTime = 0;
        player.cooldown = DASH_COOLDOWN_MS / 1000;
        player.vx *= 0.35;
        player.vy *= 0.35;
      }
    } else {
      const input = inputDirection(keys, keybinds);
      if (input.x !== 0 || input.y !== 0) {
        player.facingX = input.x;
        player.facingY = input.y;
      }
      const accel = PLAYER_MAX_SPEED * ACCEL_FACTOR;
      player.vx += input.x * accel * dt;
      player.vy += input.y * accel * dt;
      const damp = Math.exp(-FRICTION * dt);
      player.vx *= damp;
      player.vy *= damp;
      const cap = isActionPressed("walk", keys, keybinds)
        ? PLAYER_MAX_SPEED * PLAYER_WALK_FACTOR
        : PLAYER_MAX_SPEED;
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
    if (state.screenShakeRemaining > 0)
      state.screenShakeRemaining = Math.max(0, state.screenShakeRemaining - dt);
    if (state.screenFlashRemaining > 0)
      state.screenFlashRemaining = Math.max(0, state.screenFlashRemaining - dt);
    // Tick enemy FX timers outside the enemies' update() so they keep
    // running even after destroyed flips (used for the post-kill hit
    // flash silhouette).
    for (const e of currentRoom.enemies) {
      if (e.hitFlashTime > 0)
        e.hitFlashTime = Math.max(0, e.hitFlashTime - dt);
      if (e.knockbackTime > 0)
        e.knockbackTime = Math.max(0, e.knockbackTime - dt);
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const half = PLAYER_SIZE / 2;
    const wasDashing = player.dashTime > 0;

    // Explicit arena-perimeter clamp + smash — mirrors the sandbox
    // arena pattern so a hit on the room border lands the same
    // visual + audio cue regardless of mode. Runs BEFORE the wall
    // resolve so the perimeter is handled directly (the resolve's
    // smallest-penetration heuristic can pick the wrong push axis
    // on a deep penetration of a 30 px-thick wall, dropping smash
    // entirely). Interior walls (pillars, door) are still routed
    // through resolveEntityWallCollisions below; smashCooldown
    // prevents double-fire if both paths hit.
    const perimW = currentRoom.width ?? ROOM_W_PX;
    const perimH = currentRoom.height ?? ROOM_H_PX;
    const PERIMETER_T = 30;
    const minX = PERIMETER_T + half;
    const maxX = perimW - PERIMETER_T - half;
    const minY = PERIMETER_T + half;
    const maxY = perimH - PERIMETER_T - half;
    const door = currentRoom.door;
    const doorOpen = door?.state === "open";
    const inDoorY =
      doorOpen && door
        ? player.y > door.y - door.h / 2 - half &&
          player.y < door.y + door.h / 2 + half
        : false;
    if (player.x < minX) {
      player.x = minX;
      if (player.vx < 0) {
        const s = triggerPlayerSmash(player, 1, 0, -player.vx);
        if (s >= 0) audio.play.smash(s);
      }
      player.vx = 0;
    }
    if (player.y < minY) {
      player.y = minY;
      if (player.vy < 0) {
        const s = triggerPlayerSmash(player, 0, 1, -player.vy);
        if (s >= 0) audio.play.smash(s);
      }
      player.vy = 0;
    }
    if (player.x > maxX && !inDoorY) {
      player.x = maxX;
      if (player.vx > 0) {
        const s = triggerPlayerSmash(player, -1, 0, player.vx);
        if (s >= 0) audio.play.smash(s);
      }
      player.vx = 0;
    }
    if (player.y > maxY) {
      player.y = maxY;
      if (player.vy > 0) {
        const s = triggerPlayerSmash(player, 0, -1, player.vy);
        if (s >= 0) audio.play.smash(s);
      }
      player.vy = 0;
    }

    // Capture inward velocity before resolve zeroes the stopped axis.
    // After resolving, pick whichever axis carried the larger impact
    // and emit a single smash for that surface normal — covers
    // interior walls (perimeter is already handled above).
    const preVx = player.vx;
    const preVy = player.vy;
    // Walls flagged `dashable` (Room 4 section dividers) phase the
    // player through during dash i-frames so the only way past them
    // is a clean dash.
    const wallsForPlayer =
      player.dashIframeTime > 0
        ? currentRoom.walls.filter((w) => !w.dashable)
        : currentRoom.walls;
    const collisionResult = resolvePlayerWallCollisions(
      player,
      wallsForPlayer,
      half,
    );
    if (
      wasDashing &&
      (collisionResult.stoppedX || collisionResult.stoppedY)
    ) {
      abortDash();
    }
    if (collisionResult.stoppedX || collisionResult.stoppedY) {
      let impact = 0;
      let nx = 0;
      let ny = 0;
      if (collisionResult.stoppedX) {
        const i = Math.abs(preVx);
        if (i > impact) {
          impact = i;
          nx = -Math.sign(preVx);
          ny = 0;
        }
      }
      if (collisionResult.stoppedY) {
        const i = Math.abs(preVy);
        if (i > impact) {
          impact = i;
          nx = 0;
          ny = -Math.sign(preVy);
        }
      }
      if (impact > 0) {
        const s = triggerPlayerSmash(player, nx, ny, impact);
        if (s >= 0) audio.play.smash(s);
      }
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
      const preDoorVx = player.vx;
      const preDoorVy = player.vy;
      const r2 = resolvePlayerWallCollisions(player, [doorWall], half);
      if (wasDashing && (r2.stoppedX || r2.stoppedY)) abortDash();
      if (r2.stoppedX || r2.stoppedY) {
        let impact = 0;
        let nx = 0;
        let ny = 0;
        if (r2.stoppedX) {
          const i = Math.abs(preDoorVx);
          if (i > impact) {
            impact = i;
            nx = -Math.sign(preDoorVx);
            ny = 0;
          }
        }
        if (r2.stoppedY) {
          const i = Math.abs(preDoorVy);
          if (i > impact) {
            impact = i;
            nx = 0;
            ny = -Math.sign(preDoorVy);
          }
        }
        if (impact > 0) {
          const s = triggerPlayerSmash(player, nx, ny, impact);
          if (s >= 0) audio.play.smash(s);
        }
      }
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
      // Same as `dt` while no slow-mo is active. Sentinel reads
      // `unscaledDt` for its own cinematic timers; the field stays
      // wired so the contract is consistent with the freeze branch
      // and any future timeScale work.
      unscaledDt: dt,
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
      playerHalfSize: PLAYER_SIZE / 2,
      playerMaxSpeed: PLAYER_MAX_SPEED,
      walls: currentRoom.walls,
    };
    // Lazy spawns (Room 4 corridor) — fire any pending enemy whose
    // triggerX has been crossed. Runs before awareness so the new
    // hunter immediately sees the player on its first tick.
    if (currentRoom.pendingEnemies) {
      for (const p of currentRoom.pendingEnemies) {
        if (!p.spawned && player.x >= p.triggerX) {
          p.spawned = true;
          currentRoom.enemies.push(p.spawn());
        }
      }
    }

    // Awareness ramps run BEFORE enemy update so combat ticks see the
    // freshly-promoted aggro state immediately. Trigger ctx lets the
    // awareness module spawn the alert ring + particle burst directly
    // into the per-room lists.
    const awarenessTrigger = { particles, rings };
    for (const e of currentRoom.enemies) {
      updateEnemyAwareness(e, player.x, player.y, dt, awarenessTrigger);
    }
    for (const e of currentRoom.enemies) e.update(enemyCtx);

    // Sentinel transitions (combat → dying → defeated) drive score
    // and the Game Complete overlay; pendingShake* gets drained.
    {
      const sentinelTick = findSentinel();
      if (sentinelTick) {
        consumeSentinelEffects(sentinelTick);
        reconcileSentinelTransitions(sentinelTick);
        reconcileBossMusic(sentinelTick);
      }
    }

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
      const halfPlus = PLAYER_SIZE / 2 + LASER_HIT_PADDING;
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
              player.y - PLAYER_SIZE,
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
          triggerShake(SCREEN_SHAKE_PX, SCREEN_SHAKE_DURATION_SEC);
          takeHit();
          break;
        }
      }
    }

    // friendly fire — Watcher lasers also damage other enemies that
    // happen to stand on the beam during firing. Per-laser dedup via
    // hitByLaserId so a beam only credits one hit per target across
    // its firing window.
    for (const l of lasers) {
      if (l.age < l.chargingDuration) continue;
      if (l.age >= l.chargingDuration + l.firingDuration) continue;
      for (const e of currentRoom.enemies) {
        if (e.isDead()) continue;
        if (e === l.ownerEnemy) continue;
        if (e.hitByLaserId === l.id) continue;
        const reach = e.hitboxRadius + LASER_FRIENDLY_FIRE_HALF_WIDTH;
        const d2 = pointSegmentDistanceSq(
          e.x,
          e.y,
          l.ownerEnemy.x,
          l.ownerEnemy.y,
          l.endX,
          l.endY,
        );
        if (d2 >= reach * reach) continue;
        e.hitByLaserId = l.id;
        const wasDead = e.isDead();
        e.takeDamage(1);
        if (e.isDead()) {
          if (!wasDead) {
            emitEnemyKill(makeImpactCtx(), e);
            destroyEnemy(e);
            state.score += FRIENDLY_FIRE_BONUS;
            addFloatingText(
              floatingTexts,
              "FRIENDLY FIRE",
              e.x,
              e.y - 38,
              {
                size: 14,
                color: "#facc15",
                lifetime: 0.9,
                vy: -30,
              },
            );
            addFloatingText(
              floatingTexts,
              `+${FRIENDLY_FIRE_BONUS}`,
              e.x,
              e.y - 56,
              {
                size: 16,
                color: "#facc15",
                lifetime: 0.7,
              },
            );
          }
        } else {
          // medium damage — knockback direction is along the beam
          // (from owner toward target).
          emitEnemyDamage(makeImpactCtx(), e, l.ownerEnemy.x, l.ownerEnemy.y);
        }
      }
    }

    // bullet movement + wall expiry (no bouncing in rooms)
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      pushTrailSample(b);
    }
    // Bullet bounds use the CURRENT room's world dimensions, not the
    // canonical 1200x800 viewport. In a wide camera room (Room 4 is
    // 3600 wide) bullets fired from x=1900+ would otherwise be
    // filtered the moment they leave the screen letterbox bounds.
    const worldW = currentRoom.width ?? ROOM_W_PX;
    const worldH = currentRoom.height ?? ROOM_H_PX;
    bullets = bullets.filter((b) => {
      if (b.x < -40 || b.x > worldW + 40) return false;
      if (b.y < -40 || b.y > worldH + 40) return false;
      if (bulletInsideWall(b.x, b.y, currentRoom.walls)) return false;
      return true;
    });

    // bullet vs player (no scoring, just damage)
    if (state.hitIframe <= 0 && player.dashIframeTime <= 0) {
      const ph = PLAYER_SIZE / 2;
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

    // dash-through bullets — LIGHT-tier impact feedback only (no
    // scoring in rooms; the satisfaction is the cue itself). Dedup
    // per dash via dashedThroughId so a single bullet can't fire the
    // tic twice as it crosses the player.
    if (player.dashIframeTime > 0) {
      const ph = PLAYER_SIZE / 2;
      const bh = settings.bullets.size / 2;
      for (const b of bullets) {
        if (b.dashedThroughId === state.dashId) continue;
        if (
          Math.abs(b.x - player.x) < ph + bh &&
          Math.abs(b.y - player.y) < ph + bh
        ) {
          b.dashedThroughId = state.dashId;
          emitBulletHit(makeImpactCtx(), b.x, b.y, settings.bullets.color);
        }
      }
    }

    // dash damage to enemies — split MEDIUM (alive after) vs HEAVY
    // (kill blow) so the impact tier scales with significance.
    if (player.dashIframeTime > 0) {
      for (const e of currentRoom.enemies) {
        const wasDead = e.isDead();
        const hit = e.tryDashDamage(state.dashId, player.x, player.y, half);
        if (hit && !wasDead) {
          if (e.isDead()) {
            emitEnemyKill(makeImpactCtx(), e);
            destroyEnemy(e);
          } else {
            emitEnemyDamage(makeImpactCtx(), e, player.x, player.y);
          }
        }
      }
    }

    // key tick + pickup
    if (currentKey) {
      updateKey(currentKey, dt);
      if (
        !keyHeld &&
        !currentKey.collected &&
        checkKeyPickup(currentKey, player.x, player.y)
      ) {
        currentKey.collected = true;
        keyHeld = true;
        audio.play.pickupGrab("hp");
        addFloatingText(
          floatingTexts,
          "KEY ACQUIRED",
          player.x,
          player.y - PLAYER_SIZE,
          {
            size: 18,
            color: "#ffd60a",
            lifetime: 0.9,
            vy: -40,
          },
        );
      }
    }

    // contact damage from un-dashed enemies
    if (state.hitIframe <= 0 && player.dashIframeTime <= 0) {
      for (const e of currentRoom.enemies) {
        if (e.overlapsPlayer(player.x, player.y, half)) {
          takeHit();
          if (e.onContactDamage) e.onContactDamage();
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
      bullets,
      enemies: currentRoom.enemies,
      mode: "rooms",
      hitIframe: state.hitIframe,
      size: PLAYER_SIZE,
      dashDurationSec: DASH_DURATION_MS / 1000,
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

    // follow camera — runs even on the failed-overlay branch since
    // the eye still updates there (see early-return path)
    if (currentRoom.useCamera) {
      updateCamera(
        camera,
        player.x,
        player.y,
        ROOM_W_PX,
        ROOM_H_PX,
        roomBounds(),
      );
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
    if (state.screenShakeRemaining > 0 && state.screenShakeInitial > 0) {
      const t = state.screenShakeRemaining / state.screenShakeInitial;
      shakeX = (Math.random() * 2 - 1) * state.screenShakeAmount * t;
      shakeY = (Math.random() * 2 - 1) * state.screenShakeAmount * t;
    }
    ctx.setTransform(
      scale * dpr,
      0,
      0,
      scale * dpr,
      (offsetX + shakeX) * dpr,
      (offsetY + shakeY) * dpr,
    );

    // No inner contrast fill — the whole canvas (including letterbox
    // bars) is uniform PALETTE.bg, set above. Camera rooms then scroll
    // walls / world content over it.

    // Camera scrolls the world inside the canonical letterbox. Non-
    // camera rooms (1-3, 5 placeholder) draw at world == canvas.
    const useCamera = !!currentRoom.useCamera;
    if (useCamera) {
      ctx.save();
      ctx.translate(-camera.x, -camera.y);
    }

    // Minimalist world-space grid. Clamped to the room's logical
    // bounds so it stops at the perimeter walls and never bleeds into
    // the letterbox.
    drawRoomGrid(
      ctx,
      currentRoom.width ?? ROOM_W_PX,
      currentRoom.height ?? ROOM_H_PX,
    );

    drawWalls(ctx, currentRoom.walls);
    if (currentRoom.door) drawDoor(ctx, currentRoom.door);

    // detection rings (drawn under everything so they read as a
    // ground-level radar pulse, not an overlay on top of the enemy)
    for (const e of currentRoom.enemies) {
      drawEnemyDetection(ctx, e, player.x, player.y);
    }

    // lasers (under enemies so the beam appears to emerge from behind)
    for (const l of lasers) drawLaser(ctx, l);

    // enemies
    for (const e of currentRoom.enemies) e.draw(ctx);


    // bullets — trail pass then live pass. Trail still uses plain
    // fillRect (no shadow, just modulated alpha). Live pass blits a
    // pre-rendered sprite (one offscreen canvas per color/size combo
    // in lib/bullet-sprite) so per-bullet shadowBlur is gone — the
    // dominant frame cost in phase 3 of the boss (50-80 bullets
    // steady-state with the cadence boost + mine detonations).
    const bSize = settings.bullets.size;
    const bColor = settings.bullets.color;
    ctx.save();
    ctx.fillStyle = bColor;
    ctx.shadowBlur = 0;
    for (const b of bullets) {
      if (b.trailCount === 0) continue;
      const start = b.trailCount === 5 ? b.trailIdx : 0;
      for (let i = 0; i < b.trailCount; i++) {
        const j = (start + i) % 5;
        const t = b.trailCount === 1 ? 1 : i / (b.trailCount - 1);
        const sz = bSize * (0.5 + 0.5 * t);
        ctx.globalAlpha = 0.1 + 0.4 * t;
        ctx.fillRect(b.trailX[j] - sz / 2, b.trailY[j] - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    const bulletSprite = getBulletSprite(bColor, bSize);
    const bulletOffset = getBulletSpriteOffset(bSize);
    for (const b of bullets) {
      ctx.drawImage(bulletSprite, b.x - bulletOffset, b.y - bulletOffset);
    }

    // particles — same hoisting pattern. Color changes per particle
    // so we can't hoist fillStyle, but we drop the per-particle
    // save/restore and the second drawNeon pass.
    const useNeon = particles.length < 50;
    ctx.save();
    if (!useNeon) ctx.shadowBlur = 0;
    for (const p of particles) {
      const t = p.age / p.lifetime;
      const alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
      const sz = Math.max(0.5, p.initialSize * (1 - t));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (useNeon) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.glowStrong;
      }
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.restore();

    // player
    const pSize = PLAYER_SIZE;

    let drawPlayer = true;
    if (state.hitIframe > 0) {
      drawPlayer = Math.floor(state.hitIframe * 10) % 2 === 0;
    }

    if (drawPlayer) {
      // Body layers come straight from the player profile in every
      // state. The dash halo is derived inside drawPlayerEye from
      // profile.dashParticles, so the energy reads as the same colour
      // as the trail and the ghost copies.
      drawPlayerEye(ctx, player, pSize, {
        ringColor: profile.outerRing,
        pupilColor: profile.pupil,
        ghostColor: profile.outerRing,
        dashDurationSec: DASH_DURATION_MS / 1000,
        dashCooldownSec: DASH_COOLDOWN_MS / 1000,
        profile,
      });
    }

    // rings
    for (const ring of rings) {
      const t = ring.age / ring.lifetime;
      const r = ring.startR + (ring.endR - ring.startR) * t;
      const alpha = 1 - t;
      const lwStart = ring.startLineWidth ?? 2;
      const lwEnd = ring.endLineWidth ?? lwStart;
      const lineWidth = lwStart + (lwEnd - lwStart) * t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = lineWidth;
      if (ring.glowBlur) {
        ctx.shadowColor = ring.color;
        ctx.shadowBlur = ring.glowBlur;
      }
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // key pickup (drawn above bullets / particles, below HUD)
    if (currentKey && !currentKey.collected) drawKey(ctx, currentKey);

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

    if (useCamera) ctx.restore();

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

    // global white impact flash — alpha fades over the remaining window
    if (state.screenFlashRemaining > 0 && state.screenFlashInitial > 0) {
      const t = state.screenFlashRemaining / state.screenFlashInitial;
      ctx.fillStyle = `rgba(255, 255, 255, ${state.screenFlashOpacity * t})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }

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
    drawBossOverlay();
    drawGodModeBadge(ctx, viewW);
    drawFpsOverlay(ctx, viewW);

    if (state.runState === "failed") drawFailedOverlay();
  }

  function drawBossOverlay() {
    const sentinel = findSentinel();
    if (!sentinel) return;
    // HP bar — shown only after the intro lands (state === "idle" or
    // "attacking"). Hidden during intro/dying/defeated.
    const showHpBar =
      sentinel.state === "idle" || sentinel.state === "attacking";
    if (showHpBar) {
      const sideMargin = 100;
      const barH = 18;
      const barW = viewW - sideMargin * 2;
      const barX = sideMargin;
      // Bar pinned to the bottom edge with
      // BOSS_HP_BAR_BOTTOM_PADDING_PX of breathing room from the
      // viewport edge; SENTINEL label + HP count sit above the bar.
      // Top-of-screen position used to fight the HUD block; bottom
      // gives the boss arena more vertical reading space and keeps
      // the player's eye on the action instead of the corner.
      const labelLineHeight = 13;
      const barY = viewH - BOSS_HP_BAR_BOTTOM_PADDING_PX - barH;
      const labelY = barY - labelLineHeight - BOSS_HP_LABEL_GAP_PX;
      ctx.save();
      ctx.font = "700 13px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = PALETTE.bullet;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("SENTINEL", barX, labelY);

      ctx.fillStyle = "rgba(255, 45, 85, 0.2)";
      ctx.fillRect(barX, barY, barW, barH);
      const t = Math.max(0, Math.min(1, sentinel.hp / SENTINEL_HP_MAX));
      ctx.fillStyle = PALETTE.bullet;
      ctx.fillRect(barX, barY, barW * t, barH);
      ctx.strokeStyle = PALETTE.bullet;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

      // Phase boundary markers — thin vertical ticks at the
      // boundaries (HP 40 + 20 with the bumped HP_MAX, i.e.
      // 2/3 + 1/3 of the bar). Each flashes white for
      // PHASE_TRANSITION_HP_MARKER_FLASH_SEC when the corresponding
      // phase transition climax fires; sentinel exposes the
      // countdown timers and rooms-game just lerps the colour.
      const baseMarkerAlpha = 0.4;
      const markerThresholds: { fraction: number; flash: number }[] = [
        {
          fraction: SENTINEL_PHASE_HP_BOUNDARY_1_TO_2 / SENTINEL_HP_MAX,
          flash: sentinel.phaseMarkerFlashTimer1to2,
        },
        {
          fraction: SENTINEL_PHASE_HP_BOUNDARY_2_TO_3 / SENTINEL_HP_MAX,
          flash: sentinel.phaseMarkerFlashTimer2to3,
        },
      ];
      const PHASE_FLASH_SEC = 0.3;
      ctx.lineWidth = 2;
      for (const m of markerThresholds) {
        const x = barX + barW * m.fraction;
        const flashRamp = m.flash > 0 ? m.flash / PHASE_FLASH_SEC : 0;
        const alpha = baseMarkerAlpha + (1 - baseMarkerAlpha) * flashRamp;
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(x, barY);
        ctx.lineTo(x, barY + barH);
        ctx.stroke();
      }

      ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "right";
      ctx.fillText(
        `${sentinel.hp} / ${SENTINEL_HP_MAX}`,
        barX + barW,
        labelY,
      );
      ctx.restore();
    }
    // Sentinel-owned screen overlays — fade rect, "SENTINEL" /
    // "VICTORY" titles, white flash. The boss handles its own
    // timing internally; we just delegate the draw call.
    sentinel.drawScreenOverlay(ctx, viewW, viewH);
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
    // Campaign chain: corridor → trap → arena → long corridor → boss.
    // File ids: room1 / room3 (trap) / room2 (arena) / room4 (long
    // corridor) / room5 (boss) — slots map to player-visible numbers
    // below.
    const isBoss = currentRoom.id === "room5";
    const roomNum =
      currentRoom.id === "room1"
        ? 1
        : currentRoom.id === "room3"
          ? 2
          : currentRoom.id === "room2"
            ? 3
            : currentRoom.id === "room4"
              ? 4
              : isBoss
                ? 5
                : ROOM_TOTAL;
    if (isBoss) {
      ctx.fillStyle = PALETTE.bullet;
      ctx.fillText(`${roomNum} / ${ROOM_TOTAL} — BOSS`, colA, y0 + 14);
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillText(`${roomNum} / ${ROOM_TOTAL}`, colA, y0 + 14);
    }

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

    // Awareness indicator (top-center) — DETECTED red while any
    // enemy is in aggro, ALERT yellow while any is alerting, hidden
    // when all are idle. Pulses to call attention without being
    // sticky.
    let anyAggro = false;
    let anyAlerting = false;
    for (const e of currentRoom.enemies) {
      if (e.isDead()) continue;
      if (e.awarenessState === "aggro") anyAggro = true;
      else if (e.awarenessState === "alerting") anyAlerting = true;
    }
    if (anyAggro || anyAlerting) {
      const text = anyAggro ? "DETECTED" : "ALERT";
      const color = anyAggro ? "#ff2d55" : "#fb923c";
      const pulse =
        0.65 + 0.35 * (Math.sin(performance.now() * 0.012) + 1) * 0.5;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.font = "600 12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.fillText(text, viewW / 2, 4);
      ctx.restore();
    }

    // Key indicator (top-right). Shown only on rooms whose door
    // requiresKey, so 1-3 stay clean.
    if (currentRoom.door?.requiresKey) {
      const kx = viewW - 40;
      const ky = 26;
      drawKeyHudIcon(ctx, kx, ky, keyHeld);
      ctx.fillStyle = keyHeld ? "#ffd60a" : "rgba(255, 214, 10, 0.55)";
      ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.fillText(keyHeld ? "1 / 1" : "0 / 1", viewW - 20, ky + 14);
    }

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

function showTutorialLockOverlay(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void {
  const dpr = window.devicePixelRatio || 1;
  const renderOnce = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#facc15";
    ctx.font = "600 32px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("STORY MODE LOCKED", w / 2, h / 2 - 60);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "500 16px system-ui, -apple-system, sans-serif";
    ctx.fillText("Complete the tutorial first.", w / 2, h / 2 - 18);
  };
  // DOM CTA so the button is keyboard-accessible and styled like the
  // landing menu instead of being painted on the canvas.
  const btn = document.createElement("a");
  btn.href = "/tutorial.html";
  btn.textContent = "GO TO TUTORIAL";
  btn.style.cssText = [
    "position: fixed",
    "left: 50%",
    "top: 50%",
    "transform: translate(-50%, 30px)",
    "padding: 12px 28px",
    "border: 1px solid rgba(0, 229, 255, 0.5)",
    "background: rgba(0, 229, 255, 0.14)",
    "color: #00e5ff",
    "font: 600 13px system-ui, -apple-system, sans-serif",
    "letter-spacing: 0.18em",
    "border-radius: 6px",
    "text-decoration: none",
    "z-index: 100",
  ].join(";");
  document.body.appendChild(btn);
  renderOnce();
  window.addEventListener("resize", renderOnce);
}
