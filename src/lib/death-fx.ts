// Player death cinematic — self-contained FX module triggered on the
// hit that drops HP to 0. The lifecycle:
//   t=0     hit lands. Caller hides the player body, fires screen shake
//           + flash. We spawn the central hot-core flash, 14 outer-ring
//           fragments, 22 particles, 8 iris shards, and the first
//           shockwave.
//   t=0.15  cyan shockwave 2 (player ring color).
//   t=0.35  white shockwave 3 (broader, dimmer).
//   t=1.05  "ELIMINATED" title fades in at the death point, easing
//           through a slight scale-up.
//   t=1.7   overlay can show (caller gates via shouldShowOverlay).
//   t=2.0   cinematic logically ends; ringing particles may continue
//           dying out for a fraction longer but caller can drop the FX.
//
// Animation timers run on real dt, independent of any boss-style world
// timeScale, so the cinematic plays at intended speed regardless of
// what was slowing the sim when the hit landed.

const FRAGMENT_COUNT = 14;
const FRAGMENT_SPEED_MIN = 280;
const FRAGMENT_SPEED_MAX = 380;
const FRAGMENT_SPIN_RANGE = 6; // rad/s, ±
const FRAGMENT_LIFETIME_SEC = 0.9;
const FRAGMENT_ARC_RAD = 0.42; // each fragment covers ~24° of the original ring
const FRAGMENT_THICKNESS_PX = 2.5;

const SHARD_COUNT = 8;
const SHARD_SPEED_MIN = 180;
const SHARD_SPEED_MAX = 280;
const SHARD_LIFETIME_SEC = 0.7;

const PARTICLE_COUNT = 22;
const PARTICLE_SPEED_MIN = 250;
const PARTICLE_SPEED_MAX = 450;
const PARTICLE_LIFETIME_MIN = 0.5;
const PARTICLE_LIFETIME_MAX = 0.9;

const CORE_FLASH_DURATION = 0.22;
const CORE_FLASH_RADIUS_START_FRAC = 0.8; // × playerSize
const CORE_FLASH_RADIUS_END_FRAC = 4.0;

type Shockwave = {
  delay: number; // seconds before activation
  duration: number;
  radiusStart: number;
  radiusEnd: number;
  lwStart: number;
  lwEnd: number;
  color: string;
};

const SHOCKWAVES: Shockwave[] = [
  // 1st — fast, bright white snap at t=0
  { delay: 0, duration: 0.4, radiusStart: 20, radiusEnd: 180, lwStart: 5, lwEnd: 0.5, color: "#ffffff" },
  // 2nd — cyan body shell pushing further out
  { delay: 0.15, duration: 0.55, radiusStart: 30, radiusEnd: 280, lwStart: 6, lwEnd: 0.5, color: "#00e5ff" },
  // 3rd — thinnest, latest, broadest
  { delay: 0.35, duration: 0.7, radiusStart: 60, radiusEnd: 380, lwStart: 3, lwEnd: 0.5, color: "#ffffff" },
];

const TEXT_APPEAR_SEC = 1.05;
const TEXT_SCALE_DURATION = 0.4;
const TEXT_HOLD_DURATION = 0.6;

export const DEATH_OVERLAY_DELAY_SEC = 1.7;
export const DEATH_CINEMATIC_TOTAL_SEC = 2.0;

type Fragment = {
  angle: number;       // initial position around the ring
  arcSpan: number;     // arc length in radians the fragment covers
  radius: number;      // ring radius at spawn (player ring radius)
  thickness: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;        // current rotation (rad)
  spinVel: number;     // rad/s
  age: number;
  lifetime: number;
  color: string;
};

type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotVel: number;
  age: number;
  lifetime: number;
  size: number;
  color: string;
};

type DeathParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
  size: number;
  color: string;
};

type LiveShockwave = {
  spec: Shockwave;
  age: number; // -spec.delay until 0, then counts up
};

export type DeathFx = {
  x: number;
  y: number;
  age: number;
  ringColor: string;
  irisColor: string;
  size: number;
  fragments: Fragment[];
  shards: Shard[];
  particles: DeathParticle[];
  shockwaves: LiveShockwave[];
};

export function createDeathFx(opts: {
  x: number;
  y: number;
  size: number;
  ringColor: string;
  irisColor: string;
}): DeathFx {
  const { x, y, size, ringColor, irisColor } = opts;
  const ringRadius = size * 0.5;

  // Ring fragments — slice the original outer ring into FRAGMENT_COUNT
  // arc segments. Each shoots away from the center along its midpoint
  // angle, spinning on its own axis as it goes.
  const fragments: Fragment[] = [];
  for (let i = 0; i < FRAGMENT_COUNT; i++) {
    const baseAngle = (i / FRAGMENT_COUNT) * Math.PI * 2;
    // Slight angular jitter so the explosion doesn't look like a perfect lattice.
    const angle = baseAngle + (Math.random() - 0.5) * (Math.PI / FRAGMENT_COUNT) * 0.6;
    const speed = lerp(FRAGMENT_SPEED_MIN, FRAGMENT_SPEED_MAX, Math.random());
    fragments.push({
      angle,
      arcSpan: FRAGMENT_ARC_RAD,
      radius: ringRadius,
      thickness: FRAGMENT_THICKNESS_PX,
      x: 0,
      y: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: 0,
      spinVel: (Math.random() * 2 - 1) * FRAGMENT_SPIN_RANGE,
      age: 0,
      lifetime: FRAGMENT_LIFETIME_SEC * (0.85 + Math.random() * 0.3),
      color: ringColor,
    });
  }

  // Iris shards — small triangular shards from the iris, slower
  // than the ring fragments so they read as a separate inner break.
  const shards: Shard[] = [];
  for (let i = 0; i < SHARD_COUNT; i++) {
    const angle = (i / SHARD_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const speed = lerp(SHARD_SPEED_MIN, SHARD_SPEED_MAX, Math.random());
    shards.push({
      x: 0,
      y: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      rotVel: (Math.random() * 2 - 1) * 8,
      age: 0,
      lifetime: SHARD_LIFETIME_SEC * (0.85 + Math.random() * 0.3),
      size: 5 + Math.random() * 3,
      color: irisColor,
    });
  }

  // Generic explosion particles — split 60/40 white/ring-color.
  const particles: DeathParticle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = lerp(PARTICLE_SPEED_MIN, PARTICLE_SPEED_MAX, Math.random());
    particles.push({
      x: 0,
      y: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      lifetime: lerp(PARTICLE_LIFETIME_MIN, PARTICLE_LIFETIME_MAX, Math.random()),
      size: 1 + Math.random() * 1.5,
      color: Math.random() < 0.6 ? "#ffffff" : ringColor,
    });
  }

  const shockwaves: LiveShockwave[] = SHOCKWAVES.map((spec) => ({
    spec,
    age: -spec.delay,
  }));

  return {
    x,
    y,
    age: 0,
    ringColor,
    irisColor,
    size,
    fragments,
    shards,
    particles,
    shockwaves,
  };
}

export function updateDeathFx(fx: DeathFx, dt: number): void {
  fx.age += dt;

  // Fragments
  for (const f of fx.fragments) {
    f.age += dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.spin += f.spinVel * dt;
    // Drag — fragments slow as they fade so the explosion settles.
    const drag = Math.exp(-dt * 1.2);
    f.vx *= drag;
    f.vy *= drag;
  }
  fx.fragments = fx.fragments.filter((f) => f.age < f.lifetime);

  // Shards
  for (const s of fx.shards) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.rot += s.rotVel * dt;
    const drag = Math.exp(-dt * 1.5);
    s.vx *= drag;
    s.vy *= drag;
  }
  fx.shards = fx.shards.filter((s) => s.age < s.lifetime);

  // Particles — heavier drag so they don't fly forever.
  for (const p of fx.particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const drag = Math.exp(-dt * 2.0);
    p.vx *= drag;
    p.vy *= drag;
  }
  fx.particles = fx.particles.filter((p) => p.age < p.lifetime);

  // Shockwaves
  for (const sw of fx.shockwaves) sw.age += dt;
  fx.shockwaves = fx.shockwaves.filter(
    (sw) => sw.age < sw.spec.duration,
  );
}

export function drawDeathFx(
  ctx: CanvasRenderingContext2D,
  fx: DeathFx,
): void {
  ctx.save();
  ctx.translate(fx.x, fx.y);

  // 1. Hot core flash — central white disc scaling out, bright in the
  // first ~220ms then gone.
  if (fx.age < CORE_FLASH_DURATION) {
    const u = fx.age / CORE_FLASH_DURATION;
    const r =
      fx.size *
      (CORE_FLASH_RADIUS_START_FRAC +
        (CORE_FLASH_RADIUS_END_FRAC - CORE_FLASH_RADIUS_START_FRAC) * u);
    const a = 1 - u;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 20;
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Shockwaves — additive, layered.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const sw of fx.shockwaves) {
    if (sw.age < 0) continue;
    const u = sw.age / sw.spec.duration;
    const r = sw.spec.radiusStart + (sw.spec.radiusEnd - sw.spec.radiusStart) * u;
    const lw = sw.spec.lwStart + (sw.spec.lwEnd - sw.spec.lwStart) * u;
    const a = 1 - u;
    ctx.strokeStyle = sw.spec.color;
    ctx.shadowColor = sw.spec.color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = lw;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Ring fragments — arc segments from the original outer ring.
  // Each is drawn as a short arc on a virtual ring around the fragment's
  // own translated position, rotated by `spin`. The arc keeps the
  // original ring's radius so the pieces read as broken-off ring.
  ctx.save();
  ctx.lineCap = "round";
  for (const f of fx.fragments) {
    const u = f.age / f.lifetime;
    const a = (1 - u) * 0.95;
    if (a <= 0) continue;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.spin);
    ctx.strokeStyle = f.color;
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = a;
    ctx.lineWidth = f.thickness;
    ctx.beginPath();
    // Draw the arc centered on (-radius * cos(angle), -radius * sin(angle))
    // so the arc curls outward from the fragment's local origin.
    const cx = -Math.cos(f.angle) * f.radius;
    const cy = -Math.sin(f.angle) * f.radius;
    const start = f.angle - f.arcSpan / 2;
    const end = f.angle + f.arcSpan / 2;
    ctx.arc(cx, cy, f.radius, start, end);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // 4. Iris shards — triangular shards.
  ctx.save();
  for (const s of fx.shards) {
    const u = s.age / s.lifetime;
    const a = (1 - u) * 0.9;
    if (a <= 0) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.fillStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = a;
    const h = s.size;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(h * 0.7, h * 0.6);
    ctx.lineTo(-h * 0.7, h * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // 5. Particles — pure fillRect, no shadow (cheap).
  ctx.save();
  ctx.shadowBlur = 0;
  for (const p of fx.particles) {
    const u = p.age / p.lifetime;
    const a = 1 - u;
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.restore();

  // 6. "ELIMINATED" title — late-arriving, scale-pop ease-out-back,
  // red with white glow. Fades back out before the overlay appears.
  if (fx.age >= TEXT_APPEAR_SEC) {
    const localAge = fx.age - TEXT_APPEAR_SEC;
    const scaleU = Math.min(1, localAge / TEXT_SCALE_DURATION);
    // ease-out-back-ish
    const eased = 1 + 2.5 * Math.pow(scaleU - 1, 3) + 1.5 * Math.pow(scaleU - 1, 2);
    const scale = scaleU < 1 ? 0.6 + eased * 0.4 : 1;
    let alpha = 1;
    if (localAge > TEXT_SCALE_DURATION + TEXT_HOLD_DURATION) {
      const fadeU = Math.min(
        1,
        (localAge - TEXT_SCALE_DURATION - TEXT_HOLD_DURATION) / 0.3,
      );
      alpha = 1 - fadeU;
    }
    if (alpha > 0) {
      ctx.save();
      ctx.translate(0, -fx.size - 30);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.font = "bold 38px Orbitron, ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#ff2d55";
      ctx.fillText("ELIMINATED", 0, 0);
      // Second pass for stronger red glow
      ctx.shadowColor = "#ff2d55";
      ctx.shadowBlur = 24;
      ctx.fillText("ELIMINATED", 0, 0);
      ctx.restore();
    }
  }

  ctx.restore();
}

export function isDeathFxFinished(fx: DeathFx): boolean {
  return fx.age >= DEATH_CINEMATIC_TOTAL_SEC;
}

export function shouldShowDeathOverlay(fx: DeathFx | null): boolean {
  if (!fx) return true;
  return fx.age >= DEATH_OVERLAY_DELAY_SEC;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
