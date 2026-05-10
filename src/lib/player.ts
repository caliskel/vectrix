import {
  BLINK_CLOSE_DURATION_MS,
  BLINK_INTERVAL_MAX_MS,
  BLINK_INTERVAL_MIN_MS,
  BLINK_OPEN_DURATION_MS,
  ANISOTROPIC_STRETCH_MAX,
  ANISOTROPIC_STRETCH_VELOCITY_FACTOR,
  ANISOTROPIC_STRETCH_VELOCITY_THRESHOLD,
  BRAKE_DROP_TIME_MS,
  BRAKE_RECOVERY_MS,
  BRAKE_VELOCITY_DROP_THRESHOLD,
  BREATH_AMPLITUDE,
  BREATH_INHALE_FRACTION,
  BREATH_PERIOD_MS,
  DASH_GHOST_INITIAL_ALPHA,
  DASH_GHOST_INTERVAL_MS,
  DASH_GHOST_LIFETIME_MS,
  DASH_STRETCH_END_PHASE_MS,
  DASH_STRETCH_END_X,
  DASH_STRETCH_PEAK_PHASE_MS,
  DASH_STRETCH_PEAK_X,
  DASH_STRETCH_X,
  DASH_STRETCH_Y,
  DOUBLE_BLINK_CHANCE,
  DOUBLE_BLINK_DELAY_MS,
  BOB_AMPLITUDE_PX,
  BOB_FREQUENCY_FACTOR,
  BOB_VELOCITY_THRESHOLD,
  BRAKE_DURATION_MS,
  BRAKE_SQUASH_X,
  BRAKE_STRETCH_Y,
  FLINCH_COOLDOWN_MS,
  FLINCH_DURATION_MS,
  FLINCH_OFFSET_PX,
  FLINCH_PUPIL_RECOVER_MS,
  FLINCH_PUPIL_SHRINK,
  FLINCH_RADIUS_EXTRA,
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
  PUPIL_DILATION_LERP,
  PUPIL_DILATION_MAX,
  PUPIL_DILATION_MIN,
  PUPIL_ENEMY_THREAT_RADIUS,
  PUPIL_THREAT_RADIUS,
  SMASH_COOLDOWN_MS,
  SMASH_DURATION_MS,
  SMASH_FULL_IMPACT_VELOCITY,
  SMASH_MAX_SQUASH,
  SMASH_MIN_IMPACT_VELOCITY,
  SMASH_MIN_SQUASH,
  SMASH_OVERSHOOT_MS,
  SMASH_RECOVERY_MS,
  SQUASH_DURATION_MS,
  SQUASH_Y,
  START_SQUASH_CUR_MIN,
  START_SQUASH_PREV_MAX,
  STRETCH_X,
} from "./config";
import { isActionPressed, type KeybindProfile } from "./keybinds";
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
// Second blink in a double-blink is faster than the first; the
// asymmetry is what makes the rare double feel like a "twitch" rather
// than two identical blinks.
const DOUBLE_BLINK_CLOSE_SEC = 0.05;
const DOUBLE_BLINK_OPEN_SEC = 0.1;
const DOUBLE_BLINK_DELAY_SEC = DOUBLE_BLINK_DELAY_MS / 1000;
const BLINK_INTERVAL_MIN_SEC = BLINK_INTERVAL_MIN_MS / 1000;
const BLINK_INTERVAL_MAX_SEC = BLINK_INTERVAL_MAX_MS / 1000;
const BREATH_PHASE_RATE = (Math.PI * 2) / (BREATH_PERIOD_MS / 1000);
// Flinch effects: ring/iris offset is the shortest, body squash even
// shorter, and the pupil shrink+recover the longest. Hold the pupil
// at full shrink for 100 ms before recovering over FLINCH_PUPIL_RECOVER.
const FLINCH_DURATION_SEC = FLINCH_DURATION_MS / 1000;
const FLINCH_COOLDOWN_SEC = FLINCH_COOLDOWN_MS / 1000;
const FLINCH_PUPIL_RECOVER_SEC = FLINCH_PUPIL_RECOVER_MS / 1000;
const FLINCH_PUPIL_HOLD_SEC = 0.1;
const FLINCH_PUPIL_TOTAL_SEC = FLINCH_PUPIL_HOLD_SEC + FLINCH_PUPIL_RECOVER_SEC;
const FLINCH_SQUASH_SEC = 0.06;
const FLINCH_SQUASH_Y = 0.94;
const DASH_GHOST_INTERVAL_SEC = DASH_GHOST_INTERVAL_MS / 1000;
const DASH_GHOST_LIFETIME_SEC = DASH_GHOST_LIFETIME_MS / 1000;
// Recharge indicator — partial arc visible while the cooldown is
// ticking. The "READY" flash is a single short ring expanding outward
// the frame the cooldown hits zero.
const COOLDOWN_RING_RADIUS_FACTOR = 0.9;
const COOLDOWN_RING_LINEWIDTH = 2;
const COOLDOWN_RING_ALPHA = 0.6;
const COOLDOWN_READY_FLASH_SEC = 0.2;
const COOLDOWN_READY_FLASH_END_RADIUS_FACTOR = 1.4;
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
const BRAKE_RECOVERY_SEC = BRAKE_RECOVERY_MS / 1000;
const BRAKE_TOTAL_SEC = BRAKE_DURATION_SEC + BRAKE_RECOVERY_SEC;
// Per-second deceleration that triggers a brake squeeze. Derived from
// the user-facing "drop X over Y ms" pair so callers reason in absolute
// terms while we compare against current frame's deceleration.
const BRAKE_DECEL_THRESHOLD =
  (BRAKE_VELOCITY_DROP_THRESHOLD * 1000) / BRAKE_DROP_TIME_MS;
const SMASH_DURATION_SEC = SMASH_DURATION_MS / 1000;
const SMASH_OVERSHOOT_SEC = SMASH_OVERSHOOT_MS / 1000;
const SMASH_RECOVERY_SEC = SMASH_RECOVERY_MS / 1000;
const SMASH_TOTAL_SEC = SMASH_DURATION_SEC + SMASH_RECOVERY_SEC;
const SMASH_OVERSHOOT_SQUASH = 1.05; // peak overshoot scale along normal
const SMASH_OVERSHOOT_STRETCH = 0.95; // peak overshoot scale perpendicular
const SMASH_COOLDOWN_SEC = SMASH_COOLDOWN_MS / 1000;

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
  /** "Dash energy" colour — drives the spark trail emitted while
   *  dashing AND the halo (neon shadow) around the outer ring during
   *  a dash. The eye body layers (ring/iris/pupil) keep their own
   *  profile colours; only the halo and trail flip to this. */
  dashParticles: string;
};

// Default skin: monochrome white orb with a neutral grey dash trail.
// Minimalist starting point — players opt into colour via the Player
// overlay on the landing page; the sandbox / tutorial / rooms loops
// don't fork their own player colours anymore.
export const DEFAULT_PLAYER_PROFILE: PlayerProfile = {
  outerRing: "#ffffff",
  iris: "#ffffff",
  pupil: "#000000",
  dashParticles: "#9ca3af",
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
  // captured eye state at emission — drawDashGhosts replays it so the
  // ghost reads as a full skin echo (ring + iris + pupil + highlight),
  // not just an outer-ring outline.
  pupilOffsetX: number;
  pupilOffsetY: number;
  pupilR: number;
  eyeOpenY: number;
  blinkAmount: number;
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
  /** Last frame's `cooldown` value, used to detect the cooldown→0
   *  transition that fires the "READY" flash on the recharge ring. */
  prevCooldown: number;
  /** Countdown for the "dash ready" flash ring. Set to a small
   *  positive duration (≈0.2 s) on the moment cooldown hits zero;
   *  decays per frame. The recharge-indicator helper reads this to
   *  draw an expanding alpha-fading ring as a clean "go" signal. */
  cooldownReadyFlash: number;
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
  // brake squeeze: counts up from 0; first BRAKE_DURATION_SEC holds full
  // squash, the next BRAKE_RECOVERY_SEC eases to neutral. -1 = inactive.
  brakeAge: number;
  prevSpeed: number;        // last frame's speed, used for squash + brake triggers
  // wall-impact smash. smashAge counts up; phases derived from it. -1 = inactive.
  smashAge: number;
  smashSquashAlong: number; // peak squash scale along the contact normal
  smashNormalX: number;     // unit vector pointing away from the surface
  smashNormalY: number;
  smashCooldown: number;    // gates re-trigger so resting against a wall doesn't pulse
  // micro-animations: breathing, threat-driven dilation, double blink, flinch
  breathPhase: number;      // accumulator for the idle breath sin wave
  pupilDilation: number;    // smoothed factor (PUPIL_DILATION_MIN..MAX) applied to pupil
  doubleBlinkPending: boolean; // current blink will be followed by a faster second
  inDoubleBlink: boolean;   // currently running the faster second blink
  flinchTime: number;       // ring/iris offset countdown
  flinchPupilTime: number;  // pupil shrink/recover countdown
  flinchSquashTime: number; // body vertical squeeze countdown
  flinchCooldown: number;   // gate so a bullet shower can't make us vibrate
  flinchDirX: number;       // unit direction the eye is recoiling toward
  flinchDirY: number;
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
    prevCooldown: 0,
    cooldownReadyFlash: 0,
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
    brakeAge: -1,
    prevSpeed: 0,
    smashAge: -1,
    smashSquashAlong: 1,
    smashNormalX: 1,
    smashNormalY: 0,
    smashCooldown: 0,
    breathPhase: Math.random() * Math.PI * 2,
    pupilDilation: PUPIL_DILATION_MAX,
    doubleBlinkPending: false,
    inDoubleBlink: false,
    flinchTime: 0,
    flinchPupilTime: 0,
    flinchSquashTime: 0,
    flinchCooldown: 0,
    flinchDirX: 0,
    flinchDirY: 0,
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
  p.brakeAge = -1;
  p.prevSpeed = 0;
  p.smashAge = -1;
  p.smashSquashAlong = 1;
  p.smashNormalX = 1;
  p.smashNormalY = 0;
  p.smashCooldown = 0;
  p.prevCooldown = 0;
  p.cooldownReadyFlash = 0;
  p.breathPhase = Math.random() * Math.PI * 2;
  p.pupilDilation = PUPIL_DILATION_MAX;
  p.doubleBlinkPending = false;
  p.inDoubleBlink = false;
  p.flinchTime = 0;
  p.flinchPupilTime = 0;
  p.flinchSquashTime = 0;
  p.flinchCooldown = 0;
  p.flinchDirX = 0;
  p.flinchDirY = 0;
}

export function eyeOnHit(p: Player): void {
  p.shakeTime = SHAKE_DURATION;
  p.dilateTime = DILATE_DURATION;
}

export function eyeStartClosing(p: Player): void {
  p.isClosing = true;
}

/**
 * Trigger a wall-impact smash. Returns the strength factor (0..1) used
 * for the squash so the caller can pass it on to the audio cue, or -1
 * when the impact didn't qualify (cooldown active or below the minimum
 * inward velocity).
 *
 * Normal must point AWAY from the surface (toward the player). Impact
 * velocity is the magnitude of the inward velocity component; weaker
 * impacts produce a softer squash via lerp from SMASH_MIN_SQUASH to
 * SMASH_MAX_SQUASH.
 */
export function triggerPlayerSmash(
  p: Player,
  normalX: number,
  normalY: number,
  impactVelocity: number,
): number {
  if (p.smashCooldown > 0) return -1;
  if (impactVelocity < SMASH_MIN_IMPACT_VELOCITY) return -1;
  const t = Math.min(
    1,
    (impactVelocity - SMASH_MIN_IMPACT_VELOCITY) /
      (SMASH_FULL_IMPACT_VELOCITY - SMASH_MIN_IMPACT_VELOCITY),
  );
  // SMASH_MAX_SQUASH < SMASH_MIN_SQUASH because "max" is the strongest
  // squash (lowest scale); a heavy impact lerps toward MAX_SQUASH.
  const squash = SMASH_MIN_SQUASH + (SMASH_MAX_SQUASH - SMASH_MIN_SQUASH) * t;
  p.smashAge = 0;
  p.smashSquashAlong = squash;
  p.smashNormalX = normalX;
  p.smashNormalY = normalY;
  p.smashCooldown = SMASH_COOLDOWN_SEC;
  return t;
}

export function inputDirection(
  pressedCodes: Set<string>,
  profile: KeybindProfile,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (isActionPressed("moveLeft", pressedCodes, profile)) x -= 1;
  if (isActionPressed("moveRight", pressedCodes, profile)) x += 1;
  if (isActionPressed("moveUp", pressedCodes, profile)) y -= 1;
  if (isActionPressed("moveDown", pressedCodes, profile)) y += 1;
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

// Asymmetric breathing curve. Returns 0..1 across phase 0..2π:
//   inhale (first BREATH_INHALE_FRACTION of cycle): ease-out, fast
//     intake decelerating to the peak.
//   exhale (the rest): smoothstep ease-in-out from peak back to rest.
// The factor is multiplied by BREATH_AMPLITUDE in the renderer, so the
// scale stays at 1 (rest) and grows to 1 + AMP (peak inhale).
function breathFactor(phase: number): number {
  const t = phase / (Math.PI * 2);
  if (t < BREATH_INHALE_FRACTION) {
    const u = t / BREATH_INHALE_FRACTION;
    return 1 - (1 - u) * (1 - u);
  }
  const u = (t - BREATH_INHALE_FRACTION) / (1 - BREATH_INHALE_FRACTION);
  return 1 - u * u * (3 - 2 * u);
}

function currentBlinkDurations(p: Player): { close: number; open: number } {
  return p.inDoubleBlink
    ? { close: DOUBLE_BLINK_CLOSE_SEC, open: DOUBLE_BLINK_OPEN_SEC }
    : { close: BLINK_CLOSE_SEC, open: BLINK_OPEN_SEC };
}

function blinkProgress(p: Player): number {
  if (!p.blinkActive) return 0;
  const { close, open } = currentBlinkDurations(p);
  if (p.blinkElapsed < close) return p.blinkElapsed / close;
  return 1 - (p.blinkElapsed - close) / open;
}

/** Bullet shape used for dilation counting and flinch detection. The
 *  flinchTriggered flag is mutated in place so a single bullet can only
 *  flinch once as it crosses the player. */
type FlinchableBullet = {
  x: number;
  y: number;
  flinchTriggered?: boolean;
};

export function updateEye(
  p: Player,
  dt: number,
  options: {
    threat: Pointable | null;
    size: number;
    dashDurationSec: number;
    /** Bullets in play. When provided, drives pupil dilation (count
     *  within PUPIL_THREAT_RADIUS) and flinch detection (per-bullet
     *  flinchTriggered). */
    bullets?: FlinchableBullet[];
    /** Live enemies. Adds +0.3 to threat level if any are within
     *  PUPIL_ENEMY_THREAT_RADIUS. */
    enemies?: EnemyLike[];
    /** Mode-specific behavior — rooms keeps a minimum threat floor of
     *  0.2 because the walls always make the space feel pressed. */
    mode?: "sandbox" | "rooms";
    /** Hit i-frame remaining; suppresses flinch so it doesn't pile on
     *  damage feedback. */
    hitIframe?: number;
  },
): void {
  // Dash cooldown → "READY" flash. Triggered exactly on the frame
  // the cooldown drops to zero so the recharge ring puffs out a quick
  // visual cue. The flash itself decays here regardless of whether a
  // new cooldown started in the meantime — it's a one-shot.
  if (p.prevCooldown > 0 && p.cooldown === 0) {
    p.cooldownReadyFlash = COOLDOWN_READY_FLASH_SEC;
  }
  if (p.cooldownReadyFlash > 0) {
    p.cooldownReadyFlash = Math.max(0, p.cooldownReadyFlash - dt);
  }
  p.prevCooldown = p.cooldown;

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
    p.brakeAge = -1; // start cancels any active brake
  }
  // brake squeeze trigger — magnitude of velocity is dropping faster
  // than BRAKE_VELOCITY_DROP_THRESHOLD over BRAKE_DROP_TIME_MS, which
  // converts to a per-second deceleration. Friction at full speed is
  // already steep enough to cross this; counter-input crosses it
  // dramatically. Cooldown via brakeAge prevents continuous pulsing
  // while friction keeps decelerating.
  if (!isDashing && p.brakeAge < 0 && dt > 1e-6) {
    const decelRate = (p.prevSpeed - speed) / dt;
    if (decelRate > BRAKE_DECEL_THRESHOLD) {
      p.brakeAge = 0;
      p.squashTime = 0; // brake cancels any active start-pop
    }
  }
  if (p.squashTime > 0) p.squashTime = Math.max(0, p.squashTime - dt);
  if (p.brakeAge >= 0) {
    p.brakeAge += dt;
    if (p.brakeAge >= BRAKE_TOTAL_SEC) p.brakeAge = -1;
  }
  // smash timer + cooldown
  if (p.smashAge >= 0) {
    p.smashAge += dt;
    if (p.smashAge >= SMASH_TOTAL_SEC) p.smashAge = -1;
  }
  if (p.smashCooldown > 0) p.smashCooldown = Math.max(0, p.smashCooldown - dt);
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

  // blink scheduler — supports double blinks. The first cycle uses the
  // standard durations and rolls a chance to trigger a second, faster
  // cycle after a brief pause; the second cycle uses DOUBLE_BLINK_*
  // durations.
  if (p.blinkActive) {
    p.blinkElapsed += dt;
    const { close, open } = currentBlinkDurations(p);
    if (p.blinkElapsed >= close + open) {
      p.blinkActive = false;
      p.blinkElapsed = 0;
      if (p.doubleBlinkPending) {
        p.doubleBlinkPending = false;
        p.inDoubleBlink = true;
        p.blinkCooldown = DOUBLE_BLINK_DELAY_SEC;
      } else {
        p.inDoubleBlink = false;
        p.blinkCooldown = randomBlinkInterval();
      }
    }
  } else {
    p.blinkCooldown -= dt;
    if (p.blinkCooldown <= 0) {
      p.blinkActive = true;
      p.blinkElapsed = 0;
      // Roll for a follow-up only at the start of a "first" blink so
      // we don't infinitely chain doubles.
      if (!p.inDoubleBlink && Math.random() < DOUBLE_BLINK_CHANCE) {
        p.doubleBlinkPending = true;
      }
    }
  }

  // breathing — phase always advances; render reads sin(phase) and
  // suppresses the scale during dash/blink so it doesn't fight those.
  p.breathPhase += dt * BREATH_PHASE_RATE;
  if (p.breathPhase > Math.PI * 2) p.breathPhase -= Math.PI * 2;

  // pupil dilation — threat level is bullet count within radius (capped
  // at 5 = full threat) plus a flat +0.3 if any live enemy is close.
  // Rooms keeps a 0.2 floor for the sustained pressure of walls.
  let nearbyBullets = 0;
  if (options.bullets) {
    const r2 = PUPIL_THREAT_RADIUS * PUPIL_THREAT_RADIUS;
    for (const b of options.bullets) {
      const bdx = b.x - p.x;
      const bdy = b.y - p.y;
      if (bdx * bdx + bdy * bdy < r2) nearbyBullets++;
    }
  }
  let threatLevel = Math.min(1, nearbyBullets / 5);
  if (options.enemies) {
    const r2 = PUPIL_ENEMY_THREAT_RADIUS * PUPIL_ENEMY_THREAT_RADIUS;
    for (const e of options.enemies) {
      if (e.isDead()) continue;
      const ex = e.x - p.x;
      const ey = e.y - p.y;
      if (ex * ex + ey * ey < r2) {
        threatLevel += 0.3;
        break;
      }
    }
  }
  if (options.mode === "rooms") threatLevel = Math.max(0.2, threatLevel);
  threatLevel = Math.max(0, Math.min(1, threatLevel));
  const desiredDilation =
    PUPIL_DILATION_MAX -
    threatLevel * (PUPIL_DILATION_MAX - PUPIL_DILATION_MIN);
  const dilK = 1 - Math.pow(1 - PUPIL_DILATION_LERP, dt * 60);
  p.pupilDilation += (desiredDilation - p.pupilDilation) * dilK;

  // flinch — single trigger per frame, gated by cooldown / dash i-frame /
  // hit i-frame. We still mark the bullet as having entered the radius
  // so it can't re-trigger on a later frame.
  if (p.flinchCooldown > 0) p.flinchCooldown = Math.max(0, p.flinchCooldown - dt);
  if (p.flinchTime > 0) p.flinchTime = Math.max(0, p.flinchTime - dt);
  if (p.flinchPupilTime > 0)
    p.flinchPupilTime = Math.max(0, p.flinchPupilTime - dt);
  if (p.flinchSquashTime > 0)
    p.flinchSquashTime = Math.max(0, p.flinchSquashTime - dt);
  if (options.bullets) {
    const radius = options.size + FLINCH_RADIUS_EXTRA;
    const r2 = radius * radius;
    const suppressed =
      p.flinchCooldown > 0 ||
      p.dashIframeTime > 0 ||
      (options.hitIframe ?? 0) > 0;
    for (const b of options.bullets) {
      if (b.flinchTriggered) continue;
      const bdx = b.x - p.x;
      const bdy = b.y - p.y;
      const d2 = bdx * bdx + bdy * bdy;
      if (d2 >= r2) continue;
      b.flinchTriggered = true;
      if (suppressed) continue;
      const dist = Math.sqrt(d2) || 1;
      p.flinchDirX = -bdx / dist;
      p.flinchDirY = -bdy / dist;
      p.flinchTime = FLINCH_DURATION_SEC;
      p.flinchPupilTime = FLINCH_PUPIL_TOTAL_SEC;
      p.flinchSquashTime = FLINCH_SQUASH_SEC;
      p.flinchCooldown = FLINCH_COOLDOWN_SEC;
      // only one flinch per frame even if more bullets cross
      break;
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
        pupilOffsetX: p.pupilOffsetX,
        pupilOffsetY: p.pupilOffsetY,
        pupilR: computePupilR(p, options.size),
        eyeOpenY: 1 - p.closeAmount,
        blinkAmount: blinkProgress(p),
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
  pupilColor: string;
  ghostColor: string;
  dashDurationSec: number;
  /** Total dash cooldown in seconds — drives the recharge ring +
   *  "READY" flash drawn around the player. Omit to skip the
   *  indicator entirely (used by the landing-page preview). */
  dashCooldownSec?: number;
  /** Defaults to PALETTE.bg when neither this nor profile.iris is set. */
  irisColor?: string;
  /** Halo (neon shadow) override around the outer ring. When omitted,
   *  drawPlayerEye derives the halo from profile/state: profile.outerRing
   *  in idle, profile.dashParticles during a dash. Pass an explicit
   *  colour to tint the halo for a transient effect (sandbox uses this
   *  for the Bullet Breaker pickup). */
  glowColor?: string;
  blurStrong?: number;
  blurSoft?: number;
  /**
   * When provided, drives every body layer (ring / iris / pupil) and
   * the dash halo (via dashParticles) — the eye reads as the player's
   * saved customisation regardless of dash/walk state.
   */
  profile?: PlayerProfile;
};

function computePupilR(p: Player, size: number): number {
  const pupilRBase = size * 0.18;
  const dilateProgress = p.dilateTime > 0 ? p.dilateTime / DILATE_DURATION : 0;
  const dilateFactor = 1 + PUPIL_DILATE_PEAK * dilateProgress;
  let pupilR = pupilRBase * dilateFactor * p.pupilDilation;
  if (p.flinchPupilTime > 0) {
    let f: number;
    if (p.flinchPupilTime > FLINCH_PUPIL_RECOVER_SEC) {
      f = FLINCH_PUPIL_SHRINK;
    } else {
      const t = 1 - p.flinchPupilTime / FLINCH_PUPIL_RECOVER_SEC;
      f = FLINCH_PUPIL_SHRINK + (1 - FLINCH_PUPIL_SHRINK) * t;
    }
    pupilR *= f;
  }
  return pupilR;
}

export function drawPlayerEye(
  ctx: CanvasRenderingContext2D,
  p: Player,
  size: number,
  opts: EyeRenderOpts,
): void {
  const r = size / 2;
  const irisR = size * 0.42;
  const highlightR = size * 0.06;
  const pupilR = computePupilR(p, size);

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

  // Resolve final colors. Profile (when provided) drives every body
  // layer in every state — the live skin no longer flips to a canonical
  // dash colour. The halo around the outer ring is the only piece that
  // reads dash vs idle: during a dash it picks profile.dashParticles
  // so the "energy" layer reads as the same colour as the trail and
  // the ghost copies. opts.glowColor stays an explicit override on top
  // (sandbox uses it for the Bullet Breaker pickup tint).
  const ringColor = opts.profile?.outerRing ?? opts.ringColor;
  const pupilColor = opts.profile?.pupil ?? opts.pupilColor;
  const irisColor = opts.profile?.iris ?? opts.irisColor ?? PALETTE.bg;
  const haloColor =
    opts.glowColor ??
    (isDashing
      ? (opts.profile?.dashParticles ?? ringColor)
      : ringColor);
  // Dash ghosts render as a full skin echo: ring/iris/pupil/highlight
  // all in profile colours, so the trailing copies match the live skin
  // exactly. Callers without a profile (safety fallback only — every
  // mode currently passes one) get the legacy single ghostColor across
  // every layer, which matches the pre-refactor outline behaviour.
  const ghostProfile: PlayerProfile = opts.profile ?? {
    outerRing: opts.ghostColor,
    iris: opts.ghostColor,
    pupil: opts.ghostColor,
    dashParticles: opts.ghostColor,
  };

  // ===== ghosts (drawn first, behind the live eye, in world space) =====
  if (p.dashGhosts.length > 0) {
    drawDashGhosts(ctx, p.dashGhosts, ghostProfile, eyeOpenY);
  }

  // Per-frame movement deformations applied to the live eye only.
  // Order: translate → close (world Y squeeze) → rotate (lean) →
  // translate(0, bobY) → scale (squash) → draw layers inside.
  const bobOffsetY =
    BOB_AMPLITUDE_PX * Math.sin(p.bobPhase) * (isDashing ? 0 : 1);
  // Start-pop (fresh keypress) — applied in the leaned frame so it
  // tracks the player's posture; small uniform scale follows the body
  // tilt. Mutually exclusive with brake (each clears the other).
  let popSx = 1;
  let popSy = 1;
  if (p.squashTime > 0) {
    const t = p.squashTime / SQUASH_DURATION_SEC;
    popSx = 1 + (STRETCH_X - 1) * t;
    popSy = 1 + (SQUASH_Y - 1) * t;
  }
  // Brake squeeze — axis-aligned to the canvas (world frame). Held at
  // full squeeze for BRAKE_DURATION, then eases to neutral over
  // BRAKE_RECOVERY. Lives BEFORE the lean rotate so it doesn't twist
  // with the player's tilt during a high-speed stop.
  let brakeSx = 1;
  let brakeSy = 1;
  if (p.brakeAge >= 0) {
    if (p.brakeAge < BRAKE_DURATION_SEC) {
      brakeSx = BRAKE_SQUASH_X;
      brakeSy = BRAKE_STRETCH_Y;
    } else {
      const t = (p.brakeAge - BRAKE_DURATION_SEC) / BRAKE_RECOVERY_SEC;
      brakeSx = BRAKE_SQUASH_X + (1 - BRAKE_SQUASH_X) * t;
      brakeSy = BRAKE_STRETCH_Y + (1 - BRAKE_STRETCH_Y) * t;
    }
  }
  const hasPop = popSx !== 1 || popSy !== 1;
  const hasBrake = brakeSx !== 1 || brakeSy !== 1;

  // Anisotropic stretch — continuous deformation along the velocity
  // vector while running. Strength scales with speed above the
  // threshold, capped at ANISOTROPIC_STRETCH_MAX. Skipped during dash
  // (the dash teardrop owns its deformation).
  const liveSpeed = Math.hypot(p.vx, p.vy);
  let aniStrength = 0;
  let aniAngle = 0;
  if (
    !isDashing &&
    liveSpeed > ANISOTROPIC_STRETCH_VELOCITY_THRESHOLD
  ) {
    aniStrength = Math.min(
      ANISOTROPIC_STRETCH_MAX,
      ((liveSpeed - ANISOTROPIC_STRETCH_VELOCITY_THRESHOLD) /
        ANISOTROPIC_STRETCH_VELOCITY_FACTOR) *
        0.3,
    );
    if (aniStrength > 0) aniAngle = Math.atan2(p.vy, p.vx);
  }

  // Smash deformation — three phases (held / overshoot / settle). The
  // along-normal axis gets the heavy squash; perpendicular gets a
  // matching stretch (additive, sums to 2 so volume reads roughly
  // preserved). Overshoot flips both axes briefly past 1.0 for the
  // spring read.
  let smashAlong = 1;
  let smashPerp = 1;
  if (p.smashAge >= 0) {
    if (p.smashAge < SMASH_DURATION_SEC) {
      smashAlong = p.smashSquashAlong;
      smashPerp = 2 - p.smashSquashAlong;
    } else if (p.smashAge < SMASH_DURATION_SEC + SMASH_OVERSHOOT_SEC) {
      // ramp from full squash to overshoot peak
      const t =
        (p.smashAge - SMASH_DURATION_SEC) / SMASH_OVERSHOOT_SEC;
      smashAlong =
        p.smashSquashAlong +
        (SMASH_OVERSHOOT_SQUASH - p.smashSquashAlong) * t;
      smashPerp =
        2 - p.smashSquashAlong +
        (SMASH_OVERSHOOT_STRETCH - (2 - p.smashSquashAlong)) * t;
    } else {
      // settle from overshoot peak to neutral
      const settleStart = SMASH_DURATION_SEC + SMASH_OVERSHOOT_SEC;
      const settleDuration = SMASH_TOTAL_SEC - settleStart;
      const t = settleDuration > 0
        ? (p.smashAge - settleStart) / settleDuration
        : 1;
      smashAlong =
        SMASH_OVERSHOOT_SQUASH + (1 - SMASH_OVERSHOOT_SQUASH) * t;
      smashPerp =
        SMASH_OVERSHOOT_STRETCH + (1 - SMASH_OVERSHOOT_STRETCH) * t;
    }
  }
  const hasSmash = p.smashAge >= 0;

  ctx.save();
  ctx.translate(baseX, baseY);
  // Transform stack: clean binary split. While a smash is active we
  // apply ONLY the wall-aligned squash + the eye-close (death) Y
  // squeeze; every other micro-animation (lean, bob, start-pop, brake,
  // anisotropic stretch, flinch, breathing) is suppressed so it can't
  // accumulate on top of the smash and warp its axis. As soon as
  // smashAge ends and falls back to -1, the normal stack runs again.
  if (hasSmash) {
    if (Math.abs(p.smashNormalX) > Math.abs(p.smashNormalY)) {
      // vertical wall: squash X, stretch Y
      ctx.scale(smashAlong, smashPerp);
    } else {
      // horizontal wall: squash Y, stretch X
      ctx.scale(smashPerp, smashAlong);
    }
    ctx.scale(1, Math.max(0.001, eyeOpenY));
  } else {
    if (hasBrake) ctx.scale(brakeSx, brakeSy);
    ctx.scale(1, Math.max(0.001, eyeOpenY));
    if (p.tiltAngle !== 0) ctx.rotate(p.tiltAngle);
    if (bobOffsetY !== 0) ctx.translate(0, bobOffsetY);
    if (hasPop) ctx.scale(popSx, popSy);
    if (aniStrength > 0) {
      ctx.rotate(aniAngle);
      ctx.scale(1 + aniStrength, 1 - aniStrength);
      ctx.rotate(-aniAngle);
    }
    if (p.flinchTime > 0) {
      const t = p.flinchTime / FLINCH_DURATION_SEC;
      ctx.translate(
        p.flinchDirX * FLINCH_OFFSET_PX * t,
        p.flinchDirY * FLINCH_OFFSET_PX * t,
      );
    }
    if (p.flinchSquashTime > 0) {
      const t = p.flinchSquashTime / FLINCH_SQUASH_SEC;
      const sy = 1 + (FLINCH_SQUASH_Y - 1) * t;
      ctx.scale(1, sy);
    }
    if (!isDashing && !p.blinkActive) {
      const breathScale =
        1 + breathFactor(p.breathPhase) * BREATH_AMPLITUDE;
      ctx.scale(breathScale, breathScale);
    }
  }

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
    haloColor,
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

  // Dash recharge indicator — drawn at world coords (outside the
  // per-eye transform stack) so the ring stays axis-aligned and
  // doesn't lean / squash with the body. Pulls the ring colour from
  // profile.dashParticles when a profile is provided so the cue
  // matches the trail / ghost colour family.
  if (opts.dashCooldownSec !== undefined) {
    const indicatorColor = opts.profile?.dashParticles ?? "#9ca3af";
    drawDashCooldownIndicator(
      ctx,
      p,
      size,
      opts.dashCooldownSec,
      indicatorColor,
    );
  }
}

function drawDashGhosts(
  ctx: CanvasRenderingContext2D,
  ghosts: DashGhost[],
  profile: PlayerProfile,
  liveEyeOpenY: number,
): void {
  for (const g of ghosts) {
    const t = g.age / g.lifetime;
    const alpha = (1 - t) * DASH_GHOST_INITIAL_ALPHA;
    if (alpha <= 0) continue;
    const fade = 1 - t * 0.3; // shrink slightly as it ages
    const ghostAngle = Math.atan2(g.dirY, g.dirX);
    const r = g.size / 2;
    const irisR = g.size * 0.42;
    const highlightR = g.size * 0.06;
    const irisShift = r * g.stretchX * 0.3;
    const ringRX = r * g.stretchX * fade;
    const ringRY = r * g.stretchY * fade;
    // Combine the captured close-amount with the live one so death
    // squashes ghosts and the live eye together.
    const eyeOpenY = Math.max(0.001, g.eyeOpenY * liveEyeOpenY);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(g.x, g.y);
    ctx.scale(1, eyeOpenY);

    // outer ring
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRX, ringRY, ghostAngle, 0, Math.PI * 2);
    ctx.strokeStyle = profile.outerRing;
    ctx.lineWidth = 2;
    ctx.stroke();

    // iris + pupil + highlight, shifted forward like the live dash eye
    ctx.save();
    ctx.translate(g.dirX * irisShift, g.dirY * irisShift);
    ctx.fillStyle = profile.iris;
    ctx.beginPath();
    ctx.arc(0, 0, irisR * fade, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = profile.pupil;
    ctx.beginPath();
    ctx.arc(g.pupilOffsetX, g.pupilOffsetY, g.pupilR * fade, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(
      g.pupilOffsetX - g.pupilR * 0.35,
      g.pupilOffsetY - g.pupilR * 0.35,
      highlightR * fade,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();

    // eyelids (clipped to outer ring), only if blinking at emission time
    if (g.blinkAmount > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, ringRX, ringRY, ghostAngle, 0, Math.PI * 2);
      ctx.clip();
      const lidH = g.blinkAmount * r;
      const lidW = r * Math.max(g.stretchX, 1) * 2 + 4;
      ctx.fillStyle = profile.outerRing;
      ctx.fillRect(-lidW / 2, -r * Math.max(g.stretchY, 1) - 2, lidW, lidH + 2);
      ctx.fillRect(
        -lidW / 2,
        r * Math.max(g.stretchY, 1) - lidH,
        lidW,
        lidH + 2,
      );
      ctx.restore();
    }

    ctx.restore();
  }
}

/**
 * Recharge indicator drawn around the player at world coords. Two
 * components: a partial arc that fills clockwise from 12 o'clock as
 * the cooldown ticks down, and a single 200 ms ring that expands
 * outward + fades to nothing the moment the dash becomes available
 * again. Skipped while the player is mid-dash (the dash visuals own
 * that beat). Caller passes total cooldown so the helper doesn't
 * need to know about Settings.
 */
function drawDashCooldownIndicator(
  ctx: CanvasRenderingContext2D,
  p: Player,
  size: number,
  cooldownTotalSec: number,
  ringColor: string,
): void {
  if (p.dashTime > 0) return;
  const baseR = (size / 2) * (COOLDOWN_RING_RADIUS_FACTOR * 2);
  // Recharge arc — visible while a cooldown is active.
  if (p.cooldown > 0 && cooldownTotalSec > 0) {
    const t = Math.max(0, Math.min(1, 1 - p.cooldown / cooldownTotalSec));
    ctx.save();
    ctx.globalAlpha = COOLDOWN_RING_ALPHA;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = COOLDOWN_RING_LINEWIDTH;
    ctx.beginPath();
    ctx.arc(
      p.x,
      p.y,
      baseR,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * t,
    );
    ctx.stroke();
    ctx.restore();
  }
  // Ready flash — single shot, expands and fades.
  if (p.cooldownReadyFlash > 0) {
    const t = 1 - p.cooldownReadyFlash / COOLDOWN_READY_FLASH_SEC;
    const r =
      baseR + (baseR * (COOLDOWN_READY_FLASH_END_RADIUS_FACTOR - 1)) * t;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.85;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = COOLDOWN_RING_LINEWIDTH;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
