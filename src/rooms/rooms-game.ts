import { audio } from "../lib/audio";
import { createDevMenu, type DevMenu } from "../lib/dev-menu";
import { drawFpsOverlay, recordFrame } from "../lib/fps-meter";
import {
  drawPerfOverlay,
  perfBegin,
  perfEnd,
  perfFrameEnd,
  perfFrameStart,
  togglePerfOverlay,
} from "../lib/perf-meter";
import {
  drawScrambleText,
  isScrambleTextDone,
  makeScrambleSchedule,
} from "../lib/scramble-text";
import {
  drawGodModeBadge,
  isGodMode,
  setGodMode,
  isInstakill,
  setInstakill,
} from "../lib/god-mode";
import {
  acquireBullet,
  releaseBullet,
  type Bullet,
  compactBullets,
  pushTrailSample,
} from "../lib/bullets";
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
import {
  createGridNodeState,
  drawRoomGrid,
  updateGridNodes,
  type GridNodeState,
} from "../lib/grid";
import {
  createArchiveFx,
  drawArchiveFx,
  updateArchiveFx,
  type ArchiveFx,
} from "../lib/archive-fx";
import {
  createArenaBg,
  drawArenaBg,
  drawScanlines,
  tickScanlines,
  updateArenaBg,
  type ArenaBg,
} from "../lib/arena-bg";
import {
  createDeathFx,
  drawDeathFx,
  shouldShowDeathOverlay,
  updateDeathFx,
  type DeathFx,
} from "../lib/death-fx";
import { drawNeon } from "../lib/neon";
import { PALETTE } from "../lib/palette";
import {
  getLaserBeamSprite,
  getLaserImpactOffset,
  getLaserImpactSprite,
} from "../lib/laser-sprite";
import {
  type FloatingText,
  type Particle,
  type Ring,
  addFloatingText,
  addRing,
  compactFloatingTexts,
  compactParticles,
  compactRings,
  drawFloatingTexts,
  pushParticle,
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
import { createPauseMenu } from "../lib/pause-menu";
import { BackgroundFx } from "../lib/bg-fx";
import {
  createEnergyBackground,
  drawEnergyBackground,
  updateEnergyBackground,
  type ArenaScreenBounds,
  type EnergyBackground,
} from "../lib/background-energy";
import {
  createBackgroundTextState,
  drawBackgroundTexts,
  updateBackgroundTexts,
  type BackgroundTextState,
} from "../lib/background-text";
import { PostProcessor, DEFAULT_POST } from "../lib/postprocess";
import { type Bounds, hitBounds } from "../lib/types";
import {
  addWallImpact,
  bounceBulletOffWalls,
  createWallFx,
  drawWallOverlay,
  drawWalls,
  findContainingWall,
  resolvePlayerWallCollisions,
  updateWallFx,
  type Wall,
  type WallFx,
} from "../lib/walls";
import { buildRoom1 } from "./room1";
import { buildRoom2 } from "./room2";
import { buildRoom3 } from "./room3";
import { buildRoom4 } from "./room4";
import { buildRoom5 } from "./room5";
import { buildRoomFromJson } from "./build-room-from-json";
import { createEditor } from "./editor";
import type { EditorHandle } from "./editor";
import type { RoomJson } from "./room-json-types";
import type { AmbientBulletField, Room } from "../lib/room";

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
    // firing — cached beam sprite (red halo + white hot-core baked in)
    // is blitted stretched along the beam axis. Replaces three live
    // shadowBlur strokes (16 + 8 + 12 px radius on a beam up to the
    // full arena diagonal), which was dominating frame cost in Room 3
    // and the boss arena once a Watcher / Sweep Laser fired.
    // Inner save/restore scope so the rotation doesn't leak into the
    // impact draw or any caller transforms (drawLaser runs inside the
    // camera transform — bare setTransform would clobber it).
    const beam = getLaserBeamSprite(PALETTE.bullet);
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(startX, startY);
    ctx.rotate(angle);
    ctx.drawImage(beam.canvas, 0, -beam.height / 2, lineLen, beam.height);
    ctx.restore();

    // Impact glow at the wall hit point — cached radial dot, single
    // drawImage. Pulse animation via globalAlpha on the blit.
    const pulse = 0.55 + Math.sin(l.age * 30) * 0.15;
    ctx.globalAlpha = pulse;
    const impactSprite = getLaserImpactSprite(PALETTE.bullet, LASER_IMPACT_RADIUS);
    const impactOff = getLaserImpactOffset(LASER_IMPACT_RADIUS);
    ctx.drawImage(impactSprite, l.endX - impactOff, l.endY - impactOff);
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
  /** Seconds remaining before door-overlap triggers re-arm after a
   *  transition. Prevents the player from instantly re-triggering
   *  either door when respawning right next to it (e.g. via back
   *  transition spawn that lands close to the forward door). */
  doorEnterCooldown: number;
  failedSnapshot: FailedSnapshot | null;
  /** Active when the player has just died and the death cinematic is
   *  playing. Drives the gating of the failed-overlay so the screen
   *  doesn't cover up the explosion. Cleared on restartRun. */
  deathFx: DeathFx | null;
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
  const post = new PostProcessor();
  const bgFx = new BackgroundFx();

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
  // Story-mode music. Two tracks: "rooms" plays through rooms 1–4,
  // then crossfades to a single "boss" track for the whole Sentinel
  // fight (no longer per-phase). Files live in public/audio/ (Vite
  // serves /audio/ from there). Load is deferred until audio.init()
  // fires on the first user gesture (the keydown / click handlers
  // below).
  const audioBase = import.meta.env.BASE_URL + "audio/";
  audio.setMusicTrack("rooms", encodeURI(audioBase + "Glass Under Ice.mp3"));
  audio.setMusicTrack("boss", encodeURI(audioBase + "boss/boss.mp3"));

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
    bgFx.resize(viewW, viewH);
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

  // Ambient bullet field — Room 1 fills its right half with sandbox-
  // style bouncing bullets via `Room.ambientBullets`. Initial fill
  // ramps to cap fast (4 per 40 ms) like sandbox, then settles to the
  // configured cadence. Both flags reset on restart + transition.
  let ambientSpawnTimer = 0;
  let ambientInitialFillDone = false;

  // Vite collects every src/rooms/*.json at build time; the eager
  // import gives us { './foo.json': { default: RoomJson } } so we
  // don't pay a fetch round-trip. New JSON written via the editor's
  // Vite plugin (U3) is picked up by HMR — next restartRun rebuilds
  // it through registerJsonRooms below. TS-authored rooms always
  // win on id collisions because they register first.
  const jsonRoomModules = import.meta.glob<{ default: RoomJson }>(
    "./*.json",
    { eager: true },
  );
  function registerJsonRooms(target: Map<string, Room>): void {
    for (const [pathKey, mod] of Object.entries(jsonRoomModules)) {
      const json = mod.default;
      if (target.has(json.id)) {
        console.error(
          `[rooms] JSON room id collision: ${json.id} (from ${pathKey}) already registered, skipping`,
        );
        continue;
      }
      try {
        target.set(json.id, buildRoomFromJson(json, json.id));
      } catch (e) {
        console.error(
          `[rooms] failed to build JSON room from ${pathKey}:`,
          (e as Error).message,
        );
      }
    }
  }

  const rooms = new Map<string, Room>();
  rooms.set("room1", buildRoom1());
  rooms.set("room2", buildRoom2());
  rooms.set("room3", buildRoom3());
  rooms.set("room4", buildRoom4());
  rooms.set("room5", buildRoom5());
  registerJsonRooms(rooms);

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
    doorEnterCooldown: 0,
    failedSnapshot: null,
    deathFx: null,
    elapsed: 0,
    prevSentinelState: "none",
    prevBossPhase: 0,
  };

  let currentRoom: Room = rooms.get("room1")!;
  // First-arrival sequence — gated on a sessionStorage flag set by
  // tutorial-game right before its outro redirect. When set, we fade
  // in from black (matching the tutorial's fade-out) and show the
  // hero's first thought in this room. When unset (entry from the
  // landing-page Rooms button, or a reload), we cold-start without
  // any of this. Flag is consumed once so a reload doesn't replay.
  const FROM_TUTORIAL_KEY = "dash-proto:from-tutorial";
  let arrivedFromTutorial = false;
  try {
    arrivedFromTutorial =
      sessionStorage.getItem(FROM_TUTORIAL_KEY) === "true";
    if (arrivedFromTutorial) sessionStorage.removeItem(FROM_TUTORIAL_KEY);
  } catch {
    arrivedFromTutorial = false;
  }
  let roomsFadeIn = arrivedFromTutorial ? 1.0 : 0;
  const ROOMS_FADE_IN_DURATION_SEC = 2.5;
  // Hero's first thought on landing in the campaign. Scrambled glyphs
  // → "how do i do this?" — same effect as "who am i?" in the intro
  // and "who was that?" at the tutorial start. Only ticks when the
  // player arrived from the tutorial; menu entries skip the timer.
  const ROOMS_BOOT_THOUGHT_TEXT = "how do i do this?";
  const roomsBootThoughtSchedule = makeScrambleSchedule({
    // Start surfacing after the fade-in has mostly cleared so the
    // text isn't competing with darkness.
    appearStart: 3.0,
    fadeInDuration: 0.5,
    settleDuration: 2.3,
    holdDuration: 1.0,
    fadeOutDuration: 0.9,
  });
  let roomsBootThoughtAge = 0;
  // World-space scramble labels (Room 1's INFECTED ZONE sign) share a
  // single per-room timer. Reset on entry/restart so the intro replays
  // every time the room is re-entered.
  const WORLD_LABEL_SCRAMBLE_SCHEDULE = makeScrambleSchedule({
    appearStart: 0.5,
    fadeInDuration: 0.4,
    settleDuration: 1.5,
    holdDuration: 2.5,
    fadeOutDuration: 1.0,
    glitchOutDuration: 0.8,
  });
  let worldLabelAge = 0;
  // Scramble labels stay dormant until they enter the visible
  // viewport for the first time (player has to walk close enough for
  // the camera to bring the label into frame). Once started, the
  // intro plays through even if the player walks away — we don't
  // want it to loop.
  let worldLabelStarted = false;
  let arenaBg: ArenaBg = createArenaBg(
    currentRoom.width ?? ROOM_W_PX,
    currentRoom.height ?? ROOM_H_PX,
  );
  let wallFx: WallFx = createWallFx(currentRoom.walls);
  // Energy background — drifting neon lines + rising particles + an
  // occasional lightning streak, drawn in the canvas margins outside
  // the visible arena. Single instance for the whole session so the
  // streams keep flowing across room transitions.
  const energyBg: EnergyBackground = createEnergyBackground(viewW, viewH);
  // Cyberpunk-terminal phrases typing themselves out in the margins.
  const bgText: BackgroundTextState = createBackgroundTextState(viewW, viewH);
  let gridNodes: GridNodeState = createGridNodeState(
    currentRoom.width ?? ROOM_W_PX,
    currentRoom.height ?? ROOM_H_PX,
  );
  let archiveFx: ArchiveFx = createArchiveFx(
    currentRoom.width ?? ROOM_W_PX,
    currentRoom.height ?? ROOM_H_PX,
  );

  // Screen-space rect of the visible arena, used to clip out the
  // playfield from the energy/text background passes. Camera and
  // letterbox both factored in.
  function computeArenaBounds(): ArenaScreenBounds {
    const worldW = currentRoom.width ?? ROOM_W_PX;
    const worldH = currentRoom.height ?? ROOM_H_PX;
    // Camera always follows the player now (useCamera flag retained
    // for legacy room data but no longer gates behaviour). The
    // visible-world rect in canonical space depends on where the
    // player is; the same math handles any room size. Editor zoom
    // stretches the world inside the canonical viewport — a world
    // delta of D in viewport canonical px is `D * zoom`.
    const z = camera.zoom;
    const canonLeft = Math.max(0, -camera.x * z);
    const canonTop = Math.max(0, -camera.y * z);
    const canonRight = Math.min(ROOM_W_PX, (worldW - camera.x) * z);
    const canonBottom = Math.min(ROOM_H_PX, (worldH - camera.y) * z);
    return {
      x: offsetX + canonLeft * scale,
      y: offsetY + canonTop * scale,
      w: Math.max(0, (canonRight - canonLeft) * scale),
      h: Math.max(0, (canonBottom - canonTop) * scale),
    };
  }

  function syncRoomFx() {
    const w = currentRoom.width ?? ROOM_W_PX;
    const h = currentRoom.height ?? ROOM_H_PX;
    arenaBg = createArenaBg(w, h);
    wallFx = createWallFx(currentRoom.walls);
    gridNodes = createGridNodeState(w, h);
    archiveFx = createArchiveFx(w, h);
  }

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

  // Sandbox-parity spawn for ambient bullets: pick one of the four
  // edges of `cfg.spawnArea`, place the bullet just inside it, aim
  // inward with ±60° spread (mirrors sandbox-game.ts:572 `spawnBullet`
  // verbatim except the bounds are the rectangle's edges instead of
  // the viewport's, and `bounces` is forced true).
  function spawnAmbientBullet(cfg: AmbientBulletField): void {
    const sz = settings.bullets.size;
    const h = sz / 2;
    const a = cfg.spawnArea;
    const edge = Math.floor(Math.random() * 4);
    const xRange = Math.max(0, a.w - 2 * h);
    const yRange = Math.max(0, a.h - 2 * h);
    let x = 0;
    let y = 0;
    let nx = 0;
    let ny = 0;
    if (edge === 0) {
      x = a.x + h + Math.random() * xRange;
      y = a.y + h;
      ny = 1;
    } else if (edge === 1) {
      x = a.x + a.w - h;
      y = a.y + h + Math.random() * yRange;
      nx = -1;
    } else if (edge === 2) {
      x = a.x + h + Math.random() * xRange;
      y = a.y + a.h - h;
      ny = -1;
    } else {
      x = a.x + h;
      y = a.y + h + Math.random() * yRange;
      nx = 1;
    }
    const baseAngle = Math.atan2(ny, nx);
    const offset = (Math.random() * 2 - 1) * (Math.PI / 3);
    const angle = baseAngle + offset;
    const speed = cfg.speed;
    while (bullets.length >= cfg.maxBullets) {
      const evicted = bullets.shift();
      if (evicted) releaseBullet(evicted);
    }
    bullets.push(
      acquireBullet(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        true,
      ),
    );
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
    registerJsonRooms(rooms);
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
    state.doorEnterCooldown = 0;
    state.failedSnapshot = null;
    state.deathFx = null;
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
    ambientSpawnTimer = 0;
    ambientInitialFillDone = false;
    worldLabelAge = 0;
    worldLabelStarted = false;
    tryAgainBounds = null;
    spawnPlayerInCurrentRoom();
    applyInitialKey();
    resetEyeState(player);
    snapCameraToRoom();
    syncRoomFx();
  }

  function transitionToRoom(id: string, viaBack = false) {
    const next = rooms.get(id);
    if (!next) return;
    currentRoom = next;
    bullets = [];
    rings = [];
    floatingTexts = [];
    lasers = [];
    currentKey = null;
    keyHeld = false;
    ambientSpawnTimer = 0;
    ambientInitialFillDone = false;
    worldLabelAge = 0;
    worldLabelStarted = false;
    // Lock door triggers for a beat so the freshly-spawned player
    // can't instantly re-enter the door they just came from.
    state.doorEnterCooldown = 0.7;
    if (viaBack) {
      // Returning to a previously-visited room — drop the player just
      // inside the forward door rather than at the default spawn so
      // they don't have to walk the full room again. The forward door
      // sits on the right wall; back-spawn is 60 px to its left along
      // its y, which clears both the door rect and the wall thickness.
      const fwd = currentRoom.door;
      if (fwd) {
        // Drop the player well clear of the door so they can't re-
        // trigger it the moment they step in. Combined with the
        // doorEnterCooldown above the back transition feels clean.
        player.x = fwd.x - 140;
        player.y = fwd.y;
        player.vx = 0;
        player.vy = 0;
      } else {
        spawnPlayerInCurrentRoom();
      }
    } else {
      spawnPlayerInCurrentRoom();
    }
    applyInitialKey();
    snapCameraToRoom();
    syncRoomFx();
    // Sentinel owns its own intro state — entering Room 5 lands the
    // boss in `state: "intro"` from the constructor; no external
    // priming is needed.
    state.prevSentinelState = currentRoom.id === "room5" ? "intro" : "none";
    // Music swap follows room id. Room 5 plays the single boss track
    // from public/audio/boss/; all other rooms keep the standard
    // "rooms" track.
    if (currentRoom.id === "room5") {
      state.prevBossPhase = 1;
      // Long crossfade — rooms track lingers as boss starts up so the
      // hand-off feels intentional, not a hard cut. Sentinel's own
      // 3.3 s intro phase covers the overlap.
      audio.playMusic("boss", 3.0);
    } else {
      state.prevBossPhase = 0;
      audio.playMusic("rooms", 2.0);
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
      window.location.href = import.meta.env.BASE_URL;
    },
  });

  // (The legacy Game Complete DOM overlay was removed when the boss
  // death sequence started routing to /epilogue.html instead — the
  // epilogue page now owns the "you won" screen and its own return
  // path to the main menu.)

  // Dev menu — F1 opens an overlay with a god-mode toggle and a
  // teleport-to-room list. transitionToRoom handles the heavy
  // lifting (camera snap, room rebuild, etc.) so the dev menu just
  // routes a click into it. Teleport disabled while the failed
  // overlay is up so the dev tool can't sneak past run state.
  const devMenu: DevMenu = createDevMenu({
    getGodMode: () => isGodMode(),
    setGodMode: (v) => setGodMode(v),
    getInstakill: () => isInstakill(),
    setInstakill: (v) => setInstakill(v),
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

  // In-game level editor (U4). Wrapped in DEV guard so the prod
  // bundle drops the entire editor module — the `editor` binding
  // is `null` at runtime, F3 / frame-loop gate / failRun guard
  // all use optional chaining to fall through cleanly.
  let editor: EditorHandle | null = null;
  if (import.meta.env.DEV) {
    editor = createEditor({
      getCurrentRoom: () => currentRoom,
      setCurrentRoom: (r) => {
        currentRoom = r;
      },
      getCamera: () => camera,
      getPools: () => ({ bullets, particles, rings, floatingTexts, lasers }),
      triggerSyncRoomFx: () => {
        syncRoomFx();
      },
      triggerSnapCamera: () => {
        snapCameraToRoom();
      },
      triggerSpawnPlayerInCurrentRoom: () => {
        spawnPlayerInCurrentRoom();
      },
      resetLastTime: () => {
        lastTime = performance.now();
      },
      resetRunStateForPlay: () => {
        // Fresh-play reset: same fields restartRun() resets that
        // would otherwise leak between Play sessions. We deliberately
        // skip clearedRoomIds / score so the run feels like a fresh
        // start but the editor state stays in the user's hands.
        state.runState = "playing";
        state.hp = 3;
        state.hitIframe = 0;
        state.hitVignette = 0;
        state.dashId = 0;
        state.deathFx = null;
        resetEyeState(player);
      },
    });
    // Expose for console-driven smoke-testing before U5 lands the UI.
    (window as unknown as { __editor: EditorHandle | null }).__editor = editor;
  }

  window.addEventListener("keydown", (e) => {
    audio.init();
    pickInitialMusic();
    const code = e.code;

    // Dev menu owns its own F1 / Esc handling. Short-circuit our
    // game-side keydown while it's open so Esc doesn't also pop the
    // pause overlay underneath, etc.
    if (devMenu.isOpen()) return;

    // F3 — editor toggle (DEV builds only; `editor` is null in prod).
    // Sits above the F2 perf overlay + pause-menu checks so the
    // editor stays togglable even while paused / failed, matching the
    // F2 hotkey's global feel.
    if (editor && code === "F3") {
      e.preventDefault();
      editor.toggle();
      keys.clear();
      return;
    }

    // F2 — toggle frame-time breakdown overlay. Independent of the
    // dev menu so we can profile while the menu is closed.
    if (code === "F2") {
      e.preventDefault();
      togglePerfOverlay();
      return;
    }

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
      pushParticle(
        particles,
        player.x,
        player.y,
        vx,
        vy,
        PLAYER_SIZE * sizeFactor,
        color,
        lifetime,
        isDash ? 15 : 8,
        isDash ? 6 : 3,
        PARTICLE_DRAG,
      );
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
    // Test-play deaths must not flip the run into the failed flow —
    // that would write a "best score" for the editor sandbox and
    // replace the failed-overlay over the editor's eventual inline
    // prompt (U5). Editor.exitToEditing() restores the snapshotted
    // currentRoom + clears pools, so dropping out of play here is
    // a clean reset to the editor's pre-Play state.
    if (editor?.isPlaying()) {
      editor.exitToEditing();
      return;
    }
    state.runState = "failed";
    eyeStartClosing(player);
    audio.play.runEnd();
    state.deathFx = createDeathFx({
      x: player.x,
      y: player.y,
      size: PLAYER_SIZE,
      ringColor: profile.outerRing,
      irisColor: profile.iris,
    });
    triggerShake(14, 0.45);
    triggerScreenFlash(0.3, 0.55);
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

  // Black overlay rendered above everything when the epilogue
  // hand-off starts. Persists until navigation completes, so the
  // intermediate frames don't flicker the boss room while the new
  // page loads.
  let epilogueFadeStart = 0;
  let epilogueNavigating = false;
  function navigateToEpilogue(): void {
    if (epilogueNavigating) return;
    epilogueNavigating = true;
    epilogueFadeStart = performance.now();
    // Hold the curtain for 800 ms so the fade can play out before the
    // browser nav (which can be near-instant on the local dev server).
    window.setTimeout(() => {
      window.location.href = `${import.meta.env.BASE_URL}epilogue.html`;
    }, 800);
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
      // Hand off to the epilogue page — fade to black inline first so
      // the navigation lands on a black canvas (no white flash from
      // the browser's default transition), then go. The epilogue runs
      // its own narrator beats + "to be continued" room scene; once
      // the player taps through, it routes back to the main menu.
      state.runState = "completed";
      navigateToEpilogue();
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

  // Boss now uses a single track across all phases — phase
  // transitions no longer crossfade the music. Function kept as a
  // no-op so the existing frame-loop call site doesn't need a
  // conditional removed; the bossPhase bookkeeping still happens via
  // state.prevBossPhase for other effects.
  function reconcileBossMusic(sentinel: Sentinel): void {
    const phase = sentinel.bossPhase;
    if (state.prevBossPhase === phase) return;
    state.prevBossPhase = phase;
  }

  // First-user-gesture music kick. Routes to "boss" if the player is
  // already in Room 5, otherwise the standard "rooms" track.
  function pickInitialMusic(): void {
    const key = currentRoom.id === "room5" ? "boss" : "rooms";
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
    perfFrameStart(now);
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (
      menu.isOpen() ||
      devMenu.isOpen() ||
      (editor?.isPaused() ?? false)
    ) {
      render();
      requestAnimationFrame(frame);
      return;
    }

    perfBegin("update");

    // Post-tutorial fade-in and boot thought. Both only tick when the
    // player arrived from tutorial; menu entries leave both at zero.
    if (roomsFadeIn > 0) {
      roomsFadeIn = Math.max(0, roomsFadeIn - dt / ROOMS_FADE_IN_DURATION_SEC);
    }
    if (
      arrivedFromTutorial &&
      !isScrambleTextDone(roomsBootThoughtAge, roomsBootThoughtSchedule)
    ) {
      roomsBootThoughtAge += dt;
    }
    // Scramble world-labels (e.g. Room 1's INFECTED ZONE sign) play
    // a one-shot intro. The timer only starts once the label first
    // enters the visible viewport — the player has to walk close
    // enough for the camera to bring the label into frame. After
    // that the intro runs through and the timer stops at the
    // schedule's end; the next room entry resets both flags.
    const scrambleLabels = currentRoom.worldLabels?.filter((l) => l.scramble);
    if (scrambleLabels && scrambleLabels.length > 0) {
      if (!worldLabelStarted) {
        const viewLeft = camera.x;
        const viewRight = camera.x + ROOM_W_PX;
        const viewTop = camera.y;
        const viewBottom = camera.y + ROOM_H_PX;
        for (const l of scrambleLabels) {
          if (
            l.x >= viewLeft &&
            l.x <= viewRight &&
            l.y >= viewTop &&
            l.y <= viewBottom
          ) {
            worldLabelStarted = true;
            break;
          }
        }
      }
      if (
        worldLabelStarted &&
        !isScrambleTextDone(worldLabelAge, WORLD_LABEL_SCRAMBLE_SCHEDULE)
      ) {
        worldLabelAge += dt;
      }
    }

    bgFx.update(dt);

    // age FX always so they finish out even after fail
    for (const t of floatingTexts) {
      t.age += dt;
      t.y += t.vy * dt;
    }
    compactFloatingTexts(floatingTexts, (t) => t.age < t.lifetime);
    for (const r of rings) r.age += dt;
    compactRings(rings, (r) => r.age < r.lifetime);
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
    compactParticles(particles, (p) => p.age < p.lifetime);

    if (state.clearFlash > 0) {
      state.clearFlash = Math.max(0, state.clearFlash - dt);
    }

    if (currentRoom.door && currentRoom.door.state === "open") {
      currentRoom.door.pulse += dt;
    }
    if (currentRoom.backDoor && currentRoom.backDoor.state === "open") {
      currentRoom.backDoor.pulse += dt;
    }

    if (state.runState === "failed" || state.runState === "completed") {
      if (state.hitVignette > 0) {
        state.hitVignette = Math.max(0, state.hitVignette - dt);
      }
      // Decay shake/flash so the failRun-triggered punch winds down
      // instead of holding indefinitely.
      if (state.screenShakeRemaining > 0) {
        state.screenShakeRemaining = Math.max(0, state.screenShakeRemaining - dt);
      }
      if (state.screenFlashRemaining > 0) {
        state.screenFlashRemaining = Math.max(0, state.screenFlashRemaining - dt);
      }
      if (state.deathFx) updateDeathFx(state.deathFx, dt);
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
      compactParticles(particles, (p) => p.age < p.lifetime);
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

    // Background + wall FX advance with realtime dt so the arena keeps
    // breathing even when the boss / cinematic timeScale slows world sim.
    updateArenaBg(arenaBg, dt);
    updateWallFx(wallFx, dt, currentRoom.walls);
    updateEnergyBackground(energyBg, dt, viewW, viewH);
    updateBackgroundTexts(bgText, dt, ctx, viewW, viewH, computeArenaBounds());
    updateGridNodes(gridNodes, dt);
    updateArchiveFx(archiveFx, dt, player.x, player.y);
    tickScanlines(dt);

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
    const backDoor = currentRoom.backDoor;
    const backDoorOpen = backDoor?.state === "open";
    const inBackDoorY =
      backDoorOpen && backDoor
        ? player.y > backDoor.y - backDoor.h / 2 - half &&
          player.y < backDoor.y + backDoor.h / 2 + half
        : false;
    if (player.x < minX && !inBackDoorY) {
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
    perfBegin("upd_enemies");
    const awarenessTrigger = { particles, rings };
    for (const e of currentRoom.enemies) {
      updateEnemyAwareness(e, player.x, player.y, dt, awarenessTrigger);
    }
    for (const e of currentRoom.enemies) e.update(enemyCtx);
    perfEnd("upd_enemies");

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

    // Ambient bullet field — spawn-from-edge loop mirroring sandbox's
    // `spawnBullet` + initial-fill ramp (sandbox-game.ts:1221+). Active
    // only when the current room sets `ambientBullets`. All bullets
    // produced here carry `bounces=true`; turret/sentinel bullets keep
    // their existing `bounces=false` so the bounce branch below is a
    // no-op for them.
    if (currentRoom.ambientBullets) {
      const cfg = currentRoom.ambientBullets;
      if (!ambientInitialFillDone && bullets.length >= cfg.maxBullets) {
        ambientInitialFillDone = true;
      }
      const baseInterval = cfg.spawnIntervalMs / 1000;
      const filling =
        !ambientInitialFillDone && bullets.length < cfg.maxBullets;
      const effInterval = filling ? 0.04 : baseInterval;
      const perTick = filling ? 4 : 1;
      ambientSpawnTimer += dt;
      while (
        ambientSpawnTimer >= effInterval &&
        bullets.length < cfg.maxBullets
      ) {
        ambientSpawnTimer -= effInterval;
        for (
          let i = 0;
          i < perTick && bullets.length < cfg.maxBullets;
          i++
        ) {
          spawnAmbientBullet(cfg);
        }
      }
    }

    // bullet movement + wall handling (bounce when `bounces`, expire
    // otherwise — mirrors sandbox-game.ts:1250 with walls in place of
    // viewport edges).
    perfBegin("upd_bullets");
    const bulletRadius = settings.bullets.size / 2;
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.bounces) {
        bounceBulletOffWalls(b, currentRoom.walls, bulletRadius);
      }
      pushTrailSample(b);
    }
    // Bullet bounds use the CURRENT room's world dimensions, not the
    // canonical 1200x800 viewport. In a wide camera room (Room 4 is
    // 3600 wide) bullets fired from x=1900+ would otherwise be
    // filtered the moment they leave the screen letterbox bounds.
    const worldW = currentRoom.width ?? ROOM_W_PX;
    const worldH = currentRoom.height ?? ROOM_H_PX;
    // In-place compaction — releases dead bullets back to the pool
    // (lib/bullets.ts) and reuses the array, so no per-frame array
    // allocation + no GC pressure on the Float32Array trail buffers.
    compactBullets(bullets, (b) => {
      if (b.x < -40 || b.x > worldW + 40) return false;
      if (b.y < -40 || b.y > worldH + 40) return false;
      // Bouncing bullets are kept inside the room by the resolve pass
      // above; the wall-expiry path is reserved for non-bouncing
      // enemy fire.
      if (b.bounces) return true;
      const hitWall = findContainingWall(b.x, b.y, currentRoom.walls);
      if (hitWall) {
        addWallImpact(wallFx, b.x, b.y);
        return false;
      }
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

    // dash-through bullets — LIGHT-tier impact feedback + flat +100
    // score per bullet crossed (sandbox port; doubling/multiplier
    // intentionally stripped). Dedup per dash via dashedThroughId so
    // a single bullet can't fire twice as it crosses the player.
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
          state.score += 100;
          addFloatingText(floatingTexts, "+100", b.x, b.y - 10, {
            size: 18,
            color: "#ffffff",
            lifetime: 0.6,
          });
        }
      }
    }

    // near-miss — bullet passes within `PLAYER_SIZE + 20` of the
    // player while moving > 50 px/s and not in dash i-frame, without
    // an AABB hit. Each bullet flagged once via `b.nearMissed`.
    // Mirrors sandbox-game.ts:1368 minus the multiplier scaling.
    if (player.dashIframeTime <= 0) {
      const playerSpeed = Math.hypot(player.vx, player.vy);
      if (playerSpeed > 50) {
        const ph = PLAYER_SIZE / 2;
        const bh = settings.bullets.size / 2;
        const nearRadius = PLAYER_SIZE + 20;
        const nearRadiusSq = nearRadius * nearRadius;
        for (const b of bullets) {
          if (b.nearMissed) continue;
          const aabbHit =
            Math.abs(b.x - player.x) < ph + bh &&
            Math.abs(b.y - player.y) < ph + bh;
          if (aabbHit) continue;
          const dx = b.x - player.x;
          const dy = b.y - player.y;
          if (dx * dx + dy * dy < nearRadiusSq) {
            b.nearMissed = true;
            state.score += 50;
            addFloatingText(floatingTexts, "+50", b.x, b.y - 10, {
              size: 16,
              color: "#facc15",
              lifetime: 0.45,
            });
            addRing(rings, player.x, player.y, {
              startR: PLAYER_SIZE / 2 + 6,
              endR: PLAYER_SIZE / 2 + 28,
              color: "#facc15",
              lifetime: 0.1,
            });
          }
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
    perfEnd("upd_bullets");

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

    // Tick down door cooldown; while it's > 0 the player can't
    // re-trigger any door (covers both directions of a transition).
    if (state.doorEnterCooldown > 0) {
      state.doorEnterCooldown = Math.max(0, state.doorEnterCooldown - dt);
    }
    // door overlap → transition
    if (
      state.doorEnterCooldown <= 0 &&
      currentRoom.door &&
      currentRoom.door.state === "open" &&
      currentRoom.nextRoomId &&
      playerOverlapsDoor(currentRoom.door, player.x, player.y, half)
    ) {
      transitionToRoom(currentRoom.nextRoomId);
    }
    // back-door overlap → return to previous room
    if (
      state.doorEnterCooldown <= 0 &&
      currentRoom.backDoor &&
      currentRoom.backDoor.state === "open" &&
      currentRoom.prevRoomId &&
      playerOverlapsDoor(currentRoom.backDoor, player.x, player.y, half)
    ) {
      transitionToRoom(currentRoom.prevRoomId, true);
    }

    // follow camera — always centred on the player. Runs even on
    // the failed-overlay branch since the eye still updates there
    // (see early-return path).
    updateCamera(
      camera,
      player.x,
      player.y,
      ROOM_W_PX,
      ROOM_H_PX,
      roomBounds(),
    );

    perfEnd("update");
    render();
    requestAnimationFrame(frame);
  }

  // ------- render -------

  function render() {
    // letterbox: clear in CSS pixels, then transform into room space
    perfBegin("bg");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, viewW, viewH);
    // synthwave pulse drawn in screen space so it lives behind the world
    bgFx.drawBack(ctx, viewW, viewH);
    perfEnd("bg");

    // Energy + text background passes, both clipped out of the visible
    // arena rect so they only show in the letterbox / camera margins.
    const arenaBounds = computeArenaBounds();
    perfBegin("energy");
    drawEnergyBackground(ctx, energyBg, viewW, viewH, arenaBounds);
    perfEnd("energy");
    perfBegin("bgtext");
    drawBackgroundTexts(ctx, bgText, viewW, viewH, arenaBounds);
    perfEnd("bgtext");

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

    // Camera always scrolls the world so the player stays centred,
    // regardless of arena size. Editor-mode zoom is applied here so
    // every world-space draw call below scales transparently — order
    // is scale-then-translate so the world-to-screen formula matches
    // editor cursor-pivot math: screen = (world - camera) * zoom * scale + offset.
    ctx.save();
    if (camera.zoom !== 1) ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // DEEP FIELD background — radial spark + vignette anchored on
    // the player (the only consciousness still burning in the dead
    // network), parallax dots, grid pulses, radar sweeps.
    perfBegin("arenabg");
    drawArenaBg(ctx, arenaBg, { x: player.x, y: player.y });
    perfEnd("arenabg");

    // Minimalist world-space grid. Clamped to the room's logical
    // bounds so it stops at the perimeter walls and never bleeds into
    // the letterbox. Stateful node pass renders alive/faint/dead
    // intersections — most are dark by default, a handful flicker.
    perfBegin("grid");
    drawRoomGrid(
      ctx,
      currentRoom.width ?? ROOM_W_PX,
      currentRoom.height ?? ROOM_H_PX,
      gridNodes,
    );
    perfEnd("grid");

    // Archive ambience — ghost text + phantom visitors painted just
    // above the floor so they read as part of the environment, not
    // floating overlays.
    drawArchiveFx(ctx, archiveFx);

    perfBegin("walls");
    drawWalls(ctx, currentRoom.walls);
    drawWallOverlay(ctx, wallFx, currentRoom.walls);
    if (currentRoom.door) drawDoor(ctx, currentRoom.door);
    if (currentRoom.backDoor) drawDoor(ctx, currentRoom.backDoor);
    // World-space signage (e.g. "INFECTED ZONE") — drawn over walls
    // and the floor but under entities so the player + bullets pass
    // on top. `scramble` labels run the alien-glyphs intro + glitch
    // fade-out keyed off `worldLabelAge`; plain labels render flat.
    if (currentRoom.worldLabels) {
      for (const l of currentRoom.worldLabels) {
        const color = l.color ?? "#ff2d55";
        const size = l.size ?? 32;
        if (l.scramble) {
          drawScrambleText(
            ctx,
            l.text,
            worldLabelAge,
            WORLD_LABEL_SCRAMBLE_SCHEDULE,
            l.x,
            l.y,
            {
              color,
              shadowColor: color,
              shadowBlur: 14,
              font: `${size}px 'Space Mono', 'Courier New', monospace`,
            },
          );
        } else {
          ctx.save();
          ctx.fillStyle = color;
          ctx.font = `${size}px 'Space Mono', 'Courier New', monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
          ctx.globalAlpha = 0.7;
          ctx.fillText(l.text, l.x, l.y);
          ctx.restore();
        }
      }
    }
    perfEnd("walls");

    // detection rings (drawn under everything so they read as a
    // ground-level radar pulse, not an overlay on top of the enemy)
    perfBegin("detection");
    for (const e of currentRoom.enemies) {
      drawEnemyDetection(ctx, e, player.x, player.y);
    }
    perfEnd("detection");

    // lasers (under enemies so the beam appears to emerge from behind)
    perfBegin("lasers");
    for (const l of lasers) drawLaser(ctx, l);
    perfEnd("lasers");

    // enemies
    perfBegin("enemies");
    for (const e of currentRoom.enemies) e.draw(ctx);
    perfEnd("enemies");


    // bullets — trail pass then live pass.
    // Off-screen cull bounds in world coords. Room 1 / Room 4 are
    // 3600 / 8000 px wide and many bullets travel far outside the
    // camera viewport. Skipping the trail loop + sprite blit for
    // off-screen bullets is the biggest per-frame draw-call save
    // these corridor rooms can get.
    const cullMargin = 80;
    // Visible world rect: zoom < 1 expands what's on-screen, zoom > 1
    // shrinks it. World width visible = ROOM_W_PX / zoom.
    const cullViewW = ROOM_W_PX / camera.zoom;
    const cullViewH = ROOM_H_PX / camera.zoom;
    const cullLeft = camera.x - cullMargin;
    const cullRight = camera.x + cullViewW + cullMargin;
    const cullTop = camera.y - cullMargin;
    const cullBottom = camera.y + cullViewH + cullMargin;
    const bSize = settings.bullets.size;
    const bColor = settings.bullets.color;
    perfBegin("trails");
    ctx.save();
    ctx.fillStyle = bColor;
    ctx.shadowBlur = 0;
    for (const b of bullets) {
      if (b.trailCount === 0) continue;
      if (
        b.x < cullLeft ||
        b.x > cullRight ||
        b.y < cullTop ||
        b.y > cullBottom
      ) continue;
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
    perfEnd("trails");
    perfBegin("bullets");
    const bulletSprite = getBulletSprite(bColor, bSize);
    const bulletOffset = getBulletSpriteOffset(bSize);
    for (const b of bullets) {
      if (
        b.x < cullLeft ||
        b.x > cullRight ||
        b.y < cullTop ||
        b.y > cullBottom
      ) continue;
      ctx.drawImage(bulletSprite, b.x - bulletOffset, b.y - bulletOffset);
    }
    perfEnd("bullets");

    // particles — flat path always, plus off-screen cull (reuses the
    // bullet cull rect since they share the camera-relative bounds).
    perfBegin("particles");
    ctx.save();
    ctx.shadowBlur = 0;
    for (const p of particles) {
      if (
        p.x < cullLeft ||
        p.x > cullRight ||
        p.y < cullTop ||
        p.y > cullBottom
      ) continue;
      const t = p.age / p.lifetime;
      const alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
      const sz = Math.max(0.5, p.initialSize * (1 - t));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.restore();
    perfEnd("particles");

    // player
    const pSize = PLAYER_SIZE;

    let drawPlayer = true;
    if (state.hitIframe > 0) {
      drawPlayer = Math.floor(state.hitIframe * 10) % 2 === 0;
    }
    if (state.deathFx && state.deathFx.age > 0.04) drawPlayer = false;

    if (drawPlayer) {
      perfBegin("player");
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
      perfEnd("player");
    }

    // rings — impact FX. Wide dim outer stroke + bright inner stroke
    // is roughly 10× cheaper than shadowBlur in Safari / WebKit while
    // looking nearly identical, especially during the rapid alpha
    // fade. Boss attacks emit 10+ rings at once on radial bursts +
    // mine detonations, so the shadow path was a real cost.
    perfBegin("rings");
    for (const ring of rings) {
      const t = ring.age / ring.lifetime;
      const r = ring.startR + (ring.endR - ring.startR) * t;
      const alpha = 1 - t;
      const lwStart = ring.startLineWidth ?? 2;
      const lwEnd = ring.endLineWidth ?? lwStart;
      const lineWidth = lwStart + (lwEnd - lwStart) * t;
      const liveAlpha = Math.max(0, alpha);
      ctx.save();
      ctx.strokeStyle = ring.color;
      if (ring.glowBlur && ring.glowBlur > 0) {
        // Dim wide halo first — fakes the Gaussian fall-off cheaply.
        ctx.globalAlpha = liveAlpha * 0.25;
        ctx.lineWidth = lineWidth + ring.glowBlur * 1.5;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Bright inner stroke on top.
      ctx.globalAlpha = liveAlpha;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    perfEnd("rings");

    // key pickup (drawn above bullets / particles, below HUD)
    if (currentKey && !currentKey.collected) drawKey(ctx, currentKey);

    drawFloatingTexts(ctx, floatingTexts);

    // First-arrival thought — only renders when arrivedFromTutorial,
    // and only in room1 (where the player lands). Stays under the
    // camera transform so the text sits anchored just under the
    // hero in world space.
    if (arrivedFromTutorial && currentRoom.id === "room1") {
      drawScrambleText(
        ctx,
        ROOMS_BOOT_THOUGHT_TEXT,
        roomsBootThoughtAge,
        roomsBootThoughtSchedule,
        player.x,
        player.y + 80,
      );
    }

    // Death cinematic draws in world space so it tracks the player's
    // last position even in scrolling rooms.
    if (state.deathFx) drawDeathFx(ctx, state.deathFx);

    ctx.restore();

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

    // ambient dust drifts in screen space so it tracks the camera as
    // far-away particles instead of sticking to room coordinates
    bgFx.drawFront(ctx);

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

    post.apply(ctx, DEFAULT_POST);

    drawHUD();
    drawBossOverlay();
    drawGodModeBadge(ctx, viewW);
    drawFpsOverlay(ctx, viewW);
    drawPerfOverlay(ctx, viewW);
    perfFrameEnd(performance.now());

    if (state.runState === "failed" && shouldShowDeathOverlay(state.deathFx)) {
      drawFailedOverlay();
    }

    drawScanlines(ctx, viewW, viewH);

    // Post-tutorial fade-in — sits ON TOP of everything (HUD, scan
    // lines, vignettes) so the entire screen comes up from black
    // smoothly when the player arrives from the tutorial's outro
    // fade. No-op when entering rooms from the menu.
    if (roomsFadeIn > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, roomsFadeIn)})`;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    // Boss-epilogue hand-off curtain. Rendered above everything else;
    // ramps to fully black over 800 ms so the navigation to
    // /epilogue.html lands on a black canvas (matching the epilogue's
    // own opening fadein), no flash, no white frames.
    if (epilogueNavigating) {
      const elapsed = (performance.now() - epilogueFadeStart) / 1000;
      const a = Math.min(1, elapsed / 0.7);
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }
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
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const cx = viewW / 2;
    const heartsY = 16;
    const heartSpacing = 22;

    // SCORE (top-left). Label small + value in a larger monospace
    // below, so dash-through "+100" and near-miss "+50" pops update
    // a visibly running total.
    ctx.textAlign = "left";
    ctx.globalAlpha = 0.65;
    ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("SCORE", 16, heartsY);
    ctx.globalAlpha = 0.95;
    ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(state.score.toLocaleString("en-US"), 16, heartsY + 16);
    ctx.textAlign = "center";
    ctx.globalAlpha = 0.85;

    // HP — three hearts, centered.
    ctx.globalAlpha = 0.85;
    ctx.font = "600 22px system-ui, -apple-system, sans-serif";
    const heartsStart = cx - heartSpacing;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < state.hp ? "#ef4444" : "rgba(239,68,68,0.18)";
      ctx.fillText("♥", heartsStart + i * heartSpacing, heartsY);
    }

    // Room — single line directly below the hearts.
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
    const roomY = heartsY + 34;
    ctx.globalAlpha = 0.65;
    ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    if (isBoss) {
      ctx.fillStyle = PALETTE.bullet;
      ctx.fillText(`${roomNum} / ${ROOM_TOTAL} — BOSS`, cx, roomY);
    } else {
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(`${roomNum} / ${ROOM_TOTAL}`, cx, roomY);
    }
    ctx.globalAlpha = 0.85;

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
      ctx.font = "600 11px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      // Below the room number so the stacked HP/room block stays
      // visually atomic and the awareness state reads as a separate
      // alert below it.
      ctx.fillText(text, viewW / 2, 16 + 34 + 18);
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
  btn.href = import.meta.env.BASE_URL + "tutorial.html";
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
