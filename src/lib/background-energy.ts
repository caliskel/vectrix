// Animated energy background that lives BEHIND the playfield. The
// effects fill the entire canvas; the caller passes the screen-space
// rect of the visible arena, and we clip-out that rect so the effects
// only show in the letterbox / camera margins where the world doesn't
// render. Three layers: drifting neon lines (electric discharges in
// the air), rising particles (sparks of energy welling up), and an
// occasional horizontal lightning streak. Cyan + purple palette
// fixed across all rooms / modes.

const LINE_COUNT = 10;                 // 8..12 mid
const LINE_LENGTH_MIN = 80;
const LINE_LENGTH_MAX = 150;
const LINE_THICKNESS_MIN = 1.0;
const LINE_THICKNESS_MAX = 1.5;
const LINE_SPEED_MIN = 20;
const LINE_SPEED_MAX = 40;
const LINE_PULSE_PERIOD_MIN_SEC = 3.0;
const LINE_PULSE_PERIOD_MAX_SEC = 5.0;
const LINE_ALPHA_MIN = 0.05;
const LINE_ALPHA_MAX = 0.18;
const LINE_GLOW_BLUR = 4;

const PARTICLE_COUNT = 25;             // 20..30 mid
const PARTICLE_SIZE_MIN = 1;
const PARTICLE_SIZE_MAX = 2;
const PARTICLE_SPEED_MIN = 30;
const PARTICLE_SPEED_MAX = 60;
const PARTICLE_SWAY_AMP_MIN = 8;
const PARTICLE_SWAY_AMP_MAX = 15;
const PARTICLE_SWAY_PERIOD_MIN_SEC = 2.0;
const PARTICLE_SWAY_PERIOD_MAX_SEC = 4.0;
const PARTICLE_ALPHA_MIN = 0.1;
const PARTICLE_ALPHA_MAX = 0.25;
const PARTICLE_GLOW_BLUR = 3;

const LIGHTNING_INTERVAL_MIN_SEC = 10;
const LIGHTNING_INTERVAL_MAX_SEC = 20;
const LIGHTNING_DURATION_SEC = 0.2;
const LIGHTNING_THICKNESS = 2;
const LIGHTNING_ALPHA = 0.4;
const LIGHTNING_GLOW_BLUR = 10;

const COLOR_CYAN = "#00e5ff";
const COLOR_PURPLE = "#7a5fff";
const COLOR_WHITE = "#ffffff";

type Line = {
  x: number;
  y: number;
  angle: number;        // orientation radians
  length: number;
  thickness: number;
  vx: number;           // drift velocity
  vy: number;
  color: string;
  pulsePhase: number;   // 0..2π
  pulseSpeed: number;   // rad/sec
};

type Particle = {
  baseX: number;        // horizontal anchor for sine sway
  y: number;
  swayPhase: number;
  swayAmp: number;
  swaySpeed: number;
  vy: number;           // rise speed (positive — subtracted from y)
  size: number;
  color: string;
  alpha: number;
};

type Lightning = {
  y: number;
  age: number;
  color: string;
};

export type EnergyBackground = {
  lines: Line[];
  particles: Particle[];
  lightning: Lightning | null;
  lightningTimer: number;
  // Last viewport size seen — used for respawn / wrap maths so the
  // module doesn't need to be re-initialised on window resize.
  viewW: number;
  viewH: number;
};

export type ArenaScreenBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function createEnergyBackground(
  viewW: number,
  viewH: number,
): EnergyBackground {
  const lines: Line[] = [];
  for (let i = 0; i < LINE_COUNT; i++) {
    lines.push(spawnLine(viewW, viewH, true));
  }
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(spawnParticle(viewW, viewH, true));
  }
  return {
    lines,
    particles,
    lightning: null,
    lightningTimer: pick(LIGHTNING_INTERVAL_MIN_SEC, LIGHTNING_INTERVAL_MAX_SEC),
    viewW,
    viewH,
  };
}

function spawnLine(viewW: number, viewH: number, seeded: boolean): Line {
  // `seeded` = first-time placement anywhere on screen; otherwise
  // spawn just off an edge so the line drifts in naturally.
  const angle = Math.random() * Math.PI * 2;
  const speed = pick(LINE_SPEED_MIN, LINE_SPEED_MAX);
  const driftAngle = Math.random() * Math.PI * 2;
  const length = pick(LINE_LENGTH_MIN, LINE_LENGTH_MAX);
  let x: number;
  let y: number;
  if (seeded) {
    x = Math.random() * viewW;
    y = Math.random() * viewH;
  } else {
    // Pick an edge; place outside by ~length so the line walks in.
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { x = Math.random() * viewW; y = -length; }
    else if (edge === 1) { x = viewW + length; y = Math.random() * viewH; }
    else if (edge === 2) { x = Math.random() * viewW; y = viewH + length; }
    else { x = -length; y = Math.random() * viewH; }
  }
  const period = pick(LINE_PULSE_PERIOD_MIN_SEC, LINE_PULSE_PERIOD_MAX_SEC);
  return {
    x,
    y,
    angle,
    length,
    thickness: pick(LINE_THICKNESS_MIN, LINE_THICKNESS_MAX),
    vx: Math.cos(driftAngle) * speed,
    vy: Math.sin(driftAngle) * speed,
    color: Math.random() < 0.6 ? COLOR_CYAN : COLOR_PURPLE,
    pulsePhase: Math.random() * Math.PI * 2,
    pulseSpeed: (Math.PI * 2) / period,
  };
}

function spawnParticle(
  viewW: number,
  viewH: number,
  seeded: boolean,
): Particle {
  const swayPeriod = pick(PARTICLE_SWAY_PERIOD_MIN_SEC, PARTICLE_SWAY_PERIOD_MAX_SEC);
  const alpha = pick(PARTICLE_ALPHA_MIN, PARTICLE_ALPHA_MAX);
  return {
    baseX: Math.random() * viewW,
    // Seeded particles distribute up the column; respawn always
    // starts at the bottom edge.
    y: seeded ? Math.random() * viewH : viewH + 4,
    swayPhase: Math.random() * Math.PI * 2,
    swayAmp: pick(PARTICLE_SWAY_AMP_MIN, PARTICLE_SWAY_AMP_MAX),
    swaySpeed: (Math.PI * 2) / swayPeriod,
    vy: pick(PARTICLE_SPEED_MIN, PARTICLE_SPEED_MAX),
    size: pick(PARTICLE_SIZE_MIN, PARTICLE_SIZE_MAX),
    color: Math.random() < 0.75 ? COLOR_CYAN : COLOR_WHITE,
    alpha,
  };
}

export function updateEnergyBackground(
  state: EnergyBackground,
  dt: number,
  viewW: number,
  viewH: number,
): void {
  state.viewW = viewW;
  state.viewH = viewH;

  // Lines drift; recycle off-screen ones to a new edge.
  for (let i = 0; i < state.lines.length; i++) {
    const l = state.lines[i];
    l.x += l.vx * dt;
    l.y += l.vy * dt;
    l.pulsePhase += l.pulseSpeed * dt;
    const margin = l.length + 20;
    if (
      l.x < -margin ||
      l.x > viewW + margin ||
      l.y < -margin ||
      l.y > viewH + margin
    ) {
      state.lines[i] = spawnLine(viewW, viewH, false);
    }
  }

  // Particles rise; sway horizontally; respawn at the bottom edge.
  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    p.y -= p.vy * dt;
    p.swayPhase += p.swaySpeed * dt;
    if (p.y < -10) {
      state.particles[i] = spawnParticle(viewW, viewH, false);
    }
  }

  // Lightning.
  if (state.lightning) {
    state.lightning.age += dt;
    if (state.lightning.age >= LIGHTNING_DURATION_SEC) {
      state.lightning = null;
      state.lightningTimer = pick(
        LIGHTNING_INTERVAL_MIN_SEC,
        LIGHTNING_INTERVAL_MAX_SEC,
      );
    }
  } else {
    state.lightningTimer -= dt;
    if (state.lightningTimer <= 0) {
      state.lightning = {
        y: Math.random() * viewH,
        age: 0,
        color: Math.random() < 0.5 ? COLOR_WHITE : COLOR_CYAN,
      };
    }
  }
}

export function drawEnergyBackground(
  ctx: CanvasRenderingContext2D,
  state: EnergyBackground,
  viewW: number,
  viewH: number,
  arena: ArenaScreenBounds | null,
): void {
  ctx.save();
  // If the arena rect covers the entire viewport (small rooms perfectly
  // letterboxed onto a window of matching aspect), there's nowhere to
  // draw — bail out early. Otherwise clip out the arena rect so all
  // strokes/fills get masked there.
  if (arena) {
    if (arena.x <= 0 && arena.y <= 0 && arena.x + arena.w >= viewW && arena.y + arena.h >= viewH) {
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.rect(0, 0, viewW, viewH);
    ctx.rect(arena.x, arena.y, arena.w, arena.h);
    ctx.clip("evenodd");
  }

  // --- Lines pass ---
  ctx.lineCap = "round";
  ctx.shadowBlur = LINE_GLOW_BLUR;
  for (const l of state.lines) {
    const pulse = (Math.sin(l.pulsePhase) * 0.5 + 0.5);
    const alpha = LINE_ALPHA_MIN + (LINE_ALPHA_MAX - LINE_ALPHA_MIN) * pulse;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = l.color;
    ctx.shadowColor = l.color;
    ctx.lineWidth = l.thickness;
    const dx = Math.cos(l.angle) * l.length * 0.5;
    const dy = Math.sin(l.angle) * l.length * 0.5;
    ctx.beginPath();
    ctx.moveTo(l.x - dx, l.y - dy);
    ctx.lineTo(l.x + dx, l.y + dy);
    ctx.stroke();
  }

  // --- Particles pass ---
  ctx.shadowBlur = PARTICLE_GLOW_BLUR;
  for (const p of state.particles) {
    const x = p.baseX + Math.sin(p.swayPhase) * p.swayAmp;
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    const s = p.size;
    ctx.fillRect(x - s * 0.5, p.y - s * 0.5, s, s);
  }

  // --- Lightning pass ---
  if (state.lightning) {
    const ln = state.lightning;
    // Quick attack, gentle fade across the 200ms life.
    const u = ln.age / LIGHTNING_DURATION_SEC;
    const alpha = LIGHTNING_ALPHA * (u < 0.2 ? u / 0.2 : Math.max(0, 1 - (u - 0.2) / 0.8));
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ln.color;
    ctx.shadowColor = ln.color;
    ctx.shadowBlur = LIGHTNING_GLOW_BLUR;
    ctx.lineWidth = LIGHTNING_THICKNESS;
    ctx.beginPath();
    ctx.moveTo(0, ln.y);
    ctx.lineTo(viewW, ln.y);
    ctx.stroke();
  }

  ctx.restore();
}

function pick(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
