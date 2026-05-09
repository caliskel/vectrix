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
  BOB_AMPLITUDE_PX,
  BOB_FREQUENCY_FACTOR,
  BOB_VELOCITY_THRESHOLD,
  BRAKE_CUR_MAX,
  BRAKE_DURATION_MS,
  BRAKE_PREV_MIN,
  BRAKE_SQUASH_X,
  BRAKE_STRETCH_Y,
  IDLE_JITTER_AMPLITUDE,
  IDLE_LOOK_CALM_DOWN_MS,
  IDLE_LOOK_CENTER_CHANCE,
  IDLE_LOOK_FAR_DIST_RATIO,
  IDLE_LOOK_INTERVAL_MAX_MS,
  IDLE_LOOK_INTERVAL_MIN_MS,
  IDLE_LOOK_MID_DIST_RATIO,
  IDLE_LOOK_NEAR_DIST_RATIO,
  IDLE_LOOK_QUICK_DART_CHANCE,
  LEAN_LERP,
  LEAN_MAX_DIAGONAL_RAD,
  LEAN_MAX_HORIZONTAL_RAD,
  LEAN_VELOCITY_THRESHOLD,
  SQUASH_DURATION_MS,
  SQUASH_Y,
  START_SQUASH_CUR_MIN,
  START_SQUASH_PREV_MAX,
  STRETCH_X,
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
// Derive a per-second lerp rate from the per-frame target so the easing
// stays rate-correct even when the framerate drops. With LEAN_LERP=0.12
// at 60 fps this gives ~7.7 / s; we round up slightly for snap.
const LEAN_LERP_RATE = -Math.log(1 - LEAN_LERP) * 60;
const BOB_DECAY_RATE = 6; // how fast bob phase eases to neutral when stopped
const SQUASH_DURATION_SEC = SQUASH_DURATION_MS / 1000;
const BRAKE_DURATION_SEC = BRAKE_DURATION_MS / 1000;

function randomBlinkInterval(): number {
  return (
    BLINK_INTERVAL_MIN_SEC +
    Math.random() * (BLINK_INTERVAL_MAX_SEC - BLINK_INTERVAL_MIN_SEC)
  );
}

// PlayerProfile — color customization owned by the landing-page editor
// and applied in rooms. Sandbox keeps using the palette directly.
export type PlayerProfile = {
  outerRing: string;
  iris: string;
  pupil: string;
  /** Color of the sparks emitted while dashing. Doesn't recolor the eye
   *  itself — the dash-state ring/pupil/glow stay on PALETTE.playerDash. */
  dashParticles: string;
};

export const DEFAULT_PLAYER_PROFILE: PlayerProfile = {
  outerRing: "#ffffff",
  iris: "#0a0e1a",
  pupil: "#ffffff",
  dashParticles: "#00e5ff",
};

export const PLAYER_PROFILE_KEY = "dash-proto:player-profile";

export function loadPlayerProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(PLAYER_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
      // soft migration: profiles saved before this rename used `dashColor`
      // for the same purpose; treat it as a fallback so existing players
      // keep their pick.
      const legacyDash = (parsed as Record<string, unknown>).dashColor;
      const dashParticlesRaw =
        typeof parsed.dashParticles === "string"
          ? parsed.dashParticles
          : typeof legacyDash === "string"
            ? legacyDash
            : DEFAULT_PLAYER_PROFILE.dashParticles;
      return {
        outerRing:
          typeof parsed.outerRing === "string"
            ? parsed.outerRing
            : DEFAULT_PLAYER_PROFILE.outerRing,
        iris:
          typeof parsed.iris === "string"
            ? parsed.iris
            : DEFAULT_PLAYER_PROFILE.iris,
        pupil:
          typeof parsed.pupil === "string"
            ? parsed.pupil
            : DEFAULT_PLAYER_PROFILE.pupil,
        dashParticles: dashParticlesRaw,
      };
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_PLAYER_PROFILE };
}

export function savePlayerProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore quota / privacy-mode errors
  }
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
  // movement animations
  tiltAngle: number;        // current lean (radians), eases toward target
  bobPhase: number;         // accumulator for the sin bob wave
  squashTime: number;       // counts down through SQUASH_DURATION_SEC (start pop)
  brakeSquashTime: number;  // counts down through BRAKE_DURATION_SEC (sharp stop)
  prevSpeed: number;        // last frame's speed, used for squash + brake triggers
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
    tiltAngle: 0,
    bobPhase: 0,
    squashTime: 0,
    brakeSquashTime: 0,
    prevSpeed: 0,
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
  p.tiltAngle = 0;
  p.bobPhase = 0;
  p.squashTime = 0;
  p.brakeSquashTime = 0;
  p.prevSpeed = 0;
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
  // movement animations: lean, bob, squash + brake. Skipped when dashing
  // (dash owns its own deformation) — tilt eases back to 0 in that case.
  const speed = Math.hypot(p.vx, p.vy);
  const isDashing = p.dashTime > 0;
  const movingForLean = speed >= LEAN_VELOCITY_THRESHOLD && !isDashing;
  const movingForBob = speed >= BOB_VELOCITY_THRESHOLD && !isDashing;

  // start-pop trigger — speed jumped from near-zero past 100 in one
  // frame (with our high acceleration this is a fresh keypress)
  if (
    !isDashing &&
    p.prevSpeed < START_SQUASH_PREV_MAX &&
    speed >= START_SQUASH_CUR_MIN
  ) {
    p.squashTime = SQUASH_DURATION_SEC;
    p.brakeSquashTime = 0; // start cancels any active brake
  }
  // brake-pop trigger — speed plummeted from above 100 to below 60 in
  // one frame (active counter-input). Friction-only stops are gradual
  // and will not fire this.
  if (
    !isDashing &&
    p.prevSpeed > BRAKE_PREV_MIN &&
    speed < BRAKE_CUR_MAX &&
    p.brakeSquashTime <= 0
  ) {
    p.brakeSquashTime = BRAKE_DURATION_SEC;
    p.squashTime = 0; // brake cancels any active start-pop
  }
  if (p.squashTime > 0) p.squashTime = Math.max(0, p.squashTime - dt);
  if (p.brakeSquashTime > 0)
    p.brakeSquashTime = Math.max(0, p.brakeSquashTime - dt);
  p.prevSpeed = speed;

  // tilt target — sign of vx, with diagonal getting a smaller angle and
  // pure vertical leaving the eye upright
  let tiltTarget = 0;
  if (movingForLean) {
    const ax = Math.abs(p.vx);
    const ay = Math.abs(p.vy);
    if (ax > ay) {
      const mostlyHorizontal = ax > ay * 3;
      tiltTarget =
        Math.sign(p.vx) *
        (mostlyHorizontal ? LEAN_MAX_HORIZONTAL_RAD : LEAN_MAX_DIAGONAL_RAD);
    }
  }
  const leanK = 1 - Math.exp(-LEAN_LERP_RATE * dt);
  p.tiltAngle += (tiltTarget - p.tiltAngle) * leanK;

  // bob — phase advances proportional to speed while moving (down to
  // walk speed via BOB_VELOCITY_THRESHOLD); when stopped it eases to the
  // nearest "neutral" multiple of π so sin(phase) = 0
  if (movingForBob) {
    p.bobPhase += dt * (speed / BOB_FREQUENCY_FACTOR);
  } else {
    const target = Math.round(p.bobPhase / Math.PI) * Math.PI;
    const k = 1 - Math.exp(-BOB_DECAY_RATE * dt);
    p.bobPhase += (target - p.bobPhase) * k;
  }

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
  /** Defaults to PALETTE.bg when neither this nor profile.iris is set. */
  irisColor?: string;
  blurStrong?: number;
  blurSoft?: number;
  /**
   * When provided, overrides ringColor / pupilColor / irisColor with the
   * profile's values — the eye reads as the player's saved customization
   * regardless of dash/walk state.
   */
  profile?: PlayerProfile;
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

  // Resolve final colors. Profile takes over for outer ring + pupil only
  // when the eye is in its idle/walk state — during a dash (or its i-frame)
  // we keep the original opts values (mode passes settings.player.colorDash)
  // so the "locked-on" dash cue and ghost trail stay on the canonical
  // dash color, regardless of customization. Iris always follows profile.
  const inDashColorState = isDashing || p.dashIframeTime > 0;
  const useProfileForBody = !!opts.profile && !inDashColorState;
  const ringColor = useProfileForBody
    ? (opts.profile as PlayerProfile).outerRing
    : opts.ringColor;
  const pupilColor = useProfileForBody
    ? (opts.profile as PlayerProfile).pupil
    : opts.pupilColor;
  const glowColor = useProfileForBody
    ? (opts.profile as PlayerProfile).outerRing
    : opts.glowColor;
  const irisColor = opts.profile?.iris ?? opts.irisColor ?? PALETTE.bg;
  const ghostColor = opts.ghostColor;

  // ===== ghosts (drawn first, behind the live eye, in world space) =====
  if (p.dashGhosts.length > 0) {
    drawDashGhosts(ctx, p.dashGhosts, ghostColor, eyeOpenY);
  }

  // Per-frame movement deformations applied to the live eye only.
  // Order: translate → close (world Y squeeze) → rotate (lean) →
  // translate(0, bobY) → scale (squash) → draw layers inside.
  const bobOffsetY =
    BOB_AMPLITUDE_PX * Math.sin(p.bobPhase) * (isDashing ? 0 : 1);
  // start pop and brake squeeze are mutually exclusive (each clears the
  // other on trigger). Pick whichever has time remaining and lerp its
  // scale back to 1 over its window.
  let squashSx = 1;
  let squashSy = 1;
  if (p.squashTime > 0) {
    const t = p.squashTime / SQUASH_DURATION_SEC;
    squashSx = 1 + (STRETCH_X - 1) * t;
    squashSy = 1 + (SQUASH_Y - 1) * t;
  } else if (p.brakeSquashTime > 0) {
    const t = p.brakeSquashTime / BRAKE_DURATION_SEC;
    squashSx = 1 + (BRAKE_SQUASH_X - 1) * t;
    squashSy = 1 + (BRAKE_STRETCH_Y - 1) * t;
  }
  const hasSquash = squashSx !== 1 || squashSy !== 1;

  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.scale(1, Math.max(0.001, eyeOpenY));
  if (p.tiltAngle !== 0) ctx.rotate(p.tiltAngle);
  if (bobOffsetY !== 0) ctx.translate(0, bobOffsetY);
  if (hasSquash) ctx.scale(squashSx, squashSy);

  // ===== outer ring (deformed in dash) =====
  drawNeon(
    ctx,
    () => {
      ctx.beginPath();
      if (isDashing) {
        ctx.ellipse(0, 0, r * stretchX, r * stretchY, dashAngle, 0, Math.PI * 2);
      } else {
        ctx.arc(0, 0, r, 0, Math.PI * 2);
      }
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    glowColor,
    opts.blurStrong ?? 25,
    opts.blurSoft ?? 10,
  );

  // ===== iris + pupil + highlight (NOT deformed; shifted forward in dash) =====
  ctx.save();
  if (isDashing) {
    ctx.translate(p.dashDirX * irisShift, p.dashDirY * irisShift);
  }
  ctx.fillStyle = irisColor;
  ctx.beginPath();
  ctx.arc(0, 0, irisR, 0, Math.PI * 2);
  ctx.fill();

  drawNeon(
    ctx,
    () => {
      ctx.fillStyle = pupilColor;
      ctx.beginPath();
      ctx.arc(p.pupilOffsetX, p.pupilOffsetY, pupilR, 0, Math.PI * 2);
      ctx.fill();
    },
    pupilColor,
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

  // ===== eyelids (clipped to the outer-ring shape, sharing the live transform) =====
  const blink = blinkProgress(p);
  if (blink > 0) {
    ctx.save();
    ctx.beginPath();
    if (isDashing) {
      ctx.ellipse(0, 0, r * stretchX, r * stretchY, dashAngle, 0, Math.PI * 2);
    } else {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    }
    ctx.clip();
    const lidH = blink * r;
    const lidW = r * Math.max(stretchX, 1) * 2 + 4;
    ctx.fillStyle = ringColor;
    ctx.fillRect(-lidW / 2, -r * Math.max(stretchY, 1) - 2, lidW, lidH + 2);
    ctx.fillRect(
      -lidW / 2,
      r * Math.max(stretchY, 1) - lidH,
      lidW,
      lidH + 2,
    );
    ctx.restore();
  }

  ctx.restore();
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
