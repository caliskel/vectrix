// Animated menu background — runs in its own full-viewport canvas
// behind the menu content. Seven layered effects driven by a single
// requestAnimationFrame loop:
//   1. Solid bg + soft radial gradient (depth)
//   2. Faint cyan grid, slowly scrolling diagonally
//   3. Floating enemy silhouettes — 2 turrets, 1 watcher, 2 hunters
//      drifting on idle paths (no AI, no combat, just decoration)
//   4. Mutating geometric shapes — 3-6 wireframe polygons fading in,
//      rotating, optionally morphing between shape types, fading out
//   5. Dust particles drifting in random directions
//   6. Scanlines, slowly scrolling down (CRT feel)
//   7. Glitch overlays — micro-tears every 8–15 s, big flash every
//      30–60 s; the big flash also fires the caller's onBigGlitch
//
// All positions are stored as normalized [0..1] viewport fractions
// so they re-layout cleanly on window resize. Render runs in a
// single canvas 2D pass — no offscreen buffers, no WebGL.

const PARTICLE_COUNT = 16;
const PARTICLE_SPEED_MIN = 5;
const PARTICLE_SPEED_MAX = 15;
const SCANLINE_SPACING = 4;
const SCANLINE_SPEED = 30;
const SCANLINE_COLOR = "rgba(255, 255, 255, 0.025)";
const GRID_SPACING = 80;
const GRID_SPEED_X = 18;
const GRID_SPEED_Y = 14;
const GRID_COLOR = "rgba(0, 229, 255, 0.06)";
const MICRO_GLITCH_INTERVAL_MIN = 8;
const MICRO_GLITCH_INTERVAL_MAX = 15;
const MICRO_GLITCH_DURATION = 0.08;
const BIG_GLITCH_INTERVAL_MIN = 30;
const BIG_GLITCH_INTERVAL_MAX = 60;
const BIG_GLITCH_DURATION = 0.06;
const PARTICLE_COLOR = "rgba(255, 255, 255, 0.15)";
const RADIAL_INNER = "rgba(40, 60, 100, 0.22)";
const RADIAL_OUTER = "rgba(0, 0, 0, 0)";
const BG_FILL = "#0a0e1a";

// Decorative enemy palette (slightly desaturated from in-game so
// they don't fight the menu text). Alpha is applied at render time.
const COLOR_TURRET = "#00e5ff";
const COLOR_WATCHER = "#ff2d55";
const COLOR_HUNTER = "#fb923c";

const TURRET_RADIUS = 30;
const TURRET_GLOW = 7;
const TURRET_ALPHA = 0.2;
const TURRET_AIM_RETARGET_MIN = 3;     // s
const TURRET_AIM_RETARGET_MAX = 5;
const TURRET_AIM_LERP = 0.8;           // per-second rate

const WATCHER_RADIUS = 28;
const WATCHER_GLOW = 8;
const WATCHER_ALPHA = 0.15;
const WATCHER_ORBIT_R = 300;
const WATCHER_PERIOD_SEC = 30;
const WATCHER_PUPIL_RETARGET_MIN = 1.2;
const WATCHER_PUPIL_RETARGET_MAX = 2.4;

const HUNTER_BODY_LEN = 32;
const HUNTER_ALPHA = 0.2;
const HUNTER_PATH_RADIUS_MIN = 80;
const HUNTER_PATH_RADIUS_MAX = 140;
const HUNTER_BASE_SPEED = 0.4 * 0.3;   // HUNTER_IDLE_PATH_SPEED * 0.3
const HUNTER_TRAIL_COUNT = 5;
const HUNTER_TRAIL_SPACING = 12;       // px between snapshots
const HUNTER_GLOW = 7;

// Master toggle for the decorative-enemies + mutating-shapes layers.
// When false, the menu bg falls back to grid + matrix rain only;
// neither layer ticks its update logic, so no idle CPU cost from
// hunter trail snapshots or shape spawn timers.
const DECORATIVE_BG_ENABLED = false;

// Matrix-style code rain. Sparse columns of half-width katakana +
// digits drifting down behind the menu — fits the "VECTRIX = vector
// matrix" wordplay without overwhelming the foreground UI. Lives
// between the grid and the decorative enemies in the layer stack so
// the rain reads as a back-of-stage atmosphere rather than competing
// with the eye-tracking previews.
const MATRIX_COL_SPACING = 36;
const MATRIX_FONT_SIZE = 16;
const MATRIX_LINE_HEIGHT = 18;
const MATRIX_TAIL_LENGTH = 14;
const MATRIX_SPEED_MIN = 2.2; // chars per second
const MATRIX_SPEED_MAX = 6.0;
const MATRIX_CHAR_CHANGE_PROB = 0.025; // per char per frame at 60 fps
const MATRIX_OVERALL_ALPHA = 0.32;
const MATRIX_HEAD_COLOR = "#a7f3d0";
const MATRIX_TRAIL_COLOR = "#22c55e";
const MATRIX_ACTIVE_FRACTION = 0.65; // % of columns that are alive at a time
const MATRIX_RESPAWN_DELAY_MIN = 1.0;
const MATRIX_RESPAWN_DELAY_MAX = 4.5;
const MATRIX_CHAR_POOL =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ0123456789";

const SHAPE_COUNT_MIN = 3;
const SHAPE_COUNT_MAX = 6;
const SHAPE_SPAWN_INTERVAL_MIN = 1.5;
const SHAPE_SPAWN_INTERVAL_MAX = 3.0;
const SHAPE_LIFE_MIN = 3.0;
const SHAPE_LIFE_MAX = 8.0;
const SHAPE_SIZE_MIN = 30;
const SHAPE_SIZE_MAX = 60;
const SHAPE_FADE_IN_SEC = 0.6;
const SHAPE_FADE_OUT_SEC = 0.5;
const SHAPE_MORPH_DURATION_SEC = 0.8;
const SHAPE_MORPH_CHANCE = 0.5;        // half the shapes morph mid-life
const SHAPE_PULSE_CHANCE = 0.5;        // half the shapes pulsate
const SHAPE_PULSE_AMPLITUDE = 0.05;
const SHAPE_PULSE_PERIOD = 2.0;
const SHAPE_ROTATION_VEL_MIN = 0.0003; // rad per ms — converted to s
const SHAPE_ROTATION_VEL_MAX = 0.0008;
const SHAPE_CENTER_GUARD_R = 250;      // keep spawns this far from screen center
const SHAPE_LINE_WIDTH = 1.7;
const SHAPE_ALPHA_MAX = 0.25;
const SHAPE_COLORS = ["#00e5ff", "#ff2d55", "#fb923c", "#a855f7", "#ffffff"];
type ShapeType = "triangle" | "square" | "hexagon" | "circle" | "line";
const SHAPE_TYPES: ShapeType[] = [
  "triangle",
  "square",
  "hexagon",
  "circle",
  "line",
];

type Particle = { x: number; y: number; vx: number; vy: number; size: number };
type RainColumn = {
  x: number;
  headY: number;
  speed: number; // chars per second
  chars: string[]; // length = MATRIX_TAIL_LENGTH; chars[0] is the head
  active: boolean;
  spawnIn: number; // seconds until next activation when inactive
};
type MicroGlitch = { y: number; h: number; dx: number; remaining: number };
type BigGlitch = { remaining: number };

type TurretD = {
  nx: number;        // normalized [0..1]
  ny: number;
  angle: number;     // barrel angle (rad)
  targetAngle: number;
  retargetIn: number;
};

type WatcherD = {
  baseNx: number;
  baseNy: number;
  ampX: number;
  ampY: number;
  phase: number;     // rad, 0..2π
  // Pupil idle look — slow random drift toward a target offset.
  pupilCurX: number;
  pupilCurY: number;
  pupilTargetX: number;
  pupilTargetY: number;
  pupilRetargetIn: number;
};

type HunterD = {
  homeNx: number;
  homeNy: number;
  pathType: "figure8" | "oval" | "circle";
  radiusX: number;   // px
  radiusY: number;
  rotation: number;  // path rotation (rad)
  phase: number;
  speed: number;     // rad/s phase rate
  bodyAngle: number; // smoothed tangent angle
  trail: { x: number; y: number; angle: number }[];
  trailAccumulator: number;
};

type ShapeD = {
  nx: number;
  ny: number;
  type: ShapeType;
  morphFromType: ShapeType | null; // non-null during morph
  morphProgress: number;           // 0..1 across SHAPE_MORPH_DURATION_SEC
  size: number;
  rotation: number;
  rotationVel: number;
  age: number;
  life: number;
  color: string;
  pulses: boolean;
  pulsePhase: number;
  morphScheduledAt: number;        // age at which to begin morph
  willMorph: boolean;
};

export type MenuBg = {
  canvas: HTMLCanvasElement;
  /** Optional callback fired once per big-glitch flash so the caller
   *  can layer a static-crackle audio cue on top. */
  onBigGlitch?: () => void;
  dispose: () => void;
};

export function startMenuBg(
  canvas: HTMLCanvasElement,
  opts: { onBigGlitch?: () => void } = {},
): MenuBg {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { canvas, onBigGlitch: opts.onBigGlitch, dispose: () => {} };
  }
  let width = 0;
  let height = 0;
  let dpr = window.devicePixelRatio || 1;
  let particles: Particle[] = [];
  let scanlineOffset = 0;
  let gridOffsetX = 0;
  let gridOffsetY = 0;
  let microTimer = pickInterval(MICRO_GLITCH_INTERVAL_MIN, MICRO_GLITCH_INTERVAL_MAX);
  let micro: MicroGlitch | null = null;
  let bigTimer = pickInterval(BIG_GLITCH_INTERVAL_MIN, BIG_GLITCH_INTERVAL_MAX);
  let big: BigGlitch | null = null;
  let lastTime = performance.now();
  let raf: number | null = null;

  // === Decorative entities. Seeded once on first resize and then
  // updated in place — they're meant to be persistent fixtures of
  // the menu, not respawning content. ===
  const turrets: TurretD[] = [];
  const watcher: WatcherD = {
    baseNx: 0.08,
    baseNy: 0.3,
    ampX: 60,
    ampY: 30,
    phase: Math.random() * Math.PI * 2,
    pupilCurX: 0,
    pupilCurY: 0,
    pupilTargetX: 0,
    pupilTargetY: 0,
    pupilRetargetIn: 1,
  };
  const hunters: HunterD[] = [];
  let decorSeeded = false;

  // === Mutating geometric shapes ===
  const shapes: ShapeD[] = [];
  let shapeSpawnTimer = SHAPE_SPAWN_INTERVAL_MIN;

  // === Matrix rain columns — seeded on resize, advanced in update ===
  let rainColumns: RainColumn[] = [];

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (particles.length === 0) seedParticles();
    if (!decorSeeded) {
      seedDecor();
      decorSeeded = true;
    }
    seedRain();
  }

  function pickRainChar(): string {
    return MATRIX_CHAR_POOL[
      Math.floor(Math.random() * MATRIX_CHAR_POOL.length)
    ];
  }

  function seedRain() {
    const cols = Math.max(1, Math.ceil(width / MATRIX_COL_SPACING));
    rainColumns = [];
    for (let i = 0; i < cols; i++) {
      const chars: string[] = new Array(MATRIX_TAIL_LENGTH);
      for (let j = 0; j < MATRIX_TAIL_LENGTH; j++) chars[j] = pickRainChar();
      const x = i * MATRIX_COL_SPACING + MATRIX_COL_SPACING / 2;
      const speed =
        MATRIX_SPEED_MIN +
        Math.random() * (MATRIX_SPEED_MAX - MATRIX_SPEED_MIN);
      const startsActive = Math.random() < MATRIX_ACTIVE_FRACTION;
      rainColumns.push({
        x,
        headY: startsActive ? Math.random() * height : -MATRIX_LINE_HEIGHT,
        speed,
        chars,
        active: startsActive,
        spawnIn: startsActive
          ? 0
          : MATRIX_RESPAWN_DELAY_MIN +
            Math.random() *
              (MATRIX_RESPAWN_DELAY_MAX - MATRIX_RESPAWN_DELAY_MIN),
      });
    }
  }

  function updateRain(dt: number) {
    const tailHeight = MATRIX_TAIL_LENGTH * MATRIX_LINE_HEIGHT;
    for (const col of rainColumns) {
      if (!col.active) {
        col.spawnIn -= dt;
        if (col.spawnIn <= 0) {
          col.active = true;
          col.headY = -MATRIX_LINE_HEIGHT;
        }
        continue;
      }
      col.headY += col.speed * MATRIX_LINE_HEIGHT * dt;
      for (let i = 0; i < col.chars.length; i++) {
        if (Math.random() < MATRIX_CHAR_CHANGE_PROB) {
          col.chars[i] = pickRainChar();
        }
      }
      if (col.headY - tailHeight > height) {
        col.active = false;
        col.spawnIn =
          MATRIX_RESPAWN_DELAY_MIN +
          Math.random() *
            (MATRIX_RESPAWN_DELAY_MAX - MATRIX_RESPAWN_DELAY_MIN);
      }
    }
  }

  function seedParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = PARTICLE_SPEED_MIN +
        Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + Math.random(),
      });
    }
  }

  function seedDecor() {
    // Turrets sit in the bottom corners, kept clear of the menu's
    // center column. Each starts with a random barrel angle.
    turrets.push({
      nx: 0.13 + Math.random() * 0.04,
      ny: 0.74 + Math.random() * 0.08,
      angle: Math.random() * Math.PI * 2,
      targetAngle: Math.random() * Math.PI * 2,
      retargetIn: pickInterval(TURRET_AIM_RETARGET_MIN, TURRET_AIM_RETARGET_MAX),
    });
    turrets.push({
      nx: 0.86 + Math.random() * 0.04,
      ny: 0.76 + Math.random() * 0.08,
      angle: Math.random() * Math.PI * 2,
      targetAngle: Math.random() * Math.PI * 2,
      retargetIn: pickInterval(TURRET_AIM_RETARGET_MIN, TURRET_AIM_RETARGET_MAX),
    });
    // Watcher in upper-left margin, on its long orbital drift.
    watcher.baseNx = 0.07 + Math.random() * 0.04;
    watcher.baseNy = 0.22 + Math.random() * 0.1;
    // Two hunters — different idle path types so they look distinct.
    const pathTypes: ("figure8" | "oval" | "circle")[] = [
      "figure8",
      "oval",
      "circle",
    ];
    hunters.push(makeHunter(0.9, 0.18, pathTypes[Math.floor(Math.random() * 3)]));
    hunters.push(makeHunter(0.84, 0.88, pathTypes[Math.floor(Math.random() * 3)]));
  }

  function makeHunter(
    homeNx: number,
    homeNy: number,
    pathType: "figure8" | "oval" | "circle",
  ): HunterD {
    return {
      homeNx,
      homeNy,
      pathType,
      radiusX:
        HUNTER_PATH_RADIUS_MIN +
        Math.random() * (HUNTER_PATH_RADIUS_MAX - HUNTER_PATH_RADIUS_MIN),
      radiusY:
        HUNTER_PATH_RADIUS_MIN * 0.55 +
        Math.random() *
          (HUNTER_PATH_RADIUS_MAX * 0.55 - HUNTER_PATH_RADIUS_MIN * 0.55),
      rotation: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      speed: HUNTER_BASE_SPEED,
      bodyAngle: 0,
      trail: [],
      trailAccumulator: 0,
    };
  }

  function frame(now: number) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    render();
    raf = requestAnimationFrame(frame);
  }

  function update(dt: number) {
    scanlineOffset = (scanlineOffset + SCANLINE_SPEED * dt) % SCANLINE_SPACING;
    gridOffsetX = (gridOffsetX + GRID_SPEED_X * dt) % GRID_SPACING;
    gridOffsetY = (gridOffsetY + GRID_SPEED_Y * dt) % GRID_SPACING;
    updateRain(dt);

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -2) p.x += width + 4;
      else if (p.x > width + 2) p.x -= width + 4;
      if (p.y < -2) p.y += height + 4;
      else if (p.y > height + 2) p.y -= height + 4;
    }

    if (DECORATIVE_BG_ENABLED) {
      updateTurrets(dt);
      updateWatcher(dt);
      updateHunters(dt);
      updateShapes(dt);
    }

    microTimer -= dt;
    if (microTimer <= 0 && !micro) {
      micro = {
        y: Math.random() * height,
        h: 20 + Math.random() * 20,
        dx: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 12),
        remaining: MICRO_GLITCH_DURATION,
      };
      microTimer = pickInterval(
        MICRO_GLITCH_INTERVAL_MIN,
        MICRO_GLITCH_INTERVAL_MAX,
      );
    }
    if (micro) {
      micro.remaining -= dt;
      if (micro.remaining <= 0) micro = null;
    }

    bigTimer -= dt;
    if (bigTimer <= 0 && !big) {
      big = { remaining: BIG_GLITCH_DURATION };
      bigTimer = pickInterval(
        BIG_GLITCH_INTERVAL_MIN,
        BIG_GLITCH_INTERVAL_MAX,
      );
      opts.onBigGlitch?.();
    }
    if (big) {
      big.remaining -= dt;
      if (big.remaining <= 0) big = null;
    }
  }

  function updateTurrets(dt: number) {
    for (const t of turrets) {
      t.retargetIn -= dt;
      if (t.retargetIn <= 0) {
        t.targetAngle = Math.random() * Math.PI * 2;
        t.retargetIn = pickInterval(
          TURRET_AIM_RETARGET_MIN,
          TURRET_AIM_RETARGET_MAX,
        );
      }
      const k = 1 - Math.exp(-TURRET_AIM_LERP * dt);
      let diff = t.targetAngle - t.angle;
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (diff < -Math.PI) diff += Math.PI * 2;
      t.angle += diff * k;
    }
  }

  function updateWatcher(dt: number) {
    watcher.phase = (watcher.phase + (Math.PI * 2 * dt) / WATCHER_PERIOD_SEC) %
      (Math.PI * 2);
    // Pupil idle look — slow drift to a new offset target every
    // 1.2–2.4 s, lerping toward it. Target stays within the iris.
    watcher.pupilRetargetIn -= dt;
    if (watcher.pupilRetargetIn <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.55;
      watcher.pupilTargetX = Math.cos(a) * r;
      watcher.pupilTargetY = Math.sin(a) * r;
      watcher.pupilRetargetIn = pickInterval(
        WATCHER_PUPIL_RETARGET_MIN,
        WATCHER_PUPIL_RETARGET_MAX,
      );
    }
    const k = 1 - Math.exp(-3 * dt);
    watcher.pupilCurX += (watcher.pupilTargetX - watcher.pupilCurX) * k;
    watcher.pupilCurY += (watcher.pupilTargetY - watcher.pupilCurY) * k;
  }

  function updateHunters(dt: number) {
    for (const h of hunters) {
      const prevPos = sampleHunterPath(h);
      h.phase += h.speed * dt * Math.PI * 2; // path speed in cycles/s
      const next = sampleHunterPath(h);
      // Smoothly orient body along the velocity tangent.
      const dx = next.x - prevPos.x;
      const dy = next.y - prevPos.y;
      if (dx * dx + dy * dy > 0.0001) {
        const target = Math.atan2(dy, dx);
        let diff = target - h.bodyAngle;
        diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (diff < -Math.PI) diff += Math.PI * 2;
        const k = 1 - Math.exp(-6 * dt);
        h.bodyAngle += diff * k;
      }
      // Trail: drop a snapshot whenever the body has moved a fixed
      // distance from the previous snapshot. Keeps the trail evenly
      // spaced regardless of frame rate.
      const stepDist = Math.hypot(dx, dy);
      h.trailAccumulator += stepDist;
      while (h.trailAccumulator >= HUNTER_TRAIL_SPACING) {
        h.trail.unshift({
          x: next.x,
          y: next.y,
          angle: h.bodyAngle,
        });
        if (h.trail.length > HUNTER_TRAIL_COUNT) h.trail.length = HUNTER_TRAIL_COUNT;
        h.trailAccumulator -= HUNTER_TRAIL_SPACING;
      }
    }
  }

  function sampleHunterPath(h: HunterD): { x: number; y: number } {
    // Hunter "home" is in normalized coords; multiply by width/height
    // so the path scales with the viewport.
    const cx = h.homeNx * width;
    const cy = h.homeNy * height;
    let lx = 0;
    let ly = 0;
    if (h.pathType === "circle") {
      lx = Math.cos(h.phase) * h.radiusX;
      ly = Math.sin(h.phase) * h.radiusX;
    } else if (h.pathType === "oval") {
      lx = Math.cos(h.phase) * h.radiusX;
      ly = Math.sin(h.phase) * h.radiusY;
    } else {
      // figure8 lemniscate of Gerono
      lx = Math.cos(h.phase) * h.radiusX;
      ly = Math.sin(h.phase * 2) * h.radiusY * 0.5;
    }
    // Rotate the local path point by the hunter's path rotation.
    const cosR = Math.cos(h.rotation);
    const sinR = Math.sin(h.rotation);
    return {
      x: cx + lx * cosR - ly * sinR,
      y: cy + lx * sinR + ly * cosR,
    };
  }

  function updateShapes(dt: number) {
    // Tick existing shapes; remove ones whose life ran out.
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      s.age += dt;
      s.rotation += s.rotationVel * dt;
      if (s.pulses) s.pulsePhase += dt;
      // Morph transition midway through life. We bake the source
      // type into morphFromType and ramp morphProgress 0→1 over
      // SHAPE_MORPH_DURATION_SEC. Once complete, morphFromType is
      // cleared so the renderer draws only the destination shape.
      if (
        s.willMorph &&
        s.morphFromType === null &&
        s.age >= s.morphScheduledAt
      ) {
        s.morphFromType = s.type;
        // Pick a destination type that's actually different.
        const candidates = SHAPE_TYPES.filter((t) => t !== s.type);
        s.type = candidates[Math.floor(Math.random() * candidates.length)];
        s.morphProgress = 0;
      }
      if (s.morphFromType !== null) {
        s.morphProgress += dt / SHAPE_MORPH_DURATION_SEC;
        if (s.morphProgress >= 1) {
          s.morphProgress = 1;
          s.morphFromType = null;
        }
      }
      if (s.age >= s.life) {
        shapes.splice(i, 1);
      }
    }
    // Spawn fresh shapes until we hit the floor.
    shapeSpawnTimer -= dt;
    const wantMore = shapes.length < SHAPE_COUNT_MAX;
    if (
      wantMore &&
      (shapes.length < SHAPE_COUNT_MIN || shapeSpawnTimer <= 0)
    ) {
      spawnShape();
      shapeSpawnTimer = pickInterval(
        SHAPE_SPAWN_INTERVAL_MIN,
        SHAPE_SPAWN_INTERVAL_MAX,
      );
    }
  }

  function spawnShape() {
    // Reject positions within SHAPE_CENTER_GUARD_R of viewport
    // center so shapes don't sit behind the logo / buttons. Bail
    // after a few rolls to avoid blocking on very small viewports.
    const cx = width / 2;
    const cy = height / 2;
    let nx = 0.5;
    let ny = 0.5;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidateNx = Math.random();
      const candidateNy = Math.random();
      const dx = candidateNx * width - cx;
      const dy = candidateNy * height - cy;
      if (dx * dx + dy * dy >= SHAPE_CENTER_GUARD_R * SHAPE_CENTER_GUARD_R) {
        nx = candidateNx;
        ny = candidateNy;
        break;
      }
      if (attempt === 7) {
        nx = candidateNx;
        ny = candidateNy;
      }
    }
    const type = SHAPE_TYPES[Math.floor(Math.random() * SHAPE_TYPES.length)];
    const size =
      SHAPE_SIZE_MIN + Math.random() * (SHAPE_SIZE_MAX - SHAPE_SIZE_MIN);
    const life =
      SHAPE_LIFE_MIN + Math.random() * (SHAPE_LIFE_MAX - SHAPE_LIFE_MIN);
    const willMorph = Math.random() < SHAPE_MORPH_CHANCE;
    shapes.push({
      nx,
      ny,
      type,
      morphFromType: null,
      morphProgress: 0,
      size,
      rotation: Math.random() * Math.PI * 2,
      rotationVel:
        (SHAPE_ROTATION_VEL_MIN +
          Math.random() *
            (SHAPE_ROTATION_VEL_MAX - SHAPE_ROTATION_VEL_MIN)) *
        1000 *
        (Math.random() < 0.5 ? -1 : 1),
      age: 0,
      life,
      color: SHAPE_COLORS[Math.floor(Math.random() * SHAPE_COLORS.length)],
      pulses: Math.random() < SHAPE_PULSE_CHANCE,
      pulsePhase: Math.random() * Math.PI * 2,
      morphScheduledAt: life * (0.3 + Math.random() * 0.3),
      willMorph,
    });
  }

  function render() {
    const c = ctx!;
    // 1. Solid bg + radial center glow
    c.fillStyle = BG_FILL;
    c.fillRect(0, 0, width, height);
    const grad = c.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.7,
    );
    grad.addColorStop(0, RADIAL_INNER);
    grad.addColorStop(1, RADIAL_OUTER);
    c.fillStyle = grad;
    c.fillRect(0, 0, width, height);

    // 2. Grid
    c.strokeStyle = GRID_COLOR;
    c.lineWidth = 1;
    c.beginPath();
    for (let x = -GRID_SPACING + gridOffsetX; x < width; x += GRID_SPACING) {
      const xx = Math.floor(x) + 0.5;
      c.moveTo(xx, 0);
      c.lineTo(xx, height);
    }
    for (let y = -GRID_SPACING + gridOffsetY; y < height; y += GRID_SPACING) {
      const yy = Math.floor(y) + 0.5;
      c.moveTo(0, yy);
      c.lineTo(width, yy);
    }
    c.stroke();

    // 2b. Matrix rain — drawn between grid and decorative enemies so
    // it reads as a back-of-stage layer. Cheap fillText pass; sparse
    // columns + low overall alpha keep it from competing with the
    // foreground UI.
    renderRain(c);

    if (DECORATIVE_BG_ENABLED) {
      // 3. Decorative enemies — turrets, watcher, hunters
      for (const t of turrets) renderTurret(c, t);
      renderWatcher(c, watcher);
      for (const h of hunters) renderHunter(c, h);

      // 4. Geometric shapes (above enemies, below dust/scanlines)
      for (const s of shapes) renderShape(c, s);
    }

    // 5. Particles (dust)
    c.fillStyle = PARTICLE_COLOR;
    for (const p of particles) {
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }

    // 6. Scanlines
    c.fillStyle = SCANLINE_COLOR;
    for (
      let y = -SCANLINE_SPACING + scanlineOffset;
      y < height;
      y += SCANLINE_SPACING
    ) {
      c.fillRect(0, y, width, 1);
    }

    // 7. Glitch overlays — last so they sit on top of everything
    if (micro) {
      c.save();
      c.drawImage(
        canvas,
        0,
        micro.y * dpr,
        width * dpr,
        micro.h * dpr,
        micro.dx,
        micro.y,
        width,
        micro.h,
      );
      c.globalCompositeOperation = "source-atop";
      c.fillStyle = "rgba(255, 45, 85, 0.18)";
      c.fillRect(micro.dx, micro.y, width, micro.h);
      c.restore();
    }
    if (big) {
      c.fillStyle = "rgba(255, 255, 255, 0.08)";
      c.fillRect(0, 0, width, height);
    }
  }

  function renderRain(c: CanvasRenderingContext2D) {
    if (rainColumns.length === 0) return;
    c.save();
    c.font = `${MATRIX_FONT_SIZE}px "Courier New", ui-monospace, monospace`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowBlur = 0;
    for (const col of rainColumns) {
      if (!col.active) continue;
      for (let i = 0; i < col.chars.length; i++) {
        const y = col.headY - i * MATRIX_LINE_HEIGHT;
        if (y < -MATRIX_LINE_HEIGHT || y > height + MATRIX_LINE_HEIGHT) continue;
        // Quadratic fade so the head is bright and the tail falls off
        // fast — keeps the trail "alive" without spreading into the
        // foreground UI region.
        const tailFrac = 1 - i / col.chars.length;
        const fade = tailFrac * tailFrac;
        c.globalAlpha = MATRIX_OVERALL_ALPHA * fade;
        c.fillStyle = i === 0 ? MATRIX_HEAD_COLOR : MATRIX_TRAIL_COLOR;
        c.fillText(col.chars[i], col.x, y);
      }
    }
    c.restore();
  }

  function renderTurret(c: CanvasRenderingContext2D, t: TurretD) {
    const x = t.nx * width;
    const y = t.ny * height;
    c.save();
    c.globalAlpha = TURRET_ALPHA;
    c.shadowBlur = TURRET_GLOW;
    c.shadowColor = COLOR_TURRET;
    c.strokeStyle = COLOR_TURRET;
    c.lineWidth = 2;
    // Body — a hollow circle.
    c.beginPath();
    c.arc(x, y, TURRET_RADIUS * 0.55, 0, Math.PI * 2);
    c.stroke();
    // Inner ring detail.
    c.beginPath();
    c.arc(x, y, TURRET_RADIUS * 0.32, 0, Math.PI * 2);
    c.stroke();
    // Barrel — a stubby line from body edge outward.
    const cosA = Math.cos(t.angle);
    const sinA = Math.sin(t.angle);
    const r0 = TURRET_RADIUS * 0.35;
    const r1 = TURRET_RADIUS * 1.05;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(x + cosA * r0, y + sinA * r0);
    c.lineTo(x + cosA * r1, y + sinA * r1);
    c.stroke();
    c.restore();
  }

  function renderWatcher(c: CanvasRenderingContext2D, w: WatcherD) {
    // Orbital drift via a wide ellipse around the home point.
    const cx =
      w.baseNx * width + Math.cos(w.phase) * WATCHER_ORBIT_R * 0.4;
    const cy =
      w.baseNy * height + Math.sin(w.phase) * WATCHER_ORBIT_R * 0.25;
    c.save();
    c.globalAlpha = WATCHER_ALPHA;
    c.shadowBlur = WATCHER_GLOW;
    c.shadowColor = COLOR_WATCHER;
    // Outer ring
    c.strokeStyle = COLOR_WATCHER;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, WATCHER_RADIUS, 0, Math.PI * 2);
    c.stroke();
    // Iris fill
    c.shadowBlur = 0;
    c.fillStyle = "rgba(255, 45, 85, 0.18)";
    c.beginPath();
    c.arc(cx, cy, WATCHER_RADIUS * 0.7, 0, Math.PI * 2);
    c.fill();
    // Pupil — small dark dot, offset by idle-look state.
    const pr = WATCHER_RADIUS * 0.7;
    const px = cx + w.pupilCurX * pr * 0.6;
    const py = cy + w.pupilCurY * pr * 0.6;
    c.fillStyle = "#0a0e1a";
    c.beginPath();
    c.arc(px, py, WATCHER_RADIUS * 0.22, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function renderHunter(c: CanvasRenderingContext2D, h: HunterD) {
    const pos = sampleHunterPath(h);
    c.save();
    c.shadowBlur = HUNTER_GLOW;
    c.shadowColor = COLOR_HUNTER;
    c.strokeStyle = COLOR_HUNTER;
    c.fillStyle = "rgba(251, 146, 60, 0.22)";
    c.lineWidth = 1.6;

    // Trail — older copies dimmer.
    for (let i = h.trail.length - 1; i >= 0; i--) {
      const sample = h.trail[i];
      const t = i / Math.max(1, HUNTER_TRAIL_COUNT - 1);
      const ghostAlpha = HUNTER_ALPHA * (1 - t) * 0.5;
      c.globalAlpha = ghostAlpha;
      drawHunterArrow(c, sample.x, sample.y, sample.angle);
    }
    // Body
    c.globalAlpha = HUNTER_ALPHA;
    drawHunterArrow(c, pos.x, pos.y, h.bodyAngle);
    c.restore();
  }

  function drawHunterArrow(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
  ) {
    const len = HUNTER_BODY_LEN;
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.beginPath();
    c.moveTo(-len * 0.5, -len * 0.3);
    c.lineTo(len * 0.5, 0);
    c.lineTo(-len * 0.5, len * 0.3);
    c.lineTo(-len * 0.25, 0);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  function renderShape(c: CanvasRenderingContext2D, s: ShapeD) {
    const x = s.nx * width;
    const y = s.ny * height;

    // Lifecycle scale + alpha. Fade-in over SHAPE_FADE_IN_SEC,
    // hold, then fade-out over SHAPE_FADE_OUT_SEC. During a morph
    // we also dip the scale toward 0 at the midpoint, then back up.
    let lifeScale = 1;
    let alpha = SHAPE_ALPHA_MAX;
    if (s.age < SHAPE_FADE_IN_SEC) {
      const t = s.age / SHAPE_FADE_IN_SEC;
      lifeScale = t;
      alpha = SHAPE_ALPHA_MAX * t;
    } else if (s.age > s.life - SHAPE_FADE_OUT_SEC) {
      const t = (s.life - s.age) / SHAPE_FADE_OUT_SEC;
      lifeScale = Math.max(0, t);
      alpha = SHAPE_ALPHA_MAX * Math.max(0, t);
    }
    if (s.pulses) {
      const u = Math.sin((s.pulsePhase / SHAPE_PULSE_PERIOD) * Math.PI * 2);
      lifeScale *= 1 + u * SHAPE_PULSE_AMPLITUDE;
    }
    // Morph dips the scale to ~0.6 at the halfway point.
    if (s.morphFromType !== null) {
      const dip = 1 - 0.4 * Math.sin(s.morphProgress * Math.PI);
      lifeScale *= dip;
    }

    c.save();
    c.globalAlpha = alpha;
    c.shadowBlur = 8;
    c.shadowColor = s.color;
    c.strokeStyle = s.color;
    c.lineWidth = SHAPE_LINE_WIDTH;
    c.translate(x, y);
    c.rotate(s.rotation);
    const size = s.size * lifeScale;
    // For a morph we render BOTH shapes blended via alpha — the
    // source fades out as the destination fades in. They share
    // size / rotation / center.
    if (s.morphFromType !== null) {
      const u = s.morphProgress;
      c.globalAlpha = alpha * (1 - u);
      drawShape(c, s.morphFromType, size);
      c.globalAlpha = alpha * u;
      drawShape(c, s.type, size);
    } else {
      drawShape(c, s.type, size);
    }
    c.restore();
  }

  function drawShape(
    c: CanvasRenderingContext2D,
    type: ShapeType,
    size: number,
  ) {
    switch (type) {
      case "triangle":
        tracePolygon(c, size, 3);
        break;
      case "square":
        tracePolygon(c, size, 4);
        break;
      case "hexagon":
        tracePolygon(c, size, 6);
        break;
      case "circle":
        c.beginPath();
        c.arc(0, 0, size, 0, Math.PI * 2);
        c.stroke();
        return;
      case "line":
        c.beginPath();
        c.moveTo(-size, 0);
        c.lineTo(size, 0);
        c.stroke();
        return;
    }
    c.stroke();
  }

  function tracePolygon(
    c: CanvasRenderingContext2D,
    r: number,
    sides: number,
  ) {
    c.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }

  resize();
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(frame);

  return {
    canvas,
    onBigGlitch: opts.onBigGlitch,
    dispose: () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    },
  };
}

function pickInterval(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
