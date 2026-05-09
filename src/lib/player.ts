import type { Bindings } from "./config";
import { drawNeon } from "./neon";
import { PALETTE } from "./palette";

// Eye-state durations (seconds).
const SHAKE_DURATION = 0.2;
const DILATE_DURATION = 0.3;
const BLINK_DURATION = 0.2;
const CLOSE_DURATION = 0.6;
const PUPIL_LERP_RATE = 8; // 1 - exp(-rate * dt) ≈ 0.12 at 60 fps
const SHAKE_RADIUS = 3;
const PUPIL_DILATE_PEAK = 0.5; // +50%

export type Player = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  dashTime: number;
  dashIframeTime: number;
  cooldown: number;
  dashDirX: number;
  dashDirY: number;
  // ----- eye state -----
  pupilOffsetX: number;
  pupilOffsetY: number;
  shakeTime: number;     // counts down after a hit
  dilateTime: number;    // counts down after a hit (pupil grows then settles)
  blinkTime: number;     // counts down during a blink
  blinkCooldown: number; // counts down to the next blink
  isClosing: boolean;    // mode flips this on death
  closeAmount: number;   // 0..1 animated toward isClosing
};

export function createPlayer(): Player {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facingX: 0,
    facingY: -1,
    dashTime: 0,
    dashIframeTime: 0,
    cooldown: 0,
    dashDirX: 0,
    dashDirY: 0,
    pupilOffsetX: 0,
    pupilOffsetY: 0,
    shakeTime: 0,
    dilateTime: 0,
    blinkTime: 0,
    blinkCooldown: 4 + Math.random() * 3,
    isClosing: false,
    closeAmount: 0,
  };
}

export function resetEyeState(p: Player): void {
  p.pupilOffsetX = 0;
  p.pupilOffsetY = 0;
  p.shakeTime = 0;
  p.dilateTime = 0;
  p.blinkTime = 0;
  p.blinkCooldown = 4 + Math.random() * 3;
  p.isClosing = false;
  p.closeAmount = 0;
}

// Triggered by a damaging hit. Pupil dilates, eye shakes briefly,
// pupil tracking is suspended for the shake window.
export function eyeOnHit(p: Player): void {
  p.shakeTime = SHAKE_DURATION;
  p.dilateTime = DILATE_DURATION;
}

export function eyeStartClosing(p: Player): void {
  p.isClosing = true;
}

// Resolve normalized movement input from currently-pressed keys.
export function inputDirection(
  keys: Set<string>,
  bindings: Bindings,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (keys.has(bindings.left)) x -= 1;
  if (keys.has(bindings.right)) x += 1;
  if (keys.has(bindings.up)) y -= 1;
  if (keys.has(bindings.down)) y += 1;
  const len = Math.hypot(x, y);
  if (len > 0) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

// Dash speed derived from configured distance and duration so both menu
// sliders are live (settings.dash.distance / durationMs).
export function dashSpeed(distance: number, durationMs: number): number {
  const dur = durationMs / 1000;
  return dur > 0 ? distance / dur : 0;
}

// Closest threat (bullet or enemy) to the player. Used by the pupil to
// pick what to look at. Returns null when nothing is on the field.
type Pointable = { x: number; y: number };
type EnemyLike = { x: number; y: number; isDead: () => boolean };

export function findNearestThreat(
  px: number,
  py: number,
  bullets: Pointable[],
  enemies?: EnemyLike[],
): Pointable | null {
  let best: Pointable | null = null;
  let bestD = Infinity;
  for (const b of bullets) {
    const dx = b.x - px;
    const dy = b.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = b;
    }
  }
  if (enemies) {
    for (const e of enemies) {
      if (e.isDead()) continue;
      const dx = e.x - px;
      const dy = e.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    }
  }
  return best;
}

// Per-frame update for the eye-state values: shake/dilate decay,
// blink scheduler + animation, pupil tracking with inertia, and the
// open/close animation. Caller passes the current size to derive the
// pupil's allowed travel range.
export function updateEye(
  p: Player,
  dt: number,
  options: {
    isDashing: boolean;
    threat: Pointable | null;
    size: number;
  },
): void {
  // shake/dilate countdown
  if (p.shakeTime > 0) p.shakeTime = Math.max(0, p.shakeTime - dt);
  if (p.dilateTime > 0) p.dilateTime = Math.max(0, p.dilateTime - dt);

  // blink scheduling
  if (p.blinkTime > 0) {
    p.blinkTime = Math.max(0, p.blinkTime - dt);
  } else {
    p.blinkCooldown -= dt;
    if (p.blinkCooldown <= 0) {
      p.blinkTime = BLINK_DURATION;
      p.blinkCooldown = 4 + Math.random() * 3;
    }
  }

  // open/close animation
  const closeSpeed = 1 / CLOSE_DURATION;
  if (p.isClosing) {
    p.closeAmount = Math.min(1, p.closeAmount + closeSpeed * dt);
  } else {
    p.closeAmount = Math.max(0, p.closeAmount - closeSpeed * dt);
  }

  // pupil tracking
  if (p.shakeTime > 0) {
    // tracking suspended during shake — the pupil "panics" in place
    return;
  }

  const irisR = options.size * 0.42;
  const pupilR = options.size * 0.18;
  const maxOffset = (irisR - pupilR) * 0.7;

  let dx = 0;
  let dy = 0;
  if (options.isDashing) {
    const len = Math.hypot(p.dashDirX, p.dashDirY) || 1;
    dx = (p.dashDirX / len) * maxOffset;
    dy = (p.dashDirY / len) * maxOffset;
  } else if (options.threat) {
    const tdx = options.threat.x - p.x;
    const tdy = options.threat.y - p.y;
    const tlen = Math.hypot(tdx, tdy) || 1;
    dx = (tdx / tlen) * maxOffset;
    dy = (tdy / tlen) * maxOffset;
  }
  // ...else target is (0,0) so pupil drifts forward when nothing's around.

  const k = 1 - Math.exp(-PUPIL_LERP_RATE * dt);
  p.pupilOffsetX += (dx - p.pupilOffsetX) * k;
  p.pupilOffsetY += (dy - p.pupilOffsetY) * k;
}

export type EyeRenderOpts = {
  ringColor: string;
  glowColor: string;
  pupilColor: string;
  blurStrong?: number;
  blurSoft?: number;
};

export function drawPlayerEye(
  ctx: CanvasRenderingContext2D,
  p: Player,
  size: number,
  opts: EyeRenderOpts,
): void {
  const r = size / 2;
  const irisR = size * 0.42;
  const pupilRBase = size * 0.18;
  const highlightR = size * 0.06;

  // dilation factor (1 → 1.5 over the dilate window)
  const dilateProgress = p.dilateTime > 0 ? p.dilateTime / DILATE_DURATION : 0;
  const dilateFactor = 1 + PUPIL_DILATE_PEAK * dilateProgress;
  const pupilR = pupilRBase * dilateFactor;

  // blink scaleY (1 → 0.1 → 1 over BLINK_DURATION)
  let blinkScale = 1;
  if (p.blinkTime > 0) {
    const elapsed = BLINK_DURATION - p.blinkTime;
    const half = BLINK_DURATION / 2;
    if (elapsed < half) {
      blinkScale = 1 - 0.9 * (elapsed / half);
    } else {
      blinkScale = 0.1 + 0.9 * ((elapsed - half) / half);
    }
  }

  // close amount drives a vertical squeeze; multiplied with blink so a
  // blink mid-death still reads
  const eyeScaleY = blinkScale * (1 - p.closeAmount);

  // shake jitter (one random offset per frame, applied as translate)
  let sx = 0;
  let sy = 0;
  if (p.shakeTime > 0) {
    sx = (Math.random() * 2 - 1) * SHAKE_RADIUS;
    sy = (Math.random() * 2 - 1) * SHAKE_RADIUS;
  }

  ctx.save();
  ctx.translate(p.x + sx, p.y + sy);
  ctx.scale(1, Math.max(0.001, eyeScaleY));

  // outer ring with the neon halo — this is the main player-color cue
  drawNeon(
    ctx,
    () => {
      ctx.strokeStyle = opts.ringColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    },
    opts.glowColor,
    opts.blurStrong ?? 25,
    opts.blurSoft ?? 10,
  );

  // dark iris fills the inside so the pupil reads as a bright disc
  ctx.fillStyle = PALETTE.bg;
  ctx.beginPath();
  ctx.arc(0, 0, irisR, 0, Math.PI * 2);
  ctx.fill();

  // pupil — softly glowing
  drawNeon(
    ctx,
    () => {
      ctx.fillStyle = opts.pupilColor;
      ctx.beginPath();
      ctx.arc(p.pupilOffsetX, p.pupilOffsetY, pupilR, 0, Math.PI * 2);
      ctx.fill();
    },
    opts.pupilColor,
    10,
    4,
  );

  // tiny upper-left highlight on the pupil (relative to pupil center)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(
    p.pupilOffsetX - pupilR * 0.35,
    p.pupilOffsetY - pupilR * 0.35,
    highlightR,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
}
