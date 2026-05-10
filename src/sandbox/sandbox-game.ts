import {
  DEFAULT_SETTINGS,
  PALETTE,
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
  PRESETS,
  deepAssign,
  loadSettings,
  saveSettings,
  type Settings,
} from "../lib/config";
import { audio } from "../lib/audio";
import { emitBulletHit, type ImpactContext } from "../lib/impacts";
import { createSandboxPauseMenu } from "../lib/pause-menu";
import { createMenu } from "../lib/settings-menu";
import {
  PICKUP_COLORS,
  PICKUP_HALF,
  PICKUP_LABELS,
  drawPickup,
  drawPickupIcon,
  rollPickupType,
  type Pickup,
} from "../lib/pickups";
import {
  type PlayerProfile,
  createPlayer,
  drawPlayerEye,
  eyeOnHit,
  eyeStartClosing,
  findNearestThreat,
  loadPlayerProfile,
  resetEyeState,
  triggerPlayerSmash,
  updateEye,
} from "../lib/player";

const settings: Settings = loadSettings();
// Player profile (skin) — separate from in-mode settings, lives in
// localStorage and is shared with tutorial / rooms so the player's
// chosen colours follow them between modes. Loaded once at start;
// the editor lives on the landing page.
const profile: PlayerProfile = loadPlayerProfile();
const save = () => saveSettings(settings);

// volumes are applied lazily — audio.init() runs on the first user gesture,
// after which these calls take effect. Setting them up-front means the
// engine immediately knows the right values when init does fire.
audio.setMasterVolume(settings.audio.master);
audio.setSfxVolume(settings.audio.sfx);
audio.setMusicVolume(settings.audio.music);

const canvas = document.getElementById("app") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let dpr = window.devicePixelRatio || 1;
let viewW = 0;
let viewH = 0;

function resize() {
  dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rebuildGrid();
}

const GRID_STEP = 60;
let gridCanvas: HTMLCanvasElement | null = null;

function rebuildGrid() {
  const gc = document.createElement("canvas");
  gc.width = Math.max(1, Math.floor(viewW * dpr));
  gc.height = Math.max(1, Math.floor(viewH * dpr));
  const gctx = gc.getContext("2d");
  if (!gctx) return;
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gctx.fillStyle = PALETTE.bg;
  gctx.fillRect(0, 0, viewW, viewH);
  gctx.strokeStyle = PALETTE.bgGrid;
  gctx.lineWidth = 1;
  gctx.beginPath();
  for (let x = GRID_STEP; x < viewW; x += GRID_STEP) {
    gctx.moveTo(x + 0.5, 0);
    gctx.lineTo(x + 0.5, viewH);
  }
  for (let y = GRID_STEP; y < viewH; y += GRID_STEP) {
    gctx.moveTo(0, y + 0.5);
    gctx.lineTo(viewW, y + 0.5);
  }
  gctx.stroke();
  gridCanvas = gc;
}

// Two-pass neon render: a strong outer halo + a sharp inner halo, both
// using the canvas drop-shadow. Cheap when used per-object; for many
// objects (particles) we fall back to a flat draw.
function drawNeon(
  drawFn: () => void,
  color: string,
  blurStrong: number,
  blurSoft: number,
) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blurStrong;
  drawFn();
  ctx.shadowBlur = blurSoft;
  drawFn();
  ctx.restore();
}

resize();
window.addEventListener("resize", resize);

const keys = new Set<string>();
const menu = createMenu(settings, save, () => resetRun());
// Pause overlay layered above the settings menu — the bind key
// (menu1 / menu2) opens this first; the settings overlay only
// appears when the player chooses SETTINGS from here.
const pauseMenu = createSandboxPauseMenu({
  onSettings: () => {
    menu.toggle();
  },
  onResume: () => {
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
  // Tone.js requires a user gesture to start the AudioContext.
  // init() is idempotent — only the first call costs anything.
  audio.init();
  const code = normalizeCode(e.code);

  if (menu.isCapturing()) {
    e.preventDefault();
    if (code === "Escape") menu.cancelCapture();
    else menu.acceptCapturedKey(code);
    return;
  }

  if (code === settings.bindings.menu1 || code === settings.bindings.menu2) {
    e.preventDefault();
    if (menu.isOpen()) {
      // Settings overlay was opened from the pause menu — close it
      // and let the player back into the game directly. We don't
      // pop back to the pause menu (would feel like an extra step
      // for the common ESC-to-resume reflex).
      menu.toggle();
      lastTime = performance.now();
    } else if (pauseMenu.isOpen()) {
      pauseMenu.setOpen(false);
      lastTime = performance.now();
    } else {
      pauseMenu.setOpen(true);
    }
    keys.clear();
    return;
  }

  if (menu.isOpen() || pauseMenu.isOpen()) {
    return;
  }

  if (state.runState === "ended") {
    if (code === "Enter") {
      e.preventDefault();
      resetRun();
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
  if (menu.isOpen() || pauseMenu.isOpen()) return;
  if (state.runState !== "ended") return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (hitBounds(endTryAgainBounds, x, y)) {
    resetRun();
  } else if (hitBounds(endSettingsBounds, x, y)) {
    menu.setOpen(true);
  }
});

type Bounds = { x: number; y: number; w: number; h: number };
function hitBounds(b: Bounds | null, x: number, y: number): boolean {
  if (!b) return false;
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

const ACCEL_FACTOR = 9;
const FRICTION = 8.0;
const SPAWN_ANGLE_SPREAD = Math.PI / 3;
const WALL_THICKNESS = 6;

const HIT_IFRAME = 1.0;
const HIT_VIGNETTE = 0.2;
const MULT_GROW = 0.2;
const MULT_MAX = 10.0;
const MULT_MIN = 1.0;
const MULT_DECAY_DELAY = 2.0;
const MULT_DECAY_RATE = 0.5;
const NEAR_MISS_BASE = 50;
const DASH_BASE = 100;
const NEAR_MISS_SPEED_THRESHOLD = 50;
const HIT_PENALTY = 500;

const SCORE_KEY_PREFIX = "dash-prototype:score:";

type ConfigId = "Default" | "Easy" | "Normal" | "Hard" | null;

function configIdFromSettings(): ConfigId {
  const current = JSON.stringify(settings);
  if (current === JSON.stringify(DEFAULT_SETTINGS)) return "Default";
  for (const name of ["Easy", "Normal", "Hard"] as const) {
    const candidate: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    deepAssign(candidate, PRESETS[name]);
    if (JSON.stringify(candidate) === current) return name;
  }
  return null;
}

function getBestScore(id: ConfigId): number | null {
  if (!id) return null;
  const v = localStorage.getItem(SCORE_KEY_PREFIX + id);
  if (!v) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function setBestScoreIfBetter(id: ConfigId, score: number): boolean {
  if (!id) return false;
  const current = getBestScore(id) ?? 0;
  if (score > current) {
    localStorage.setItem(SCORE_KEY_PREFIX + id, String(score));
    return true;
  }
  return false;
}

const BULLET_TRAIL = 5;

type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: boolean;
  nearMissed: boolean;
  dashedThroughId: number; // last dash session id this bullet was awarded for
  // circular trail buffer (pre-allocated, no per-frame allocation)
  trailX: Float32Array;
  trailY: Float32Array;
  trailIdx: number;   // next write slot
  trailCount: number; // valid samples, capped at BULLET_TRAIL
};

type FloatingText = {
  x: number;
  y: number;
  vy: number;
  text: string;
  size: number;
  color: string;
  age: number;
  lifetime: number;
};

type Ring = {
  x: number;
  y: number;
  age: number;
  lifetime: number;
  startR: number;
  endR: number;
  color: string;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  initialSize: number;
  color: string;
  age: number;
  lifetime: number;
  glowStrong: number;
  glowSoft: number;
  drag: number; // applied per second-equivalent multiplier (frame-rate independent)
};

type EndSnapshot = {
  score: number;
  bestMult: number;
  survived: number;
  configId: ConfigId;
  bestScore: number | null;
  newBest: boolean;
};

type ShieldState = { remaining: number; charges: number };
type ScoreBoostState = { remaining: number };
type BreakerState = { remaining: number };

type ActiveEffects = {
  shield: ShieldState | null;
  scoreBoost: ScoreBoostState | null;
  breaker: BreakerState | null;
};

type GameRunState = {
  runState: "running" | "ended";
  endReason: "timeout" | "ko" | null;
  elapsed: number;
  hp: number;
  score: number;
  multiplier: number;
  multiplierTimer: number; // seconds since last style event
  bestMultThisRun: number;
  hitIframeTime: number;
  hitVignetteTime: number;
  dashId: number;
  dashChain: number;
  effects: ActiveEffects;
  passiveTimer: number; // accumulates dt while running, fires a passive pickup at every passiveInterval
  particleSpawnTimer: number; // accumulates dt for the player trail particle emitter
  multTiersHit: Record<number, boolean>; // tracks 3/5/7/10 tiers crossed this run
  endSnapshot: EndSnapshot | null;
};

const MULT_TIER_PORTS = [3, 5, 7, 10];

const player = createPlayer();

const state: GameRunState = {
  runState: "running",
  endReason: null,
  elapsed: 0,
  hp: 3,
  score: 0,
  multiplier: 1.0,
  multiplierTimer: 0,
  bestMultThisRun: 1.0,
  hitIframeTime: 0,
  hitVignetteTime: 0,
  dashId: 0,
  dashChain: 0,
  effects: { shield: null, scoreBoost: null, breaker: null },
  passiveTimer: 0,
  particleSpawnTimer: 0,
  multTiersHit: {},
  endSnapshot: null,
};

let bullets: Bullet[] = [];
let pickups: Pickup[] = [];
let spawnTimer = 0;
let started = false;
let initialFillDone = false;
let floatingTexts: FloatingText[] = [];
let rings: Ring[] = [];
let particles: Particle[] = [];

let endTryAgainBounds: Bounds | null = null;
let endSettingsBounds: Bounds | null = null;

// Sandbox uses only LIGHT-tier impact (dash-through pellets) so the
// shake / global-flash hooks are stubs.
const noopShake: ImpactContext["triggerShake"] = () => {};
const noopScreenFlash: ImpactContext["triggerScreenFlash"] = () => {};

function resetRun() {
  // Kill any lingering synth voices from the previous run (especially
  // the runEnd chord) so the new run starts on silence.
  audio.silence();
  state.runState = "running";
  state.endReason = null;
  state.elapsed = 0;
  state.hp = 3;
  state.score = 0;
  state.multiplier = 1.0;
  state.multiplierTimer = 0;
  state.bestMultThisRun = 1.0;
  state.hitIframeTime = 0;
  state.hitVignetteTime = 0;
  state.dashId = 0;
  state.dashChain = 0;
  state.effects = { shield: null, scoreBoost: null, breaker: null };
  state.passiveTimer = 0;
  state.multTiersHit = {};
  state.endSnapshot = null;

  player.x = viewW / 2;
  player.y = viewH / 2;
  player.vx = 0;
  player.vy = 0;
  player.facingX = 0;
  player.facingY = -1;
  player.dashTime = 0;
  player.dashIframeTime = 0;
  player.cooldown = 0;
  resetEyeState(player);

  bullets = [];
  pickups = [];
  spawnTimer = 0;
  started = false;
  initialFillDone = false;
  floatingTexts = [];
  rings = [];
  particles = [];
  state.particleSpawnTimer = 0;
  endTryAgainBounds = null;
  endSettingsBounds = null;
}
resetRun();

function inputDir(): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (keys.has(settings.bindings.left)) x -= 1;
  if (keys.has(settings.bindings.right)) x += 1;
  if (keys.has(settings.bindings.up)) y -= 1;
  if (keys.has(settings.bindings.down)) y += 1;
  const len = Math.hypot(x, y);
  if (len > 0) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

function dashSpeedNow(): number {
  const dur = settings.dash.durationMs / 1000;
  return dur > 0 ? settings.dash.distance / dur : 0;
}

function tryStartDash() {
  if (player.dashTime > 0 || player.cooldown > 0) return;

  const input = inputDir();
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
  const v = dashSpeedNow();
  player.vx = dx * v;
  player.vy = dy * v;

  state.dashId++;
  state.dashChain = 0;
  audio.play.dash();
}

function spawnBullet() {
  const sz = settings.bullets.size;
  const h = sz / 2;
  const inset = h + WALL_THICKNESS;
  const edge = Math.floor(Math.random() * 4);
  const xRange = viewW - 2 * inset;
  const yRange = viewH - 2 * inset;
  let x = 0;
  let y = 0;
  let nx = 0;
  let ny = 0;
  if (edge === 0) {
    x = inset + Math.random() * xRange;
    y = inset;
    ny = 1;
  } else if (edge === 1) {
    x = viewW - inset;
    y = inset + Math.random() * yRange;
    nx = -1;
  } else if (edge === 2) {
    x = inset + Math.random() * xRange;
    y = viewH - inset;
    ny = -1;
  } else {
    x = inset;
    y = inset + Math.random() * yRange;
    nx = 1;
  }
  const baseAngle = Math.atan2(ny, nx);
  const offset = (Math.random() * 2 - 1) * SPAWN_ANGLE_SPREAD;
  const angle = baseAngle + offset;
  const speed = settings.bullets.speed;
  const bounces = Math.random() < settings.bullets.bounceChance / 100;

  while (bullets.length >= settings.bullets.maxBullets) bullets.shift();
  bullets.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    bounces,
    nearMissed: false,
    dashedThroughId: -1,
    trailX: new Float32Array(BULLET_TRAIL),
    trailY: new Float32Array(BULLET_TRAIL),
    trailIdx: 0,
    trailCount: 0,
  });
}

function aabbHit(b: Bullet): boolean {
  let ph = settings.player.size / 2;
  if (state.effects.shield) ph *= settings.pickups.shield.hitboxMul;
  const bh = settings.bullets.size / 2;
  return (
    Math.abs(b.x - player.x) < ph + bh && Math.abs(b.y - player.y) < ph + bh
  );
}

function addFloatingText(
  text: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    color?: string;
    lifetime?: number;
    vy?: number;
  } = {},
) {
  floatingTexts.push({
    x,
    y,
    vy: opts.vy ?? -55,
    text,
    size: opts.size ?? 20,
    color: opts.color ?? "#ffffff",
    age: 0,
    lifetime: opts.lifetime ?? 0.5,
  });
}

function addRing(
  x: number,
  y: number,
  opts: {
    startR?: number;
    endR?: number;
    color?: string;
    lifetime?: number;
  } = {},
) {
  rings.push({
    x,
    y,
    age: 0,
    lifetime: opts.lifetime ?? 0.1,
    startR: opts.startR ?? settings.player.size / 2 + 4,
    endR: opts.endR ?? settings.player.size / 2 + 30,
    color: opts.color ?? "#facc15",
  });
}

function bumpMultiplier() {
  // while a score boost is active the multiplier is frozen
  if (state.effects.scoreBoost) return;
  state.multiplier = Math.min(MULT_MAX, state.multiplier + MULT_GROW);
  state.multiplierTimer = 0;
  if (state.multiplier > state.bestMultThisRun) {
    state.bestMultThisRun = state.multiplier;
  }
  for (const tier of MULT_TIER_PORTS) {
    if (state.multiplier >= tier && !state.multTiersHit[tier]) {
      state.multTiersHit[tier] = true;
      audio.play.multUp(tier);
    }
  }
}

function awardDashThrough(b: Bullet) {
  state.dashChain++;
  const base = DASH_BASE * Math.pow(2, state.dashChain - 1);
  const earned = Math.round(base * state.multiplier);
  state.score += earned;
  bumpMultiplier();
  audio.play.dashThrough(state.dashChain - 1);
  const size = 18 + state.dashChain * 6;
  addFloatingText(`+${base}`, b.x, b.y - 10, {
    size,
    color: "#ffffff",
    lifetime: 0.6,
  });
  // LIGHT-tier impact feedback — small white flash + 6 bullet-color
  // particles + bit-crushed "tic". No shake / no global flash for the
  // bullet tier so heavy fire stays pleasant.
  emitBulletHit(
    {
      particles,
      rings,
      triggerShake: noopShake,
      triggerScreenFlash: noopScreenFlash,
    },
    b.x,
    b.y,
    settings.bullets.color,
  );
  // chance to drop a pickup at the bullet's position
  if (Math.random() < settings.pickups.dropChance) {
    const type = rollPickupType(settings.pickups.weights);
    pickups.push({
      x: b.x,
      y: b.y,
      type,
      age: 0,
      lifetime: settings.pickups.lifetime,
    });
    audio.play.pickupSpawn();
  }
}

function awardBulletBreak(b: Bullet) {
  state.dashChain++;
  const cfg = settings.pickups.breaker;
  const base = cfg.scoreBase * Math.pow(2, state.dashChain - 1);
  const earned = Math.round(base * state.multiplier);
  state.score += earned;
  bumpMultiplier();
  audio.play.bulletBreak();
  const size = 18 + state.dashChain * 6;
  addFloatingText(`+${base}`, b.x, b.y - 10, {
    size,
    color: "#ffffff",
    lifetime: 0.55,
  });
  // white flash (radius ~2× bullet size)
  addRing(b.x, b.y, {
    startR: settings.bullets.size * 0.6,
    endR: settings.bullets.size * 2,
    color: "#ffffff",
    lifetime: 0.06,
  });
  // bullet-color expanding ring (diameter → 3× diameter over 60ms)
  addRing(b.x, b.y, {
    startR: settings.bullets.size / 2,
    endR: settings.bullets.size * 1.5,
    color: settings.bullets.color,
    lifetime: 0.06,
  });
  // particles
  for (let i = 0; i < cfg.particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 200 + Math.random() * 200;
    particles.push({
      x: b.x,
      y: b.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      initialSize: 3,
      color: settings.bullets.color,
      age: 0,
      lifetime: 0.4,
      glowStrong: 10,
      glowSoft: 4,
      drag: 1.0,
    });
  }
  // broken bullets do NOT drop pickups (intentional — would create a feedback loop)
}

function spawnTrailParticles(speed: number, isDash: boolean) {
  // direction opposite to player motion + perpendicular axis for jitter
  const dirX = speed > 0 ? -player.vx / speed : 0;
  const dirY = speed > 0 ? -player.vy / speed : 0;
  const perpX = -dirY;
  const perpY = dirX;

  // Dash sparks → profile.dashParticles. Idle / walk trails follow
  // the orb's ring colour (also from profile) so a single pick in
  // the Player overlay drives the whole "your colour" feel.
  let color: string;
  if (player.dashTime > 0 || player.dashIframeTime > 0) {
    color = profile.dashParticles;
  } else {
    color = profile.outerRing;
  }

  const speedMul = isDash ? PARTICLE_DASH_SPEED_MULTIPLIER : 1;
  const baseMin = PARTICLE_BASE_SPEED_MIN * speedMul;
  const baseRange = (PARTICLE_BASE_SPEED_MAX - PARTICLE_BASE_SPEED_MIN) * speedMul;
  const lateralMag = PARTICLE_LATERAL_JITTER * speedMul;

  // count: walk/idle 1-2, dash 2-3
  const count = isDash
    ? 2 + Math.floor(Math.random() * 2)
    : 1 + Math.floor(Math.random() * 2);

  const lifetime = PARTICLE_LIFETIME_MS / 1000;

  for (let i = 0; i < count; i++) {
    const back = baseMin + Math.random() * baseRange;
    const lateral = (Math.random() * 2 - 1) * lateralMag;
    const upDrift = -(20 + Math.random() * 30); // -20..-50
    const vx = dirX * back + perpX * lateral;
    const vy = dirY * back + perpY * lateral + upDrift;
    const sizeFactor =
      PARTICLE_SIZE_MIN_FACTOR +
      Math.random() * (PARTICLE_SIZE_MAX_FACTOR - PARTICLE_SIZE_MIN_FACTOR);
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

function spawnPassivePickup() {
  const inset = WALL_THICKNESS + PICKUP_HALF + 16;
  const x = inset + Math.random() * Math.max(0, viewW - 2 * inset);
  const y = inset + Math.random() * Math.max(0, viewH - 2 * inset);
  const type = rollPickupType(settings.pickups.weights);
  pickups.push({
    x,
    y,
    type,
    age: 0,
    lifetime: settings.pickups.lifetime,
  });
  // gentle "appear" cue so the player notices it
  addRing(x, y, {
    startR: 6,
    endR: 30,
    color: PICKUP_COLORS[type],
    lifetime: 0.4,
  });
  audio.play.pickupSpawn();
}

function applyPickup(p: Pickup) {
  audio.play.pickupGrab(p.type);
  const color = PICKUP_COLORS[p.type];
  const label = PICKUP_LABELS[p.type];
  switch (p.type) {
    case "hp":
      if (state.hp < 3) {
        state.hp += 1;
        addFloatingText(label, p.x, p.y - 18, {
          color,
          size: 18,
          lifetime: 0.7,
        });
      } else {
        const bonus = settings.pickups.heal.scoreOnFull;
        state.score += bonus;
        addFloatingText(`+${bonus}`, p.x, p.y - 18, {
          color,
          size: 18,
          lifetime: 0.7,
        });
      }
      break;
    case "shield": {
      const cfg = settings.pickups.shield;
      if (state.effects.shield) {
        state.effects.shield.remaining = cfg.duration;
        state.effects.shield.charges = cfg.charges;
      } else {
        state.effects.shield = {
          remaining: cfg.duration,
          charges: cfg.charges,
        };
      }
      addFloatingText(label, p.x, p.y - 18, {
        color,
        size: 18,
        lifetime: 0.7,
      });
      break;
    }
    case "scoreBoost": {
      const cfg = settings.pickups.scoreBoost;
      state.multiplier = Math.min(MULT_MAX, state.multiplier + cfg.bonus);
      state.effects.scoreBoost = { remaining: cfg.duration };
      if (state.multiplier > state.bestMultThisRun) {
        state.bestMultThisRun = state.multiplier;
      }
      // boost can vault past tier thresholds — fire the tier-up cue too
      for (const tier of MULT_TIER_PORTS) {
        if (state.multiplier >= tier && !state.multTiersHit[tier]) {
          state.multTiersHit[tier] = true;
          audio.play.multUp(tier);
        }
      }
      addFloatingText(label, p.x, p.y - 18, {
        color,
        size: 18,
        lifetime: 0.7,
      });
      break;
    }
    case "breaker": {
      state.effects.breaker = {
        remaining: settings.pickups.breaker.duration,
      };
      addFloatingText(label, p.x, p.y - 18, {
        color,
        size: 18,
        lifetime: 0.7,
      });
      break;
    }
  }
  // pickup confirmation ring
  addRing(p.x, p.y, {
    startR: 4,
    endR: 32,
    color,
    lifetime: 0.3,
  });
}

function awardNearMiss(b: Bullet) {
  const earned = Math.round(NEAR_MISS_BASE * state.multiplier);
  state.score += earned;
  bumpMultiplier();
  addFloatingText(`+${NEAR_MISS_BASE}`, b.x, b.y - 10, {
    size: 16,
    color: "#facc15",
    lifetime: 0.45,
  });
  addRing(player.x, player.y, {
    startR: settings.player.size / 2 + 6,
    endR: settings.player.size / 2 + 28,
    color: "#facc15",
    lifetime: 0.1,
  });
}

function hitPlayer() {
  if (state.runState === "ended") return;
  audio.play.hit();
  state.hp -= 1;
  state.score -= HIT_PENALTY;
  addFloatingText(`-${HIT_PENALTY}`, player.x, player.y - settings.player.size, {
    size: 24,
    color: "#ff5555",
    lifetime: 0.8,
    vy: -40,
  });
  state.multiplier = MULT_MIN;
  state.multiplierTimer = 0;
  state.hitIframeTime = HIT_IFRAME;
  state.hitVignetteTime = HIT_VIGNETTE;
  eyeOnHit(player);
  if (state.hp <= 0) endRun("ko");
}

function endRun(reason: "timeout" | "ko") {
  if (state.runState === "ended") return;
  state.runState = "ended";
  state.endReason = reason;
  eyeStartClosing(player);
  audio.play.runEnd();
  const id = configIdFromSettings();
  const newBest = id ? setBestScoreIfBetter(id, state.score) : false;
  state.endSnapshot = {
    score: state.score,
    bestMult: state.bestMultThisRun,
    survived: state.elapsed,
    configId: id,
    bestScore: id ? getBestScore(id) : null,
    newBest,
  };
}

let lastTime = performance.now();

function frame(now: number) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.05) dt = 0.05;

  if (menu.isOpen() || pauseMenu.isOpen()) {
    render();
    requestAnimationFrame(frame);
    return;
  }

  // age floating texts, rings, particles even after end so they finish out
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
      // frame-rate-independent decay so a 30 fps and 60 fps tick agree
      const k = Math.pow(p.drag, dt * 60);
      p.vx *= k;
      p.vy *= k;
    }
  }
  particles = particles.filter((p) => p.age < p.lifetime);

  if (state.runState === "ended") {
    if (state.hitVignetteTime > 0)
      state.hitVignetteTime = Math.max(0, state.hitVignetteTime - dt);
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

  // === running state ===

  if (!started) {
    const probe = inputDir();
    if (probe.x !== 0 || probe.y !== 0 || keys.has(settings.bindings.dash)) {
      started = true;
    }
  }
  if (started) {
    state.elapsed += dt;
    const limit = settings.run.durationSec;
    if (limit > 0 && state.elapsed >= limit) {
      endRun("timeout");
    }
    // passive pickup timer
    const passive = settings.pickups.passiveInterval;
    if (passive > 0) {
      state.passiveTimer += dt;
      while (state.passiveTimer >= passive) {
        state.passiveTimer -= passive;
        spawnPassivePickup();
      }
    } else {
      state.passiveTimer = 0;
    }
  }

  if (keys.has(settings.bindings.dash)) {
    tryStartDash();
    keys.delete(settings.bindings.dash);
  }

  if (player.dashTime > 0) {
    player.dashTime -= dt;
    const v = dashSpeedNow();
    player.vx = player.dashDirX * v;
    player.vy = player.dashDirY * v;
    if (player.dashTime <= 0) {
      player.dashTime = 0;
      player.cooldown = settings.dash.cooldownMs / 1000;
      player.vx *= 0.35;
      player.vy *= 0.35;
    }
  } else {
    const input = inputDir();
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
    const maxSpeed = settings.player.maxSpeed;
    const cap = keys.has(settings.bindings.walk)
      ? maxSpeed * settings.player.walkFactor
      : maxSpeed;
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
  if (state.hitIframeTime > 0)
    state.hitIframeTime = Math.max(0, state.hitIframeTime - dt);
  if (state.hitVignetteTime > 0)
    state.hitVignetteTime = Math.max(0, state.hitVignetteTime - dt);

  // active effects countdown
  if (state.effects.shield) {
    state.effects.shield.remaining -= dt;
    if (state.effects.shield.remaining <= 0) {
      addRing(player.x, player.y, {
        startR: settings.player.size * 0.7,
        endR: settings.player.size * 1.6,
        color: "#60a5fa",
        lifetime: 0.4,
      });
      state.effects.shield = null;
    }
  }
  if (state.effects.scoreBoost) {
    state.effects.scoreBoost.remaining -= dt;
    if (state.effects.scoreBoost.remaining <= 0) {
      state.effects.scoreBoost = null;
      // give a fresh decay grace window after the boost expires
      state.multiplierTimer = 0;
    }
  }
  if (state.effects.breaker) {
    state.effects.breaker.remaining -= dt;
    if (state.effects.breaker.remaining <= 0) {
      state.effects.breaker = null;
    }
  }

  // multiplier decay (paused while a score boost is active)
  if (!state.effects.scoreBoost) {
    state.multiplierTimer += dt;
    if (state.multiplierTimer > MULT_DECAY_DELAY) {
      state.multiplier = Math.max(
        MULT_MIN,
        state.multiplier - MULT_DECAY_RATE * dt,
      );
    }
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  const half = settings.player.size / 2;
  const minX = WALL_THICKNESS + half;
  const maxX = viewW - WALL_THICKNESS - half;
  const minY = WALL_THICKNESS + half;
  const maxY = viewH - WALL_THICKNESS - half;
  // Arena clamp + smash detection. Each side resolves the inward
  // velocity component before zeroing — that's the impact velocity for
  // the smash effect.
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
  if (player.x > maxX) {
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

  // bullet spawn
  if (started) {
    if (
      !initialFillDone &&
      bullets.length >= settings.bullets.maxBullets
    ) {
      initialFillDone = true;
    }
    const baseInterval = settings.bullets.spawnIntervalMs / 1000;
    const filling =
      !initialFillDone && bullets.length < settings.bullets.maxBullets;
    const effInterval = filling ? 0.04 : baseInterval;
    const perTick = filling ? 4 : 1;
    spawnTimer += dt;
    while (
      spawnTimer >= effInterval &&
      bullets.length < settings.bullets.maxBullets
    ) {
      spawnTimer -= effInterval;
      for (
        let i = 0;
        i < perTick && bullets.length < settings.bullets.maxBullets;
        i++
      ) {
        spawnBullet();
      }
    }
  }

  // bullet movement & wall bounce
  const bh = settings.bullets.size / 2;
  const minBx = WALL_THICKNESS + bh;
  const maxBx = viewW - WALL_THICKNESS - bh;
  const minBy = WALL_THICKNESS + bh;
  const maxBy = viewH - WALL_THICKNESS - bh;
  for (const b of bullets) {
    const px = b.x;
    const py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.bounces) {
      if (b.x < minBx && px >= minBx && b.vx < 0) {
        b.x = minBx;
        b.vx = -b.vx;
      }
      if (b.x > maxBx && px <= maxBx && b.vx > 0) {
        b.x = maxBx;
        b.vx = -b.vx;
      }
      if (b.y < minBy && py >= minBy && b.vy < 0) {
        b.y = minBy;
        b.vy = -b.vy;
      }
      if (b.y > maxBy && py <= maxBy && b.vy > 0) {
        b.y = maxBy;
        b.vy = -b.vy;
      }
    }
    // record this frame's position into the trail's circular buffer
    b.trailX[b.trailIdx] = b.x;
    b.trailY[b.trailIdx] = b.y;
    b.trailIdx = (b.trailIdx + 1) % BULLET_TRAIL;
    if (b.trailCount < BULLET_TRAIL) b.trailCount++;
  }

  // player trail — emitted as independent particles, replacing the old
  // ghost-square trail. Spawn rate and speed multiplier ramp up while
  // dashing; a hard speed gate prevents particles from leaking out while
  // the player is essentially still.
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

  bullets = bullets.filter(
    (b) => b.x > -60 && b.x < viewW + 60 && b.y > -60 && b.y < viewH + 60,
  );
  while (bullets.length > settings.bullets.maxBullets) bullets.shift();

  // collisions: dash-through (i-frame) > hit-ignore > shield-block > damage;
  // near-miss otherwise
  const playerSpeed = Math.hypot(player.vx, player.vy);
  const nearRadius = settings.player.size + 20;
  const inDash = player.dashIframeTime > 0;
  const consumedBullets: Bullet[] = [];

  for (const b of bullets) {
    const aabb = aabbHit(b);
    if (aabb) {
      if (inDash) {
        if (b.dashedThroughId !== state.dashId) {
          b.dashedThroughId = state.dashId;
          if (state.effects.breaker) {
            awardBulletBreak(b);
            consumedBullets.push(b);
          } else {
            awardDashThrough(b);
          }
        }
      } else if (state.hitIframeTime > 0) {
        // immune from this hit but no scoring
      } else if (state.effects.shield && state.effects.shield.charges > 0) {
        const cfg = settings.pickups.shield;
        state.effects.shield.charges -= 1;
        state.score += cfg.scoreOnBlock;
        addFloatingText(`+${cfg.scoreOnBlock}`, b.x, b.y, {
          color: "#60a5fa",
          size: 16,
          lifetime: 0.5,
        });
        addRing(player.x, player.y, {
          startR: settings.player.size * 0.5,
          endR: settings.player.size * 1.0,
          color: "#ffffff",
          lifetime: 0.18,
        });
        consumedBullets.push(b);
        if (state.effects.shield.charges <= 0) {
          addRing(player.x, player.y, {
            startR: settings.player.size * 0.7,
            endR: settings.player.size * 1.8,
            color: "#60a5fa",
            lifetime: 0.45,
          });
          state.effects.shield = null;
        }
      } else {
        hitPlayer();
        if (state.hp <= 0) break;
      }
    } else if (
      !b.nearMissed &&
      playerSpeed > NEAR_MISS_SPEED_THRESHOLD &&
      !inDash
    ) {
      const dx = b.x - player.x;
      const dy = b.y - player.y;
      if (dx * dx + dy * dy < nearRadius * nearRadius) {
        b.nearMissed = true;
        awardNearMiss(b);
      }
    }
  }
  if (consumedBullets.length > 0) {
    const consumed = new Set(consumedBullets);
    bullets = bullets.filter((b) => !consumed.has(b));
  }

  // eye state: pupil tracks the closest bullet, dash ghosts spawn here too
  updateEye(player, dt, {
    threat: findNearestThreat(player.x, player.y, bullets),
    size: settings.player.size,
    dashDurationSec: settings.dash.durationMs / 1000,
    bullets,
    mode: "sandbox",
    hitIframe: state.hitIframeTime,
  });

  // pickups: age, expire, collect
  const playerHalf = settings.player.size / 2;
  const pickRadius = PICKUP_HALF * settings.pickups.pickupRadiusMul + playerHalf;
  const pickRadius2 = pickRadius * pickRadius;
  const survivingPickups: Pickup[] = [];
  for (const p of pickups) {
    p.age += dt;
    if (p.age >= p.lifetime) {
      addRing(p.x, p.y, {
        startR: 4,
        endR: 22,
        color: PICKUP_COLORS[p.type],
        lifetime: 0.25,
      });
      continue;
    }
    const dx = p.x - player.x;
    const dy = p.y - player.y;
    if (dx * dx + dy * dy < pickRadius2) {
      applyPickup(p);
      continue;
    }
    survivingPickups.push(p);
  }
  pickups = survivingPickups;

  render();
  requestAnimationFrame(frame);
}

function multColor(m: number): string {
  if (m < 3) return "#ffffff";
  const t = Math.min(1, (m - 3) / (MULT_MAX - 3));
  // yellow (255,220,60) → red (255,40,0)
  const r = 255;
  const g = Math.round(220 * (1 - t) + 40 * t);
  const b = Math.round(60 * (1 - t));
  return `rgb(${r},${g},${b})`;
}

function render() {
  // background + grid (cached offscreen canvas)
  if (gridCanvas) {
    ctx.drawImage(gridCanvas, 0, 0, viewW, viewH);
  } else {
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = WALL_THICKNESS;
  ctx.strokeRect(
    WALL_THICKNESS / 2,
    WALL_THICKNESS / 2,
    viewW - WALL_THICKNESS,
    viewH - WALL_THICKNESS,
  );
  ctx.restore();

  // bullets (trail first as a flat alpha-faded ramp, then live bullet with neon)
  const bSize = settings.bullets.size;
  const bColor = settings.bullets.color;
  for (const b of bullets) {
    if (b.trailCount > 0) {
      const start =
        b.trailCount === BULLET_TRAIL ? b.trailIdx : 0;
      for (let i = 0; i < b.trailCount; i++) {
        const j = (start + i) % BULLET_TRAIL;
        const t = b.trailCount === 1 ? 1 : i / (b.trailCount - 1);
        const sz = bSize * (0.5 + 0.5 * t);
        const alpha = 0.1 + 0.4 * t;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = bColor;
        ctx.fillRect(
          b.trailX[j] - sz / 2,
          b.trailY[j] - sz / 2,
          sz,
          sz,
        );
        ctx.restore();
      }
    }
    drawNeon(
      () => {
        ctx.fillStyle = bColor;
        ctx.fillRect(b.x - bSize / 2, b.y - bSize / 2, bSize, bSize);
      },
      bColor,
      20,
      8,
    );
  }

  // pickups (each individually neon-glowed in its own table color)
  for (const p of pickups) {
    drawNeon(
      () => drawPickup(ctx, p, settings.pickups.blinkDuration),
      PICKUP_COLORS[p.type],
      22,
      8,
    );
  }

  // particles — neon only when there's a manageable number on screen
  const particlesGetNeon = particles.length < 50;
  for (const p of particles) {
    const t = p.age / p.lifetime;
    // first half stays at full alpha, then linearly fades to 0
    const alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
    const sz = Math.max(0.5, p.initialSize * (1 - t));
    ctx.save();
    ctx.globalAlpha = alpha;
    if (particlesGetNeon) {
      drawNeon(
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

  // player — eye-orb with pupil tracking the nearest bullet
  const pSize = settings.player.size;
  const dashing = player.dashTime > 0;
  const cooling = player.cooldown > 0;

  let drawPlayer = true;
  if (state.hitIframeTime > 0) {
    drawPlayer = Math.floor(state.hitIframeTime * 10) % 2 === 0;
  }

  if (drawPlayer) {
    // Body layers (ring / iris / pupil) come straight from the player
    // profile — the eye's skin never flips between idle and dash. The
    // halo around the outer ring is owned by drawPlayerEye and reads
    // dash vs idle internally; the only override here is the Bullet
    // Breaker pickup tint, which paints the halo orange while active.
    drawPlayerEye(ctx, player, pSize, {
      ringColor: profile.outerRing,
      pupilColor: profile.pupil,
      ghostColor: profile.outerRing,
      dashDurationSec: settings.dash.durationMs / 1000,
      profile,
      ...(state.effects.breaker
        ? { glowColor: PALETTE.pickupBreaker }
        : {}),
    });
  }

  if (cooling && !dashing) {
    const r = pSize * 0.9;
    const total = settings.dash.cooldownMs / 1000;
    const t = total > 0 ? 1 - player.cooldown / total : 1;
    ctx.strokeStyle = "rgba(170,170,170,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
    ctx.stroke();
  }

  // shield ring around the player; cracks (gaps) reflect remaining charges
  if (state.effects.shield) {
    const r = pSize * settings.pickups.shield.hitboxMul * 0.65 + 6;
    const charges = state.effects.shield.charges;
    const maxCharges = settings.pickups.shield.charges;
    const cracks = Math.max(0, maxCharges - charges);
    ctx.save();
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.75;
    if (cracks <= 0) {
      ctx.beginPath();
      ctx.arc(player.x, player.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // draw arc segments separated by small gaps for each crack
      const gap = 0.18; // radians
      const segments = cracks; // 1 crack = 1 gap; 2 cracks = 2 gaps (opposite)
      const totalGap = gap * segments;
      const seg = (Math.PI * 2 - totalGap) / segments;
      for (let i = 0; i < segments; i++) {
        const start = -Math.PI / 2 + i * (seg + gap);
        ctx.beginPath();
        ctx.arc(player.x, player.y, r, start, start + seg);
        ctx.stroke();
      }
    }
    ctx.restore();
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

  // floating texts (score numbers glow, all texts get a soft halo)
  for (const ft of floatingTexts) {
    const alpha = 1 - ft.age / ft.lifetime;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `600 ${ft.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawNeon(
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

  // ambient corner vignette — focuses attention toward the play field
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

  // hit vignette
  if (state.hitVignetteTime > 0) {
    const t = state.hitVignetteTime / HIT_VIGNETTE;
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

  drawHUD();

  // bullet-breaker bottom progress bar — full-width "you're in power mode" cue
  if (state.effects.breaker) {
    const cfg = settings.pickups.breaker;
    const t = Math.max(0, Math.min(1, state.effects.breaker.remaining / cfg.duration));
    const margin = 24;
    const barH = 4;
    const fullW = viewW - margin * 2;
    const barY = viewH - margin;
    ctx.save();
    ctx.fillStyle = "rgba(251,146,60,0.18)";
    ctx.fillRect(margin, barY, fullW, barH);
    ctx.fillStyle = "#fb923c";
    ctx.fillRect(margin, barY, fullW * t, barH);
    ctx.restore();
  }

  if (state.runState === "ended") {
    drawEndOverlay();
  }
}

function drawHUD() {
  const x0 = 22;
  const y0 = 22;
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // labels row
  ctx.font = "500 11px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#7d8590";
  ctx.fillText("TIME", x0, y0);
  ctx.fillText("HP", x0 + 220, y0);

  // TIME value (countdown if a limit is set, otherwise count up)
  ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#ffffff";
  const limit = settings.run.durationSec;
  const timeStr =
    limit > 0
      ? Math.max(0, limit - state.elapsed).toFixed(1)
      : state.elapsed.toFixed(1);
  ctx.fillText(timeStr, x0, y0 + 14);

  // hearts
  let heartX = x0 + 220;
  const heartY = y0 + 14;
  ctx.font = "600 22px system-ui, -apple-system, sans-serif";
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < state.hp ? "#ef4444" : "rgba(239,68,68,0.18)";
    ctx.fillText("♥", heartX, heartY);
    heartX += 22;
  }

  // SCORE / MULT row
  const row2y = y0 + 50;
  ctx.font = "500 11px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#7d8590";
  ctx.fillText("SCORE", x0, row2y);
  ctx.fillText("MULT", x0 + 220, row2y);

  ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(state.score.toLocaleString("en-US"), x0, row2y + 14);

  const multStr = `×${state.multiplier.toFixed(1)}`;
  const boosting = !!state.effects.scoreBoost;
  let mc = multColor(state.multiplier);
  if (boosting) {
    // purple pulse while score boost is active
    mc = "#c084fc";
    const pulse = 6 + 6 * Math.abs(Math.sin(performance.now() / 180));
    ctx.shadowColor = mc;
    ctx.shadowBlur = pulse;
  } else if (state.multiplier >= 3) {
    ctx.shadowColor = mc;
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = mc;
  ctx.fillText(multStr, x0 + 220, row2y + 14);
  ctx.shadowBlur = 0;

  // mult progress bar
  const barX = x0 + 220;
  const barY = row2y + 42;
  const barW = 120;
  const barH = 4;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(barX, barY, barW, barH);
  const t = (state.multiplier - MULT_MIN) / (MULT_MAX - MULT_MIN);
  ctx.fillStyle = mc;
  ctx.fillRect(barX, barY, barW * Math.max(0, Math.min(1, t)), barH);

  // active effects column (under the SCORE/MULT row)
  let effY = row2y + 60;
  ctx.font = "500 12px system-ui, -apple-system, sans-serif";
  if (state.effects.shield) {
    drawPickupIcon(ctx, x0 + 8, effY + 6, "shield");
    ctx.fillStyle = PICKUP_COLORS.shield;
    ctx.fillText(
      `SHIELD ${state.effects.shield.remaining.toFixed(1)}s  ×${state.effects.shield.charges}`,
      x0 + 22,
      effY,
    );
    effY += 20;
  }
  if (state.effects.scoreBoost) {
    drawPickupIcon(ctx, x0 + 8, effY + 6, "scoreBoost");
    ctx.fillStyle = PICKUP_COLORS.scoreBoost;
    ctx.fillText(
      `BOOST ${state.effects.scoreBoost.remaining.toFixed(1)}s`,
      x0 + 22,
      effY,
    );
    effY += 20;
  }
  if (state.effects.breaker) {
    drawPickupIcon(ctx, x0 + 8, effY + 6, "breaker");
    ctx.fillStyle = PICKUP_COLORS.breaker;
    ctx.fillText(
      `BREAK ${state.effects.breaker.remaining.toFixed(1)}s`,
      x0 + 22,
      effY,
    );
    effY += 20;
  }

  ctx.restore();
}

function drawEndOverlay() {
  const snap = state.endSnapshot;
  if (!snap) return;

  const w = 460;
  const h = 360;
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

  // header
  const headerColor = state.endReason === "ko" ? "#ff8b8b" : "#facc15";
  const headerText = state.endReason === "ko" ? "K.O." : "TIME'S UP";
  ctx.fillStyle = headerColor;
  ctx.font = "600 14px system-ui, -apple-system, sans-serif";
  ctx.fillText(headerText, x + w / 2, y + 22);

  // SCORE label
  ctx.fillStyle = "#7d8590";
  ctx.font = "500 11px system-ui, -apple-system, sans-serif";
  ctx.fillText("SCORE", x + w / 2, y + 50);

  // big score
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 48px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(snap.score.toLocaleString("en-US"), x + w / 2, y + 70);

  // stats
  ctx.font = "500 13px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#cccccc";
  ctx.fillText(
    `Best moment: ×${snap.bestMult.toFixed(1)}`,
    x + w / 2,
    y + 142,
  );
  ctx.fillText(
    `Survived: ${snap.survived.toFixed(1)}s`,
    x + w / 2,
    y + 164,
  );

  if (snap.configId) {
    const bestText =
      snap.bestScore != null ? snap.bestScore.toLocaleString("en-US") : "—";
    ctx.fillStyle = snap.newBest ? "#facc15" : "#cccccc";
    ctx.font = "500 13px system-ui, -apple-system, sans-serif";
    const label = snap.newBest
      ? `New best (${snap.configId}): ${bestText}`
      : `Best (${snap.configId}): ${bestText}`;
    ctx.fillText(label, x + w / 2, y + 198);
  } else {
    ctx.fillStyle = "#7d8590";
    ctx.font = "italic 500 12px system-ui, -apple-system, sans-serif";
    ctx.fillText(
      "Custom settings — record disabled",
      x + w / 2,
      y + 200,
    );
  }

  // buttons
  const btnW = 160;
  const btnH = 44;
  const btnGap = 20;
  const totalW = btnW * 2 + btnGap;
  const btnY = y + h - 76;
  const tryX = x + (w - totalW) / 2;
  const setX = tryX + btnW + btnGap;

  endTryAgainBounds = { x: tryX, y: btnY, w: btnW, h: btnH };
  endSettingsBounds = { x: setX, y: btnY, w: btnW, h: btnH };

  ctx.fillStyle = "rgba(0,229,255,0.18)";
  ctx.fillRect(tryX, btnY, btnW, btnH);
  ctx.strokeStyle = "rgba(0,229,255,0.7)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tryX + 0.5, btnY + 0.5, btnW - 1, btnH - 1);
  ctx.fillStyle = "#22d3ee";
  ctx.font = "600 13px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("TRY AGAIN ↵", tryX + btnW / 2, btnY + btnH / 2);

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(setX, btnY, btnW, btnH);
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(setX + 0.5, btnY + 0.5, btnW - 1, btnH - 1);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("SETTINGS", setX + btnW / 2, btnY + btnH / 2);

  ctx.restore();
}

requestAnimationFrame((t) => {
  lastTime = t;
  requestAnimationFrame(frame);
});
