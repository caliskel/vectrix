import {
  BLINK_CLOSE_DURATION_MS,
  BLINK_INTERVAL_MAX_MS,
  BLINK_INTERVAL_MIN_MS,
  BLINK_OPEN_DURATION_MS,
  DASH_GHOST_INITIAL_ALPHA,
  DASH_GHOST_INTERVAL_MS,
  DASH_GHOST_LIFETIME_MS,
  DASH_STRETCH_END_PHASE_MS,
  DASH_STRETCH_END_X,
  DASH_STRETCH_PEAK_PHASE_MS,
  DASH_STRETCH_PEAK_X,
  DASH_STRETCH_X,
  DASH_STRETCH_Y,
  IDLE_JITTER_AMPLITUDE,
  IDLE_LOOK_CALM_DOWN_MS,
  IDLE_LOOK_CENTER_CHANCE,
  IDLE_LOOK_FAR_DIST_RATIO,
  IDLE_LOOK_INTERVAL_MAX_MS,
  IDLE_LOOK_INTERVAL_MIN_MS,
  IDLE_LOOK_MID_DIST_RATIO,
  IDLE_LOOK_NEAR_DIST_RATIO,
  IDLE_LOOK_QUICK_DART_CHANCE,
  type Bindings,
} from "./config";
import { drawNeon } from "./neon";
import { PALETTE } from "./palette";

const SHAKE_DURATION = 0.2;
const DILATE_DURATION = 0.3;
const CLOSE_DURATION = 0.6;
const PUPIL_LERP_RATE = 8;
const SHAKE_RADIUS = 3;
const PUPIL_DILATE_PEAK = 0.5;

const BLINK_CLOSE_SEC = BLINK_CLOSE_DURATION_MS / 1000;
const BLINK_OPEN_SEC = BLINK_OPEN_DURATION_MS / 1000;
const BLINK_INTERVAL_MIN_SEC = BLINK_INTERVAL_MIN_MS / 1000;
const BLINK_INTERVAL_MAX_SEC = BLINK_INTERVAL_MAX_MS / 1000;
const BLINK_CYCLE_SEC = BLINK_CLOSE_SEC + BLINK_OPEN_SEC;
const DASH_GHOST_INTERVAL_SEC = DASH_GHOST_INTERVAL_MS / 1000;
const DASH_GHOST_LIFETIME_SEC = DASH_GHOST_LIFETIME_MS / 1000;
const DASH_PEAK_SEC = DASH_STRETCH_PEAK_PHASE_MS / 1000;
const DASH_END_SEC = DASH_STRETCH_END_PHASE_MS / 1000;
const IDLE_CALM_DOWN_SEC = IDLE_LOOK_CALM_DOWN_MS / 1000;
const IDLE_INTERVAL_MIN_SEC = IDLE_LOOK_INTERVAL_MIN_MS / 1000;
const IDLE_INTERVAL_MAX_SEC = IDLE_LOOK_INTERVAL_MAX_MS / 1000;
const IDLE_QUICK_DART_MIN_SEC = 0.3;
const IDLE_QUICK_DART_MAX_SEC = 0.5;
const IDLE_TIER_JITTER = 0.1; // ± around tier center, gives e.g. 0.2..0.4 for "near"

function randomBlinkInterval(): number {
  return (
    BLINK_INTERVAL_MIN_SEC +
    Math.random() * (BLINK_INTERVAL_MAX_SEC - BLINK_INTERVAL_MIN_SEC)
  );
}

export type DashGhost = {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  stretchX: number;
  stretchY: number;
  size: number;
  age: number;
  lifetime: number;
};

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
  shakeTime: number;
  dilateTime: number;
  // blink: 0..1 progress derived from blinkActive + blinkElapsed
  blinkActive: boolean;
  blinkElapsed: number;
  blinkCooldown: number;
  // open/close (death) — independent of blink
  isClosing: boolean;
  closeAmount: number;
  // dash ghost trail — captured stamps of the outer ring
  dashGhosts: DashGhost[];
  ghostSpawnTimer: number;
  // idle-look — pupil glances around when no threat is present
  idleTargetX: number;
  idleTargetY: number;
  nextIdleSwitchAt: number; // seconds (performance-clock-aligned)
  lastSawDangerAt: number;  // seconds (-Infinity = never)
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
    blinkActive: false,
    blinkElapsed: 0,
    blinkCooldown: randomBlinkInterval(),
    isClosing: false,
    closeAmount: 0,
    dashGhosts: [],
    ghostSpawnTimer: 0,
    idleTargetX: 0,
    idleTargetY: 0,
    nextIdleSwitchAt: 0,
    lastSawDangerAt: Number.NEGATIVE_INFINITY,
  };
}

export function resetEyeState(p: Player): void {
  p.pupilOffsetX = 0;
  p.pupilOffsetY = 0;
  p.shakeTime = 0;
  p.dilateTime = 0;
  p.blinkActive = false;
  p.blinkElapsed = 0;
  p.blinkCooldown = randomBlinkInterval();
  p.isClosing = false;
  p.closeAmount = 0;
  p.dashGhosts = [];
  p.ghostSpawnTimer = 0;
  p.idleTargetX = 0;
  p.idleTargetY = 0;
  p.nextIdleSwitchAt = 0;
  p.lastSawDangerAt = Number.NEGATIVE_INFINITY;
}

export function eyeOnHit(p: Player): void {
  p.shakeTime = SHAKE_DURATION;
  p.dilateTime = DILATE_DURATION;
}

export function eyeStartClosing(p: Player): void {
  p.isClosing = true;
}

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

export function dashSpeed(distance: number, durationMs: number): number {
  const dur = durationMs / 1000;
  return dur > 0 ? distance / dur : 0;
}

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

// Dash deformation factor along the dash axis. Combines a "pop" peak
// during the first frames, a stable middle, and a small squash at the
// tail. Ghost spawning captures this snapshot too.
function dashStretchX(
  dashTimeRemaining: number,
  dashDurationSec: number,
): number {
  const elapsed = dashDurationSec - dashTimeRemaining;
  if (elapsed < DASH_PEAK_SEC) {
    const t = elapsed / DASH_PEAK_SEC;
    return DASH_STRETCH_PEAK_X + (DASH_STRETCH_X - DASH_STRETCH_PEAK_X) * t;
  }
  if (dashTimeRemaining < DASH_END_SEC) {
    const t = 1 - dashTimeRemaining / DASH_END_SEC;
    return DASH_STRETCH_X + (DASH_STRETCH_END_X - DASH_STRETCH_X) * t;
  }
  return DASH_STRETCH_X;
}

function blinkProgress(p: Player): number {
  if (!p.blinkActive) return 0;
  if (p.blinkElapsed < BLINK_CLOSE_SEC) {
    return p.blinkElapsed / BLINK_CLOSE_SEC;
  }
  return 1 - (p.blinkElapsed - BLINK_CLOSE_SEC) / BLINK_OPEN_SEC;
}

export function updateEye(
  p: Player,
  dt: number,
  options: {
    threat: Pointable | null;
    size: number;
    dashDurationSec: number;
  },
): void {
  // shake/dilate countdown
  if (p.shakeTime > 0) p.shakeTime = Math.max(0, p.shakeTime - dt);
  if (p.dilateTime > 0) p.dilateTime = Math.max(0, p.dilateTime - dt);

  // blink scheduler
  if (p.blinkActive) {
    p.blinkElapsed += dt;
    if (p.blinkElapsed >= BLINK_CYCLE_SEC) {
      p.blinkActive = false;
      p.blinkElapsed = 0;
      p.blinkCooldown = randomBlinkInterval();
    }
  } else {
    p.blinkCooldown -= dt;
    if (p.blinkCooldown <= 0) {
      p.blinkActive = true;
      p.blinkElapsed = 0;
    }
  }

  // open/close (death) animation
  const closeSpeed = 1 / CLOSE_DURATION;
  if (p.isClosing) {
    p.closeAmount = Math.min(1, p.closeAmount + closeSpeed * dt);
  } else {
    p.closeAmount = Math.max(0, p.closeAmount - closeSpeed * dt);
  }

  const isDashing = p.dashTime > 0;

  // dash ghost emission
  if (isDashing) {
    p.ghostSpawnTimer += dt;
    while (p.ghostSpawnTimer >= DASH_GHOST_INTERVAL_SEC) {
      p.ghostSpawnTimer -= DASH_GHOST_INTERVAL_SEC;
      const sx = dashStretchX(p.dashTime, options.dashDurationSec);
      p.dashGhosts.push({
        x: p.x,
        y: p.y,
        dirX: p.dashDirX,
        dirY: p.dashDirY,
        stretchX: sx,
        stretchY: DASH_STRETCH_Y,
        size: options.size,
        age: 0,
        lifetime: DASH_GHOST_LIFETIME_SEC,
      });
    }
  } else {
    p.ghostSpawnTimer = 0;
  }

  // age + cull ghosts
  for (const g of p.dashGhosts) g.age += dt;
  if (p.dashGhosts.length > 0) {
    p.dashGhosts = p.dashGhosts.filter((g) => g.age < g.lifetime);
  }

  // pupil tracking — suspended during shake (panic in place)
  if (p.shakeTime > 0) return;

  const irisR = options.size * 0.42;
  const pupilR = options.size * 0.18;
  const maxOffset = (irisR - pupilR) * 0.7;
  const nowMs = performance.now();
  const nowSec = nowMs / 1000;

  let dx = 0;
  let dy = 0;

  if (isDashing) {
    const len = Math.hypot(p.dashDirX, p.dashDirY) || 1;
    dx = (p.dashDirX / len) * maxOffset;
    dy = (p.dashDirY / len) * maxOffset;
  } else if (options.threat) {
    p.lastSawDangerAt = nowSec;
    const tdx = options.threat.x - p.x;
    const tdy = options.threat.y - p.y;
    const tlen = Math.hypot(tdx, tdy) || 1;
    dx = (tdx / tlen) * maxOffset;
    dy = (tdy / tlen) * maxOffset;
  } else {
    const sinceDanger = nowSec - p.lastSawDangerAt;
    if (sinceDanger >= IDLE_CALM_DOWN_SEC) {
      // idle-look: glance around with weighted distance + occasional darts
      if (nowSec >= p.nextIdleSwitchAt) {
        pickIdleTarget(p, maxOffset);
        const quick = Math.random() < IDLE_LOOK_QUICK_DART_CHANCE;
        const dur = quick
          ? IDLE_QUICK_DART_MIN_SEC +
            Math.random() * (IDLE_QUICK_DART_MAX_SEC - IDLE_QUICK_DART_MIN_SEC)
          : IDLE_INTERVAL_MIN_SEC +
            Math.random() * (IDLE_INTERVAL_MAX_SEC - IDLE_INTERVAL_MIN_SEC);
        p.nextIdleSwitchAt = nowSec + dur;
      }
      // micro jitter so the pupil never sits perfectly still
      const jx = Math.sin(nowMs * 0.003) * IDLE_JITTER_AMPLITUDE;
      const jy = Math.cos(nowMs * 0.0027) * IDLE_JITTER_AMPLITUDE;
      dx = p.idleTargetX + jx;
      dy = p.idleTargetY + jy;
    }
    // sinceDanger < calm-down → target stays at (0, 0): "settling" forward
  }

  const k = 1 - Math.exp(-PUPIL_LERP_RATE * dt);
  p.pupilOffsetX += (dx - p.pupilOffsetX) * k;
  p.pupilOffsetY += (dy - p.pupilOffsetY) * k;
}

function pickIdleTarget(p: Player, maxOffset: number): void {
  if (Math.random() < IDLE_LOOK_CENTER_CHANCE) {
    p.idleTargetX = 0;
    p.idleTargetY = 0;
    return;
  }
  const tier = Math.random();
  let center: number;
  if (tier < 0.6) center = IDLE_LOOK_NEAR_DIST_RATIO;
  else if (tier < 0.9) center = IDLE_LOOK_MID_DIST_RATIO;
  else center = IDLE_LOOK_FAR_DIST_RATIO;
  const ratio = Math.max(
    0,
    Math.min(1, center + (Math.random() * 2 - 1) * IDLE_TIER_JITTER),
  );
  const angle = Math.random() * Math.PI * 2;
  const dist = ratio * maxOffset;
  p.idleTargetX = Math.cos(angle) * dist;
  p.idleTargetY = Math.sin(angle) * dist;
}

export type EyeRenderOpts = {
  ringColor: string;
  glowColor: string;
  pupilColor: string;
  ghostColor: string;
  dashDurationSec: number;
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

  // dash deformation
  const isDashing = p.dashTime > 0;
  let stretchX = 1;
  let stretchY = 1;
  let dashAngle = 0;
  let irisShift = 0;
  if (isDashing && opts.dashDurationSec > 0) {
    stretchX = dashStretchX(p.dashTime, opts.dashDurationSec);
    stretchY = DASH_STRETCH_Y;
    dashAngle = Math.atan2(p.dashDirY, p.dashDirX);
    irisShift = r * stretchX * 0.3;
  }

  // close (death) only — vertical squeeze of the entire eye
  const eyeOpenY = 1 - p.closeAmount;

  // shake jitter (one offset per frame)
  let sx = 0;
  let sy = 0;
  if (p.shakeTime > 0) {
    sx = (Math.random() * 2 - 1) * SHAKE_RADIUS;
    sy = (Math.random() * 2 - 1) * SHAKE_RADIUS;
  }

  const baseX = p.x + sx;
  const baseY = p.y + sy;

  // ===== ghosts (drawn first, behind the live eye) =====
  if (p.dashGhosts.length > 0) {
    drawDashGhosts(ctx, p.dashGhosts, opts.ghostColor, eyeOpenY);
  }

  // ===== outer ring (deformed in dash) =====
  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.scale(1, Math.max(0.001, eyeOpenY));
  drawNeon(
    ctx,
    () => {
      ctx.beginPath();
      if (isDashing) {
        ctx.ellipse(0, 0, r * stretchX, r * stretchY, dashAngle, 0, Math.PI * 2);
      } else {
        ctx.arc(0, 0, r, 0, Math.PI * 2);
      }
      ctx.strokeStyle = opts.ringColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    opts.glowColor,
    opts.blurStrong ?? 25,
    opts.blurSoft ?? 10,
  );
  ctx.restore();

  // ===== iris + pupil + highlight (NOT deformed; shifted forward in dash) =====
  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.scale(1, Math.max(0.001, eyeOpenY));
  if (isDashing) {
    ctx.translate(p.dashDirX * irisShift, p.dashDirY * irisShift);
  }
  ctx.fillStyle = PALETTE.bg;
  ctx.beginPath();
  ctx.arc(0, 0, irisR, 0, Math.PI * 2);
  ctx.fill();

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

  // ===== eyelids (clipped to the outer-ring shape) =====
  const blink = blinkProgress(p);
  if (blink > 0) {
    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.scale(1, Math.max(0.001, eyeOpenY));
    ctx.beginPath();
    if (isDashing) {
      ctx.ellipse(0, 0, r * stretchX, r * stretchY, dashAngle, 0, Math.PI * 2);
    } else {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    }
    ctx.clip();
    const lidH = blink * r;
    const lidW = r * Math.max(stretchX, 1) * 2 + 4;
    ctx.fillStyle = opts.ringColor;
    ctx.fillRect(-lidW / 2, -r * Math.max(stretchY, 1) - 2, lidW, lidH + 2);
    ctx.fillRect(
      -lidW / 2,
      r * Math.max(stretchY, 1) - lidH,
      lidW,
      lidH + 2,
    );
    ctx.restore();
  }
}

function drawDashGhosts(
  ctx: CanvasRenderingContext2D,
  ghosts: DashGhost[],
  color: string,
  eyeOpenY: number,
): void {
  for (const g of ghosts) {
    const t = g.age / g.lifetime;
    const alpha = (1 - t) * DASH_GHOST_INITIAL_ALPHA;
    if (alpha <= 0) continue;
    const fade = 1 - t * 0.3; // shrink slightly as it ages
    const ghostAngle = Math.atan2(g.dirY, g.dirX);
    ctx.save();
    ctx.globalAlpha = alpha;
    // ghosts sit at their captured world positions; they ride the
    // same close (death) squeeze so they fade with the player
    ctx.translate(g.x, g.y);
    ctx.scale(1, Math.max(0.001, eyeOpenY));
    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      (g.size / 2) * g.stretchX * fade,
      (g.size / 2) * g.stretchY * fade,
      ghostAngle,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
