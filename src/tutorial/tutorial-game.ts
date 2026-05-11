import { audio } from "../lib/audio";
import { createDevMenu, type DevMenu } from "../lib/dev-menu";
import {
  drawGodModeBadge,
  isGodMode,
  setGodMode,
} from "../lib/god-mode";
import { type Bullet, pushTrailSample } from "../lib/bullets";
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
  formatKeybindLabel,
  isActionPressed,
  isAnyBoundCode,
  loadKeybinds,
  type KeybindProfile,
} from "../lib/keybinds";
import {
  drawEnemyDetection,
  updateEnemyAwareness,
} from "../lib/enemies/awareness";
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
  type FloatingText,
  type Particle,
  type Ring,
  addFloatingText,
  drawFloatingTexts,
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
import { BackgroundFx } from "../lib/bg-fx";
import { drawFpsOverlay, recordFrame } from "../lib/fps-meter";
import { createPauseMenu } from "../lib/pause-menu";
import { PostProcessor, DEFAULT_POST } from "../lib/postprocess";
import { type Bounds, hitBounds } from "../lib/types";
import {
  createEnergyBackground,
  drawEnergyBackground,
  updateEnergyBackground,
  type ArenaScreenBounds,
  type EnergyBackground,
} from "../lib/background-energy";
import {
  addWallImpact,
  createWallFx,
  drawWallOverlay,
  drawWalls,
  findContainingWall,
  resolvePlayerWallCollisions,
  updateWallFx,
  type Wall,
  type WallFx,
} from "../lib/walls";
import { TrainingDummy } from "../lib/enemies/training-dummy";
import { createMarker } from "../lib/markers";
import { buildRoom0 } from "./room0";
import { buildRoom1 } from "./room1";
import { buildRoom2 } from "./room2";
import { buildRoom3 } from "./room3";
import { buildRoom4 } from "./room4";
import { buildRoomIntro } from "./roomIntro";
import {
  drawScrambleText,
  isScrambleTextDone,
  makeScrambleSchedule,
  type ScrambleSchedule,
} from "../lib/scramble-text";
import {
  createVoidBg,
  drawVoidBg,
  tickVoidBg,
  type VoidBgState,
} from "../lib/void-bg";
import {
  drawMarker,
  markerOverlapsPlayer,
  tickMarker,
} from "../lib/markers";
import type { Room } from "../lib/room";

// Canonical letterbox viewport — same as rooms-game.ts; markers /
// pillar walls / camera all assume 1200x800 logical space.
const ROOM_W_PX = 1200;
const ROOM_H_PX = 800;

const ACCEL_FACTOR = 9;
const FRICTION = 8.0;
const HIT_IFRAME = 1.0;
const HIT_VIGNETTE = 0.2;
const TURRET_KILL_SCORE = 500;
const WATCHER_KILL_SCORE = 800;
const HUNTER_KILL_SCORE = 600;
const LASER_DODGE_SCORE = 50;
const LASER_HIT_PADDING = 6; // px added to player half for laser collision
const LASER_FRIENDLY_FIRE_HALF_WIDTH = 8; // matches firing-beam visual width
const FRIENDLY_FIRE_BONUS = 200;
const SCREEN_SHAKE_DURATION_SEC = 0.2;
const SCREEN_SHAKE_PX = 4;
// Tutorial has 4 rooms — Room 0 (controls intro), 1 (Turret),
// 2 (Watcher), 3 (Hunter). HUD label is "TUTORIAL — ROOM N / 4".
const ROOM_TOTAL = 4;
const TUTORIAL_COMPLETED_KEY = "dash-proto:tutorial-completed";
const ROOM_CLEAR_FLASH = 0.2;
const ROOMS_BEST_KEY = "dash-proto:tutorial-best";

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
  deathFx: DeathFx | null;
};

export function start(canvas: HTMLCanvasElement): void {
  const rawCtx = canvas.getContext("2d");
  if (!rawCtx) return;
  const ctx: CanvasRenderingContext2D = rawCtx;
  const post = new PostProcessor();
  const bgFx = new BackgroundFx();

  const settings: Settings = loadSettings();
  // Keybinds — global profile from the landing-page Controls
  // overlay. Re-read on `storage` so rebinds in another tab take
  // effect without a reload.
  let keybinds: KeybindProfile = loadKeybinds();
  window.addEventListener("storage", () => {
    keybinds = loadKeybinds();
  });

  audio.setMasterVolume(settings.audio.master);
  audio.setSfxVolume(settings.audio.sfx);
  audio.setMusicVolume(settings.audio.music);
  // Shared sandbox / tutorial loop on the "gameplay" key — same file
  // as sandbox, so the same buffer URL is registered. Eager play on
  // start() tries to autoplay; cold visits hit the gesture fallback
  // in the keydown / click handlers below.
  audio.setMusicTrack(
    "gameplay",
    encodeURI(import.meta.env.BASE_URL + "audio/gameplay/Vectrix Drift.mp3"),
  );
  audio.playMusic("gameplay", 1.0);
  audio.init();

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
  // Number of tutorial markers reached this room — purely a counter
  // for HUD / phase-progress checks. Reset on transition; advanced
  // by the marker block in the sim loop when an unreached marker
  // overlaps the player.
  let markerIndex = 0;

  // Tutorial Room 0 phase machine. Three phases (movement → dash →
  // combat → complete), each owning its own world objects (markers,
  // dash wall, training dummy). Phase transitions splice items in
  // and out of currentRoom.{markers,walls,enemies}.
  type Room0Phase = "movement" | "dash" | "combat" | "complete";
  let room0Phase: Room0Phase = "movement";
  let room0DashWall: Wall | null = null;
  let room0Dummy: TrainingDummy | null = null;
  let room0DummyHpAtLastProgress = 0;

  // Tutorial hint banner — bottom-center text with keycap glyphs and
  // a fade-in/out + idle pulse. Rendered after the HUD in screen
  // coords so it sits above everything else.
  type HintState = "idle" | "showing" | "visible" | "hiding";
  let hintText: string | null = null;
  let hintState: HintState = "idle";
  let hintAge = 0;
  let hintPendingText: string | null = null;
  const HINT_FADE_IN_SEC = 0.3;
  const HINT_FADE_OUT_SEC = 0.2;
  // Pale cyan reads as a "tutorial UI" colour — distinct from the
  // canary-yellow we used to show, which competed with the player's
  // own glow. Keycaps and the marker glyphs share this hue so the
  // whole tutorial layer lives in one tonal family.
  const HINT_TEXT_COLOR = "#7dd3fc";
  const HINT_KEYCAP_FILL = "#f0f9ff";
  const HINT_BACKPLATE_COLOR = "rgba(10, 14, 26, 0.85)";
  const HINT_GLOW_BLUR = 6;

  function showHint(text: string): void {
    if (hintState === "idle" || !hintText) {
      hintText = text;
      hintState = "showing";
      hintAge = 0;
      hintPendingText = null;
    } else {
      hintPendingText = text;
      if (hintState !== "hiding") {
        hintState = "hiding";
        hintAge = 0;
      }
    }
  }
  function tickHint(dt: number): void {
    if (hintState === "idle") return;
    hintAge += dt;
    if (hintState === "showing" && hintAge >= HINT_FADE_IN_SEC) {
      hintState = "visible";
      hintAge = 0;
    } else if (hintState === "hiding" && hintAge >= HINT_FADE_OUT_SEC) {
      if (hintPendingText) {
        hintText = hintPendingText;
        hintPendingText = null;
        hintState = "showing";
        hintAge = 0;
      } else {
        hintState = "idle";
        hintText = null;
      }
    }
  }

  function room0Enter(phase: Room0Phase): void {
    room0Phase = phase;
    if (phase === "movement") {
      // Initial state — Room 0 already ships with the four direction
      // markers; just queue the hint. Key labels are pulled from the
      // current keybind profile so a player who rebound WASD to QWES
      // sees "USE [Q][A][W][E][S] TO MOVE" instead of being lied to.
      const upK = formatKeybindLabel(keybinds.moveUp.primary);
      const leftK = formatKeybindLabel(keybinds.moveLeft.primary);
      const downK = formatKeybindLabel(keybinds.moveDown.primary);
      const rightK = formatKeybindLabel(keybinds.moveRight.primary);
      showHint(`USE [${upK}][${leftK}][${downK}][${rightK}] TO MOVE`);
    } else if (phase === "dash") {
      // Replace movement markers with a single goal beyond the wall.
      currentRoom.markers = [createMarker(900, 400, 1, "→")];
      markerIndex = 0;
      // Vertical wall spanning the full arena height — only way
      // through is a dash. The `dashable` flag makes
      // `wallsForCollision` filter it out while dashIframeTime > 0
      // and `drawWalls` paints it with the canonical cyan dashed
      // outline so the dash colour reads as "phase through" without
      // copy.
      room0DashWall = { x: 585, y: 0, w: 30, h: 800, dashable: true };
      currentRoom.walls.push(room0DashWall);
      const dashK = formatKeybindLabel(keybinds.dash.primary);
      showHint(`PRESS [${dashK}] TO DASH`);
    } else if (phase === "combat") {
      // Dispersion effect along the wall before clearing — burst of
      // bgGrid-coloured particles makes the obstacle "vaporize"
      // instead of popping out of existence.
      if (room0DashWall) {
        const w = room0DashWall;
        for (let i = 0; i < 12; i++) {
          const px = w.x + w.w / 2 + (Math.random() - 0.5) * w.w;
          const py = w.y + Math.random() * w.h;
          const speed = 80 + Math.random() * 140;
          const angle = Math.random() * Math.PI * 2;
          particles.push({
            x: px,
            y: py,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            initialSize: 4,
            color: PALETTE.bgGrid,
            age: 0,
            lifetime: 0.55,
            glowStrong: 8,
            glowSoft: 3,
            drag: 0.94,
          });
        }
        rings.push({
          x: w.x + w.w / 2,
          y: w.y + w.h / 2,
          age: 0,
          lifetime: 0.3,
          startR: w.h * 0.25,
          endR: w.h * 0.55,
          color: "#cbd5e1",
          startLineWidth: 2,
          endLineWidth: 0.5,
          glowBlur: 12,
        });
      }
      currentRoom.markers = undefined;
      markerIndex = 0;
      if (room0DashWall) {
        currentRoom.walls = currentRoom.walls.filter(
          (w) => w !== room0DashWall,
        );
        room0DashWall = null;
      }
      const dummy = new TrainingDummy(600, 400);
      room0Dummy = dummy;
      room0DummyHpAtLastProgress = dummy.hp;
      currentRoom.enemies.push(dummy);
      showHint("DASH THROUGH THE TARGET 3 TIMES TO DESTROY IT");
    } else {
      // complete — open the door, swap to the proceed prompt.
      if (currentRoom.door) currentRoom.door.state = "open";
      state.clearedRoomIds.add(currentRoom.id);
      audio.play.multUp(5);
      showHint("WELL DONE — PROCEED →");
    }
  }

  function tickRoom0(): void {
    if (currentRoom.id !== "room0") return;
    const markers = currentRoom.markers;
    if (
      room0Phase === "movement" &&
      markers &&
      markers.length > 0 &&
      markers.every((m) => m.reached)
    ) {
      room0Enter("dash");
    } else if (
      room0Phase === "dash" &&
      markers &&
      markers.length > 0 &&
      markers.every((m) => m.reached)
    ) {
      room0Enter("combat");
    } else if (room0Phase === "combat" && room0Dummy) {
      // Reset the hint pulse timer on dummy damage progress.
      if (room0Dummy.hp < room0DummyHpAtLastProgress) {
        hintAge = 0;
        room0DummyHpAtLastProgress = room0Dummy.hp;
      }
      if (room0Dummy.isDead()) {
        room0Enter("complete");
      }
    }
  }

  type HintToken = { kind: "text" | "key"; value: string };
  function parseHintTokens(text: string): HintToken[] {
    const tokens: HintToken[] = [];
    // Bracketed token = a keycap glyph. Body can now be any
    // non-bracket sequence so rebound keys render too (`[SPACE]`,
    // `[L SHIFT]`, `[F1]`, arrow glyphs, etc.) — `formatKeybindLabel`
    // emits multi-char names for many codes.
    const re = /\[([^\]]+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last)
        tokens.push({ kind: "text", value: text.slice(last, m.index) });
      tokens.push({ kind: "key", value: m[1] });
      last = m.index + m[0].length;
    }
    if (last < text.length)
      tokens.push({ kind: "text", value: text.slice(last) });
    return tokens;
  }

  function roundedRectPath(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function drawTutorialHint(): void {
    if (hintState === "idle" || !hintText) return;
    let alpha = 1;
    let slideY = 0;
    if (hintState === "showing") {
      const t = Math.min(1, hintAge / HINT_FADE_IN_SEC);
      alpha = t;
      slideY = (1 - t) * 8;
    } else if (hintState === "hiding") {
      const t = Math.min(1, hintAge / HINT_FADE_OUT_SEC);
      alpha = 1 - t;
      slideY = -t * 8;
    }

    const tokens = parseHintTokens(hintText);
    const fontSize = 28;
    const padX = 18;
    const padY = 10;
    const keyMinW = 32;
    const keyTextPad = 16;
    const keyH = 32;
    const keyGap = 4;
    const keyFont = "600 28px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.save();
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const widths: number[] = [];
    let totalContent = 0;
    for (const tk of tokens) {
      if (tk.kind === "text") {
        const w = ctx.measureText(tk.value).width;
        widths.push(w);
        totalContent += w;
      } else {
        // Keycap width grows for multi-char labels (`SPACE`,
        // `L SHIFT`) — measure with the keycap font and pad either
        // side, never below `keyMinW` so single letters stay
        // square.
        ctx.font = keyFont;
        const measured = ctx.measureText(tk.value).width;
        ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        const w = Math.max(keyMinW, measured + keyTextPad);
        widths.push(w);
        totalContent += w + keyGap;
      }
    }
    const totalW = totalContent + padX * 2;
    const totalH = fontSize + padY * 2;
    const cx = viewW / 2;
    const cy = viewH - 80 + slideY;
    ctx.translate(cx, cy);
    ctx.globalAlpha = alpha;

    // Denser backplate so the text reads without leaning on a bright
    // glow halo behind it.
    ctx.fillStyle = HINT_BACKPLATE_COLOR;
    roundedRectPath(ctx, -totalW / 2, -totalH / 2, totalW, totalH, 8);
    ctx.fill();

    let cursor = -totalW / 2 + padX;
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.kind === "text") {
        ctx.fillStyle = HINT_TEXT_COLOR;
        ctx.shadowColor = HINT_TEXT_COLOR;
        ctx.shadowBlur = HINT_GLOW_BLUR;
        ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(tk.value, cursor, 0);
        cursor += widths[i];
      } else {
        // keycap — width is the per-token measured value so
        // multi-char labels fit.
        const w = widths[i];
        ctx.shadowBlur = 0;
        ctx.fillStyle = HINT_KEYCAP_FILL;
        roundedRectPath(ctx, cursor, -keyH / 2, w, keyH, 4);
        ctx.fill();
        ctx.fillStyle = PALETTE.bg;
        ctx.font = keyFont;
        ctx.textAlign = "center";
        ctx.fillText(tk.value, cursor + w / 2, 1);
        cursor += w + keyGap;
      }
    }
    ctx.restore();
  }

  const rooms = new Map<string, Room>();
  rooms.set("roomIntro", buildRoomIntro());
  rooms.set("room0", buildRoom0());
  rooms.set("room1", buildRoom1());
  rooms.set("room2", buildRoom2());
  rooms.set("room3", buildRoom3());
  rooms.set("room4", buildRoom4());

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
    deathFx: null,
  };

  // The narrator's lines + camera pullback now live in
  // intro-cinematic.ts; tutorial starts straight in room0 (the
  // controls markers). roomIntro is kept buildable for archaeological
  // reasons but is no longer referenced in the flow.
  let currentRoom: Room = rooms.get("room0")!;
  // Soft fade-in from black on first load — the intro cinematic ends
  // with a fade-to-black, so room0 emerging from full darkness reads
  // as a continuous beat rather than a hard scene cut.
  let introFadeIn = 1.0;
  // Hero's first thought after the cinematic — "who was that?" plays
  // once on initial load (after the intro), then never replays. On
  // restart `bootThoughtAge` stays past the schedule's totalDuration
  // so the draw call silently no-ops; we don't reset it on rebuild.
  const BOOT_THOUGHT_TEXT = "who was that?";
  const bootThoughtSchedule: ScrambleSchedule = makeScrambleSchedule({
    // Wait for the introFadeIn (1.2 s) to mostly clear before the
    // text starts surfacing — the room needs to be visible first.
    appearStart: 2.5,
    fadeInDuration: 0.5,
    settleDuration: 2.0,
    holdDuration: 0.8,
    fadeOutDuration: 0.8,
  });
  let bootThoughtAge = 0;

  // Tutorial outro state — driven only while currentRoom.id is
  // "room4". On entry, a black overlay fades out (1 → 0) so the
  // transition from the hunter arena feels like a slow blink into
  // the void rather than a hard cut. After the narrator's last
  // beat, a separate fade IN (0 → 1) takes over and the page
  // navigates to /rooms.html when it lands at full black.
  let room4Age = 0;
  let room4FadeIn = 0;
  let room4FadeOut = 0;
  let room4Redirected = false;
  const outroBg: VoidBgState = createVoidBg(ROOM_W_PX, ROOM_H_PX);
  const OUTRO_BEATS: { text: string; typeStart: number; typeDuration: number; holdDuration: number; fadeDuration: number }[] = [
    {
      text: "Well done. You handled the first task.",
      typeStart: 1.4,
      typeDuration: 2.5,
      holdDuration: 1.6,
      fadeDuration: 0.45,
    },
    {
      text: "Now go and kill the Sentinel.",
      typeStart: 6.5,
      typeDuration: 2.0,
      holdDuration: 1.8,
      fadeDuration: 0.5,
    },
  ];
  const OUTRO_NARRATION_END_SEC = 11.5;
  // Long, deliberate fade — the hand-off into /rooms.html should feel
  // like the camera slowly closing its eyes, not a cut. Paired with
  // rooms-game's own fade-in from black (gated on the
  // `from-tutorial` sessionStorage flag) so both sides of the page
  // nav share matching dark frames.
  const OUTRO_FADEOUT_DURATION_SEC = 3.0;
  const ROOMS_HREF = `${import.meta.env.BASE_URL}rooms.html`;
  // sessionStorage key — set immediately before the redirect so
  // rooms-game knows the player just finished the tutorial and
  // should see a fade-in plus the "how do i do this?" thought.
  // Cleared on the rooms-game side after the first read.
  const FROM_TUTORIAL_KEY = "dash-proto:from-tutorial";
  let arenaBg: ArenaBg = createArenaBg(
    currentRoom.width ?? ROOM_W_PX,
    currentRoom.height ?? ROOM_H_PX,
  );
  let wallFx: WallFx = createWallFx(currentRoom.walls);
  // Single instance for the tutorial — flows across room transitions.
  const energyBg: EnergyBackground = createEnergyBackground(viewW, viewH);
  let gridNodes: GridNodeState = createGridNodeState(
    currentRoom.width ?? ROOM_W_PX,
    currentRoom.height ?? ROOM_H_PX,
  );
  let archiveFx: ArchiveFx = createArchiveFx(
    currentRoom.width ?? ROOM_W_PX,
    currentRoom.height ?? ROOM_H_PX,
  );

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
  spawnPlayerInCurrentRoom();
  snapCameraToRoom();
  syncTutorialStateForRoom();

  function rebuildAllRooms() {
    rooms.set("roomIntro", buildRoomIntro());
    rooms.set("room0", buildRoom0());
    rooms.set("room1", buildRoom1());
    rooms.set("room2", buildRoom2());
    rooms.set("room3", buildRoom3());
    rooms.set("room4", buildRoom4());
  }

  /**
   * Reset tutorial-only state to whatever the current room expects:
   * Room 0 returns to phase "movement" with the spawn hint, other
   * rooms clear the hint entirely. Called after every transition,
   * restart, and on initial start.
   */
  function syncTutorialStateForRoom() {
    room0Phase = "movement";
    room0DashWall = null;
    room0Dummy = null;
    room0DummyHpAtLastProgress = 0;
    hintText = null;
    hintState = "idle";
    hintAge = 0;
    hintPendingText = null;
    if (currentRoom.id === "room0") {
      room0Enter("movement");
    } else if (currentRoom.id === "room1") {
      // First combat room — explicit prompt so the player knows what
      // to do with the turret. Hint clears automatically when the
      // turret dies (handled in the room-cleared branch below).
      showHint("NOW KILL IT");
    }
    // Reset the outro sequencer whenever we enter or leave room4 so
    // the narrator + fadeout always start from age 0. room4FadeIn is
    // only armed when we ARRIVE in room4, not on leaving.
    room4Age = 0;
    room4FadeOut = 0;
    room4Redirected = false;
    room4FadeIn = currentRoom.id === "room4" ? 1.0 : 0;
  }

  function restartRun() {
    audio.silence();
    rebuildAllRooms();
    currentRoom = rooms.get("room0")!;
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
    state.deathFx = null;
    bullets = [];
    particles = [];
    rings = [];
    floatingTexts = [];
    lasers = [];
    currentKey = null;
    keyHeld = false;
    markerIndex = 0;
    tryAgainBounds = null;
    spawnPlayerInCurrentRoom();
    resetEyeState(player);
    snapCameraToRoom();
    syncTutorialStateForRoom();
    syncRoomFx();
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
    markerIndex = 0;
    spawnPlayerInCurrentRoom();
    snapCameraToRoom();
    syncTutorialStateForRoom();
    syncRoomFx();
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
      window.location.href = import.meta.env.BASE_URL;
    },
  });

  // Dev menu (F1) — same overlay shape as rooms-game, mode-specific
  // teleport list. Teleport routes through transitionToRoom so all
  // the side-effects (room rebuild, key reset) match a normal door
  // crossing. Disabled when run-state isn't "playing" so a dev
  // tool can't sneak past failed / completed overlays.
  const devMenu: DevMenu = createDevMenu({
    getGodMode: () => isGodMode(),
    setGodMode: (v) => setGodMode(v),
    getCurrentRoomId: () => currentRoom.id,
    isTeleportLocked: () => state.runState !== "playing",
    teleportToRoom: (id) => {
      transitionToRoom(id);
      lastTime = performance.now();
    },
    rooms: [
      { id: "room0", label: "Room 0 — Controls" },
      { id: "room1", label: "Room 1 — Turret" },
      { id: "room2", label: "Room 2 — Watcher" },
      { id: "room3", label: "Room 3 — Hunter" },
    ],
  });

  window.addEventListener("keydown", (e) => {
    audio.init();
    audio.playMusic("gameplay", 1.0);
    const code = e.code;

    // Dev menu owns its own F1 / Esc handling. Short-circuit our
    // game-side keydown while it's open so Esc doesn't pop the
    // pause overlay underneath, etc.
    if (devMenu.isOpen()) return;

    // While the completion overlay is up, keystrokes shouldn't toggle
    // the pause menu / restart / move the player. Mouse-only choice.
    if (state.runState === "completed") {
      e.preventDefault();
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
    audio.playMusic("gameplay", 1.0);
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

  function takeHit() {
    if (state.runState !== "playing") return;
    if (state.hitIframe > 0) return;
    if (player.dashIframeTime > 0) return;
    if (isGodMode()) return;
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

  function completeTutorial() {
    state.runState = "completed";
    audio.play.multUp(8);
    try {
      localStorage.setItem(TUTORIAL_COMPLETED_KEY, "true");
    } catch {
      // privacy / quota — completion still happens for the session,
      // we just can't remember it on next visit.
    }
    showTutorialCompleteOverlay();
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
    // Key drop is centralised here so it fires for any kill source
    // (dash-through, friendly-fire laser, future ones). One per room.
    if (enemy.dropsKey && !currentKey) {
      currentKey = createKey(enemy.x, enemy.y);
    }
  }

  function aliveEnemies(): Enemy[] {
    return currentRoom.enemies.filter((e) => !e.isDead());
  }

  function checkRoomCleared() {
    if (state.clearedRoomIds.has(currentRoom.id)) return;
    const door = currentRoom.door;
    if (!door) return;
    // Two unlock rules: requiresKey doors open on the key alone,
    // non-key doors require every enemy dead AND every marker
    // reached. (Tutorial rooms only use markers in Room 0; combat
    // rooms still resolve through the enemy clear branch.)
    if (door.requiresKey) {
      if (!keyHeld) return;
    } else {
      const hasEnemies = currentRoom.enemies.length > 0;
      const markers = currentRoom.markers;
      const hasMarkers = (markers?.length ?? 0) > 0;
      if (!hasEnemies && !hasMarkers) return; // empty rooms — skip
      if (hasEnemies && aliveEnemies().length > 0) return;
      if (hasMarkers && markers && markerIndex < markers.length) return;
    }
    state.clearedRoomIds.add(currentRoom.id);
    state.clearFlash = ROOM_CLEAR_FLASH;
    door.state = "open";
    audio.play.multUp(5); // placeholder sting
    // Drop the room-specific prompt as soon as the room is solved.
    // The door's open visual is its own feedback — the hint becomes
    // stale once the threat is gone.
    if (currentRoom.id === "room1" && hintText === "NOW KILL IT") {
      hintState = "hiding";
      hintAge = 0;
      hintPendingText = null;
    }
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

    // Tutorial outro — narrator beats + fade to /rooms.html. Same
    // pattern as the old roomIntro bridge: skip gameplay entirely
    // while the cinematic plays, keep the eye animation alive so the
    // hero reads as present in the void, then redirect once the
    // fade-out has fully landed.
    if (currentRoom.id === "room4") {
      room4Age += dt;
      if (room4FadeIn > 0) room4FadeIn = Math.max(0, room4FadeIn - dt / 1.0);
      tickVoidBg(outroBg, dt, ROOM_W_PX, ROOM_H_PX, 1);
      if (room4Age >= OUTRO_NARRATION_END_SEC) {
        room4FadeOut = Math.min(
          1,
          room4FadeOut + dt / OUTRO_FADEOUT_DURATION_SEC,
        );
        if (room4FadeOut >= 1 && !room4Redirected) {
          room4Redirected = true;
          try {
            sessionStorage.setItem(FROM_TUTORIAL_KEY, "true");
          } catch {
            // private mode / quota — rooms-game falls back to its
            // default cold-start (no fade, no boot thought).
          }
          window.location.href = ROOMS_HREF;
        }
      }
      updateEye(player, dt, {
        threat: null,
        size: PLAYER_SIZE,
        dashDurationSec: DASH_DURATION_MS / 1000,
      });
      render();
      requestAnimationFrame(frame);
      return;
    }

    // Decay the post-intro fade-in. Driven on dt so the speed is
    // independent of the framerate; runs alongside normal gameplay
    // without blocking input — the player can already move while the
    // fade-in finishes, exactly like waking up mid-step.
    if (introFadeIn > 0) {
      introFadeIn = Math.max(0, introFadeIn - dt / 1.2);
    }
    // Boot thought timer — only ticks until the schedule is done.
    if (!isScrambleTextDone(bootThoughtAge, bootThoughtSchedule)) {
      bootThoughtAge += dt;
    }

    bgFx.update(dt);

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
    // entirely). Interior walls (pillars, Room 0 dash wall, door)
    // are still routed through resolveEntityWallCollisions below;
    // smashCooldown prevents double-fire if both paths hit.
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
    // Right perimeter is gated on the open door — when the door is
    // open and the player is aligned with its y range, skip the
    // clamp so the transition fires.
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
    // Walls flagged `dashable` (Room 0 phase 2 dash gate) are
    // filtered out of the player wall list while dashIframeTime > 0
    // so a clean dash phases through. Same mechanism as Room 4's
    // section dividers.
    const wallsForCollision =
      player.dashIframeTime > 0
        ? currentRoom.walls.filter((w) => !w.dashable)
        : currentRoom.walls;
    const collisionResult = resolvePlayerWallCollisions(
      player,
      wallsForCollision,
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
    // Awareness ramps run BEFORE enemy update so combat ticks see the
    // freshly-promoted aggro state immediately. Trigger ctx lets the
    // awareness module spawn the alert ring + particle burst directly
    // into the per-room lists.
    const awarenessTrigger = { particles, rings };
    for (const e of currentRoom.enemies) {
      updateEnemyAwareness(e, player.x, player.y, dt, awarenessTrigger);
    }
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

    // tutorial markers — strictly sequential. Only the marker at
    // `markerIndex` (the active one) reacts to overlap; future
    // markers render as silhouettes (handled in the draw pass).
    // tickMarker advances the pulse phase for the active one only —
    // silhouettes don't pulse.
    if (currentRoom.markers && currentRoom.markers.length > 0) {
      const active = currentRoom.markers[markerIndex];
      if (active && !active.reached) {
        tickMarker(active, dt);
        if (
          markerOverlapsPlayer(
            active,
            player.x,
            player.y,
            PLAYER_SIZE / 2,
          )
        ) {
          active.reached = true;
          markerIndex += 1;
          hintAge = 0;
          audio.play.pickupGrab("hp");
          rings.push({
            x: active.x,
            y: active.y,
            age: 0,
            lifetime: 0.35,
            startR: 16,
            endR: 60,
            color: PALETTE.pickupHP,
            startLineWidth: 3,
            endLineWidth: 1,
            glowBlur: 14,
          });
          for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 180 + Math.random() * 140;
            particles.push({
              x: active.x,
              y: active.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              initialSize: 3,
              color: PALETTE.pickupHP,
              age: 0,
              lifetime: 0.4,
              glowStrong: 10,
              glowSoft: 4,
              drag: 0.94,
            });
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

    tickRoom0();
    tickHint(dt);
    checkRoomCleared();

    updateArenaBg(arenaBg, dt);
    updateWallFx(wallFx, dt, currentRoom.walls);
    updateEnergyBackground(energyBg, dt, viewW, viewH);
    updateGridNodes(gridNodes, dt);
    updateArchiveFx(archiveFx, dt, player.x, player.y);
    tickScanlines(dt);

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

    // door overlap → transition (or tutorial completion if no next)
    if (
      currentRoom.door &&
      currentRoom.door.state === "open" &&
      playerOverlapsDoor(currentRoom.door, player.x, player.y, half)
    ) {
      if (currentRoom.nextRoomId) {
        transitionToRoom(currentRoom.nextRoomId);
      } else if (state.runState === "playing") {
        completeTutorial();
      }
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

  function drawRoom4Outro() {
    const baseScale = Math.min(viewW / ROOM_W_PX, viewH / ROOM_H_PX);
    const renderW = ROOM_W_PX * baseScale;
    const renderH = ROOM_H_PX * baseScale;
    const offX = (viewW - renderW) / 2;
    const offY = (viewH - renderH) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.setTransform(
      baseScale * dpr,
      0,
      0,
      baseScale * dpr,
      offX * dpr,
      offY * dpr,
    );
    const focalX = ROOM_W_PX / 2;
    const focalY = ROOM_H_PX / 2;
    drawVoidBg(ctx, outroBg, ROOM_W_PX, ROOM_H_PX, focalX, focalY);
    // Hero at spawn (room centre). Standard gameplay render so the
    // body stays consistent with what the player just saw in the
    // tutorial rooms.
    drawPlayerEye(ctx, player, PLAYER_SIZE, {
      ringColor: profile.outerRing,
      pupilColor: profile.pupil,
      ghostColor: profile.outerRing,
      dashDurationSec: DASH_DURATION_MS / 1000,
      profile,
    });
    // Narrator beats — typewriter at the top of the stage, same
    // visual treatment as the intro cinematic so the player reads
    // the voice as the same entity.
    drawOutroNarration(ctx, focalX, 120);
    // Fade overlays sit on top of the canonical stage so the
    // letterbox bars darken with the scene. The arrival fade-in
    // (room4FadeIn) and the departure fade-out (room4FadeOut) never
    // overlap: room4FadeIn lands at 0 well before room4FadeOut rises.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const overlay = Math.max(room4FadeIn, room4FadeOut);
    if (overlay > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${overlay})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }
  }

  function drawOutroNarration(
    ctx2: CanvasRenderingContext2D,
    centerX: number,
    topY: number,
  ): void {
    const t = room4Age;
    let active: typeof OUTRO_BEATS[number] | null = null;
    for (const beat of OUTRO_BEATS) {
      const end =
        beat.typeStart + beat.typeDuration + beat.holdDuration + beat.fadeDuration;
      if (t >= beat.typeStart && t < end) {
        active = beat;
        break;
      }
    }
    if (!active) return;

    const rel = t - active.typeStart;
    const typedT = Math.min(1, rel / active.typeDuration);
    const charsVisible = Math.max(
      0,
      Math.min(active.text.length, Math.floor(active.text.length * typedT)),
    );
    const partial = active.text.slice(0, charsVisible);

    let alpha = 1;
    const fadeInSec = 0.25;
    if (rel < fadeInSec) alpha = rel / fadeInSec;
    const holdEnd = active.typeDuration + active.holdDuration;
    if (rel > holdEnd) {
      alpha = Math.min(
        alpha,
        Math.max(0, 1 - (rel - holdEnd) / active.fadeDuration),
      );
    }
    if (alpha <= 0) return;

    const showCursor =
      rel < holdEnd &&
      (rel < active.typeDuration || Math.floor(rel * 2.5) % 2 === 0);
    const display = partial + (showCursor ? "▍" : "");

    ctx2.save();
    ctx2.globalAlpha = alpha;
    ctx2.textAlign = "center";
    ctx2.textBaseline = "top";
    ctx2.font =
      "500 24px ui-monospace, 'SF Mono', 'Consolas', 'Liberation Mono', monospace";
    ctx2.fillStyle = "#7dd3fc";
    ctx2.shadowColor = "#38bdf8";
    ctx2.shadowBlur = 12;
    ctx2.fillText(display, centerX, topY);
    ctx2.restore();
  }

  function render() {
    // Tutorial outro — void backdrop + hero + narrator beats + a
    // hard fade-to-black at the end. No HUD, no walls, no arena bg.
    // Matches the cinematic's visual language so the handoff into
    // /rooms.html reads as a continuation, not a new scene.
    if (currentRoom.id === "room4") {
      drawRoom4Outro();
      return;
    }

    // letterbox: clear in CSS pixels, then transform into room space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, viewW, viewH);
    bgFx.drawBack(ctx, viewW, viewH);

    // energy background — drifting lines / rising particles / lightning,
    // clipped out of the visible arena rect (see rooms-game.ts for the
    // identical block; both modes share the bg-energy module).
    {
      const worldW = currentRoom.width ?? ROOM_W_PX;
      const worldH = currentRoom.height ?? ROOM_H_PX;
      let arenaBounds: ArenaScreenBounds;
      if (currentRoom.useCamera) {
        const canonLeft = Math.max(0, -camera.x);
        const canonTop = Math.max(0, -camera.y);
        const canonRight = Math.min(ROOM_W_PX, worldW - camera.x);
        const canonBottom = Math.min(ROOM_H_PX, worldH - camera.y);
        arenaBounds = {
          x: offsetX + canonLeft * scale,
          y: offsetY + canonTop * scale,
          w: Math.max(0, (canonRight - canonLeft) * scale),
          h: Math.max(0, (canonBottom - canonTop) * scale),
        };
      } else {
        arenaBounds = {
          x: offsetX,
          y: offsetY,
          w: ROOM_W_PX * scale,
          h: ROOM_H_PX * scale,
        };
      }
      drawEnergyBackground(ctx, energyBg, viewW, viewH, arenaBounds);
    }

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

    drawArenaBg(ctx, arenaBg, { x: player.x, y: player.y });

    // Stateful grid — mostly dead nodes with a handful flickering.
    drawRoomGrid(
      ctx,
      currentRoom.width ?? ROOM_W_PX,
      currentRoom.height ?? ROOM_H_PX,
      gridNodes,
    );

    drawArchiveFx(ctx, archiveFx);

    drawWalls(ctx, currentRoom.walls);
    drawWallOverlay(ctx, wallFx, currentRoom.walls);
    if (currentRoom.door) drawDoor(ctx, currentRoom.door);

    // tutorial markers — drawn after walls, before enemies. Active
    // marker (markers[markerIndex]) renders bright + pulse + label;
    // future ones render as alpha-0.25 silhouettes; reached ones
    // self-skip.
    if (currentRoom.markers) {
      for (let i = 0; i < currentRoom.markers.length; i++) {
        drawMarker(ctx, currentRoom.markers[i], i === markerIndex);
      }
    }

    // detection rings (drawn under everything so they read as a
    // ground-level radar pulse, not an overlay on top of the enemy)
    for (const e of currentRoom.enemies) {
      drawEnemyDetection(ctx, e, player.x, player.y);
    }

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

    // particles — flat path always; per-particle shadowBlur was a
    // major frame-cost spike. Tutorial uses the same simplification
    // as the rooms loop.
    ctx.save();
    ctx.shadowBlur = 0;
    for (const p of particles) {
      const t = p.age / p.lifetime;
      const alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
      const sz = Math.max(0.5, p.initialSize * (1 - t));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.restore();

    // player
    const pSize = PLAYER_SIZE;

    let drawPlayer = true;
    if (state.hitIframe > 0) {
      drawPlayer = Math.floor(state.hitIframe * 10) % 2 === 0;
    }
    if (state.deathFx && state.deathFx.age > 0.04) drawPlayer = false;

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

    drawFloatingTexts(ctx, floatingTexts);

    // Boot thought — hero's first thought after the cinematic. Plays
    // once on initial entry to room0; renders in world space (under
    // the camera transform when useCamera is true) so it sits
    // anchored just under the player. The lib silently no-ops once
    // the schedule has finished, so we just call unconditionally.
    if (currentRoom.id === "room0") {
      drawScrambleText(
        ctx,
        BOOT_THOUGHT_TEXT,
        bootThoughtAge,
        bootThoughtSchedule,
        player.x,
        player.y + 80,
      );
    }

    // Death cinematic — drawn in world space so the explosion sits at
    // the player's last known position even in scrolling rooms.
    if (state.deathFx) drawDeathFx(ctx, state.deathFx);

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
    drawTutorialHint();
    drawGodModeBadge(ctx, viewW);
    drawFpsOverlay(ctx, viewW);

    if (state.runState === "failed" && shouldShowDeathOverlay(state.deathFx)) {
      drawFailedOverlay();
    }
    // The "completed" runState is rendered by a DOM overlay
    // (showTutorialCompleteOverlay) so the three CTAs can be real
    // anchors / buttons; no canvas overlay needed here.

    drawScanlines(ctx, viewW, viewH);

    // Post-intro fade-in — sits ON TOP of everything (HUD, scanlines,
    // overlays) so the entire screen comes up from black smoothly
    // after the cinematic's fade-to-black redirect. Decays via dt in
    // the frame loop.
    if (introFadeIn > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, introFadeIn)})`;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }
  }

  function showTutorialCompleteOverlay(): void {
    if (!document.getElementById("tut-complete-style")) {
      const styleEl = document.createElement("style");
      styleEl.id = "tut-complete-style";
      styleEl.textContent = `
.tc-overlay {
  position: fixed; inset: 0;
  background: rgba(10, 14, 26, 0.92);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; padding: 24px; z-index: 200;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.tc-title {
  font-size: clamp(40px, 7vw, 64px);
  font-weight: 700; letter-spacing: 0.18em; margin: 0 0 4px;
  color: #a855f7;
  text-shadow: 0 0 12px #a855f7, 0 0 36px rgba(168, 85, 247, 0.55);
}
.tc-subtitle {
  font-size: 13px; letter-spacing: 0.32em; text-transform: uppercase;
  color: #94a3b8; margin: 0 0 24px;
}
.tc-actions {
  display: flex; flex-direction: column; gap: 12px; width: 320px;
}
.tc-btn {
  display: block; text-align: center; cursor: pointer;
  text-decoration: none; font: 600 14px inherit;
  letter-spacing: 0.18em; padding: 14px 20px;
  background: rgba(20, 25, 43, 0.72);
  border: 1px solid rgba(216, 180, 254, 0.18);
  border-radius: 10px; color: #cbd5e1;
  transition: transform 0.15s, border-color 0.15s,
              background 0.15s, color 0.15s;
}
.tc-btn:hover { transform: translateY(-2px); }
.tc-btn-primary {
  color: #00e5ff;
  border-color: rgba(0, 229, 255, 0.42);
  background: rgba(0, 229, 255, 0.14);
}
.tc-btn-primary:hover { background: rgba(0, 229, 255, 0.24); }
.tc-btn-replay { color: #4ade80; border-color: rgba(74, 222, 128, 0.35); }
.tc-btn-replay:hover { background: rgba(74, 222, 128, 0.14); }
.tc-btn-menu:hover {
  color: #d8b4fe;
  border-color: rgba(168, 85, 247, 0.5);
}
      `;
      document.head.appendChild(styleEl);
    }
    if (document.getElementById("tut-complete-overlay")) return;
    const root = document.createElement("div");
    root.id = "tut-complete-overlay";
    root.className = "tc-overlay";
    const base = import.meta.env.BASE_URL;
    root.innerHTML = `
      <h2 class="tc-title">TUTORIAL COMPLETE</h2>
      <div class="tc-subtitle">You're ready for the real thing.</div>
      <div class="tc-actions">
        <a class="tc-btn tc-btn-primary" href="${base}rooms.html">
          ▶  PROCEED TO STORY
        </a>
        <button type="button" class="tc-btn tc-btn-replay"
                data-action="replay">
          ↺  REPLAY TUTORIAL
        </button>
        <a class="tc-btn tc-btn-menu" href="${base}">
          ←  BACK TO MAIN MENU
        </a>
      </div>
    `;
    root
      .querySelector('[data-action="replay"]')
      ?.addEventListener("click", () => {
        hideTutorialCompleteOverlay();
        restartRun();
      });
    document.body.appendChild(root);
  }

  function hideTutorialCompleteOverlay(): void {
    const root = document.getElementById("tut-complete-overlay");
    if (root) root.remove();
  }

  function drawHUD() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const cx = viewW / 2;
    const heartsY = 16;
    const heartSpacing = 22;

    ctx.globalAlpha = 0.85;
    ctx.font = "600 22px system-ui, -apple-system, sans-serif";
    const heartsStart = cx - heartSpacing;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < state.hp ? "#ef4444" : "rgba(239,68,68,0.18)";
      ctx.fillText("♥", heartsStart + i * heartSpacing, heartsY);
    }

    const roomY = heartsY + 34;
    ctx.globalAlpha = 0.65;
    ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#cbd5e1";
    // The intro room is the calm beat right after the cinematic —
    // no counter, just a blank slot. Rooms 0..3 (markers / turret /
    // watcher / hunter) get the 1..4 label.
    if (currentRoom.id === "roomIntro") {
      // Nothing — keep the HUD silent for the entry room.
    } else {
      const roomNum =
        currentRoom.id === "room0"
          ? 1
          : currentRoom.id === "room1"
            ? 2
            : currentRoom.id === "room2"
              ? 3
              : currentRoom.id === "room3"
                ? 4
                : 1;
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
