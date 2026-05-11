// Archive ambience — environmental storytelling for the dead-network
// theme. Two systems share this module:
//
//   1. GHOST TEXT — short archival fragments (catalog numbers, dates,
//      half-words) that fade in/hold/fade out at random arena
//      positions. Reads as "the system still remembers itself, in
//      pieces". Pure visual; never blocks gameplay, never aligned to
//      anything the player must read.
//
//   2. PHANTOM VISITORS — soft humanoid silhouettes that briefly
//      appear at the arena edge, take a step or two, and dissolve
//      into dust. Echoes of the readers who used to come here. Very
//      rare so they retain the "I just saw something" quality.
//
// Both spawn in world space so they scroll with the camera in rooms
// that use one. Both are stateful — created per room, ticked + drawn
// every frame. Designed to be cheap (≤ 3 live ghosts, ≤ 1 live
// phantom at any time).

const GHOST_SPAWN_INTERVAL_MIN = 5.0;
const GHOST_SPAWN_INTERVAL_MAX = 11.0;
const GHOST_MAX_ACTIVE = 3;
const GHOST_FADE_IN_SEC = 0.6;
const GHOST_HOLD_SEC = 1.2;
const GHOST_FADE_OUT_SEC = 1.4;
const GHOST_TOTAL_SEC = GHOST_FADE_IN_SEC + GHOST_HOLD_SEC + GHOST_FADE_OUT_SEC;
const GHOST_MAX_ALPHA = 0.18;
const GHOST_PLAYER_EXCLUSION_RADIUS = 140;
const GHOST_SPAWN_ATTEMPTS = 4;

const PHANTOM_SPAWN_INTERVAL_MIN = 14.0;
const PHANTOM_SPAWN_INTERVAL_MAX = 26.0;
const PHANTOM_WALK_DURATION_SEC = 1.6;
const PHANTOM_DISSOLVE_DURATION_SEC = 0.8;
const PHANTOM_TOTAL_SEC = PHANTOM_WALK_DURATION_SEC + PHANTOM_DISSOLVE_DURATION_SEC;
const PHANTOM_HEAD_R = 5;
const PHANTOM_BODY_H = 22;
const PHANTOM_BODY_W = 11;
const PHANTOM_WALK_DISTANCE = 80;
const PHANTOM_MAX_ALPHA = 0.16;
const PHANTOM_EDGE_INSET = 60;
const PHANTOM_PARTICLE_COUNT = 10;

// Mixed catalog schemes — the public archive never converged on a
// single naming convention, so different decades and departments left
// their own labels behind.
const GHOST_FRAGMENTS = [
  "K-3147",
  "A-0892",
  "F-12.04",
  "FILE No.2871",
  "1987-08-14",
  "12.03.91",
  "APR 1994",
  "inde…",
  "cata…",
  "regis…",
  "arch…",
  "circ…",
  "form…",
  "CIRCULATION DESK",
  "MASTER INDEX",
  "RESTRICTED",
  "REC.0014/B",
  "INDEX-A12",
  "ARCH/2-91",
  "MEMO_OS-12-04",
  "AVAILABLE",
  "ISSUED",
  "PURGED",
  "REF. 1973",
  "—— ——",
  "?  ?  ?",
  "LOST",
  "STACK 14",
  "PERIODICALS",
  "READING ROOM 3",
];

type Ghost = {
  x: number;
  y: number;
  text: string;
  age: number;
  fontSize: number;
};

type Phantom = {
  edgeKind: "top" | "bottom" | "left" | "right";
  startX: number;
  startY: number;
  dirX: number;
  dirY: number;
  age: number;
  dustParticles: PhantomParticle[];
  dustSpawned: boolean;
};

type PhantomParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
};

export type ArchiveFx = {
  width: number;
  height: number;
  ghosts: Ghost[];
  ghostSpawnTimer: number;
  phantoms: Phantom[];
  phantomSpawnTimer: number;
};

export function createArchiveFx(width: number, height: number): ArchiveFx {
  return {
    width,
    height,
    ghosts: [],
    ghostSpawnTimer: randBetween(
      GHOST_SPAWN_INTERVAL_MIN,
      GHOST_SPAWN_INTERVAL_MAX,
    ) * 0.4,
    phantoms: [],
    phantomSpawnTimer: randBetween(
      PHANTOM_SPAWN_INTERVAL_MIN,
      PHANTOM_SPAWN_INTERVAL_MAX,
    ) * 0.5,
  };
}

export function updateArchiveFx(
  fx: ArchiveFx,
  dt: number,
  playerX: number,
  playerY: number,
): void {
  // ---- Ghost text ----
  fx.ghostSpawnTimer -= dt;
  if (
    fx.ghostSpawnTimer <= 0 &&
    fx.ghosts.length < GHOST_MAX_ACTIVE
  ) {
    fx.ghostSpawnTimer = randBetween(
      GHOST_SPAWN_INTERVAL_MIN,
      GHOST_SPAWN_INTERVAL_MAX,
    );
    spawnGhost(fx, playerX, playerY);
  }
  for (let i = fx.ghosts.length - 1; i >= 0; i--) {
    fx.ghosts[i].age += dt;
    if (fx.ghosts[i].age >= GHOST_TOTAL_SEC) fx.ghosts.splice(i, 1);
  }

  // ---- Phantom visitors ----
  fx.phantomSpawnTimer -= dt;
  if (fx.phantomSpawnTimer <= 0 && fx.phantoms.length === 0) {
    fx.phantomSpawnTimer = randBetween(
      PHANTOM_SPAWN_INTERVAL_MIN,
      PHANTOM_SPAWN_INTERVAL_MAX,
    );
    spawnPhantom(fx);
  }
  for (let i = fx.phantoms.length - 1; i >= 0; i--) {
    const p = fx.phantoms[i];
    p.age += dt;
    // At end of walk, kick off dissolve dust if not already.
    if (p.age >= PHANTOM_WALK_DURATION_SEC && !p.dustSpawned) {
      const cx = p.startX + p.dirX * PHANTOM_WALK_DISTANCE;
      const cy = p.startY + p.dirY * PHANTOM_WALK_DISTANCE;
      for (let j = 0; j < PHANTOM_PARTICLE_COUNT; j++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 50;
        p.dustParticles.push({
          x: cx + (Math.random() - 0.5) * PHANTOM_BODY_W,
          y: cy - PHANTOM_BODY_H / 2 + Math.random() * PHANTOM_BODY_H,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          age: 0,
          lifetime: PHANTOM_DISSOLVE_DURATION_SEC,
        });
      }
      p.dustSpawned = true;
    }
    // Age dust particles.
    for (const dp of p.dustParticles) {
      dp.age += dt;
      dp.x += dp.vx * dt;
      dp.y += dp.vy * dt;
    }
    if (p.age >= PHANTOM_TOTAL_SEC) fx.phantoms.splice(i, 1);
  }
}

function spawnGhost(fx: ArchiveFx, playerX: number, playerY: number): void {
  for (let i = 0; i < GHOST_SPAWN_ATTEMPTS; i++) {
    const x = randBetween(60, fx.width - 60);
    const y = randBetween(60, fx.height - 60);
    const dx = x - playerX;
    const dy = y - playerY;
    if (dx * dx + dy * dy >= GHOST_PLAYER_EXCLUSION_RADIUS * GHOST_PLAYER_EXCLUSION_RADIUS) {
      const text =
        GHOST_FRAGMENTS[Math.floor(Math.random() * GHOST_FRAGMENTS.length)];
      const fontSize = 12 + Math.floor(Math.random() * 6);
      fx.ghosts.push({ x, y, text, age: 0, fontSize });
      return;
    }
  }
  // All attempts landed near the player — skip this spawn cycle.
}

function spawnPhantom(fx: ArchiveFx): void {
  const edges: Phantom["edgeKind"][] = ["top", "bottom", "left", "right"];
  const edgeKind = edges[Math.floor(Math.random() * edges.length)];
  let startX = 0;
  let startY = 0;
  let dirX = 0;
  let dirY = 0;
  switch (edgeKind) {
    case "top":
      startX = randBetween(PHANTOM_EDGE_INSET, fx.width - PHANTOM_EDGE_INSET);
      startY = PHANTOM_EDGE_INSET;
      dirX = (Math.random() - 0.5) * 0.6;
      dirY = 1;
      break;
    case "bottom":
      startX = randBetween(PHANTOM_EDGE_INSET, fx.width - PHANTOM_EDGE_INSET);
      startY = fx.height - PHANTOM_EDGE_INSET;
      dirX = (Math.random() - 0.5) * 0.6;
      dirY = -1;
      break;
    case "left":
      startX = PHANTOM_EDGE_INSET;
      startY = randBetween(PHANTOM_EDGE_INSET, fx.height - PHANTOM_EDGE_INSET);
      dirX = 1;
      dirY = (Math.random() - 0.5) * 0.6;
      break;
    case "right":
      startX = fx.width - PHANTOM_EDGE_INSET;
      startY = randBetween(PHANTOM_EDGE_INSET, fx.height - PHANTOM_EDGE_INSET);
      dirX = -1;
      dirY = (Math.random() - 0.5) * 0.6;
      break;
  }
  // Normalise so PHANTOM_WALK_DISTANCE means actual distance.
  const len = Math.hypot(dirX, dirY) || 1;
  dirX /= len;
  dirY /= len;
  fx.phantoms.push({
    edgeKind,
    startX,
    startY,
    dirX,
    dirY,
    age: 0,
    dustParticles: [],
    dustSpawned: false,
  });
}

export function drawArchiveFx(
  ctx: CanvasRenderingContext2D,
  fx: ArchiveFx,
): void {
  // ---- Ghost text ----
  if (fx.ghosts.length > 0) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;
    for (const g of fx.ghosts) {
      let alpha = GHOST_MAX_ALPHA;
      if (g.age < GHOST_FADE_IN_SEC) {
        alpha *= g.age / GHOST_FADE_IN_SEC;
      } else if (g.age > GHOST_FADE_IN_SEC + GHOST_HOLD_SEC) {
        const t = (g.age - GHOST_FADE_IN_SEC - GHOST_HOLD_SEC) / GHOST_FADE_OUT_SEC;
        alpha *= Math.max(0, 1 - t);
      }
      if (alpha <= 0.005) continue;
      ctx.font = `${g.fontSize}px "Space Mono", "Courier New", monospace`;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#7dd3fc";
      ctx.fillText(g.text, g.x, g.y);
    }
    ctx.restore();
  }

  // ---- Phantom visitors ----
  if (fx.phantoms.length > 0) {
    ctx.save();
    ctx.shadowBlur = 0;
    for (const p of fx.phantoms) {
      if (p.age < PHANTOM_WALK_DURATION_SEC) {
        // Walking phase: silhouette translates along (dirX, dirY).
        const t = p.age / PHANTOM_WALK_DURATION_SEC;
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const cx = p.startX + p.dirX * PHANTOM_WALK_DISTANCE * eased;
        const cy = p.startY + p.dirY * PHANTOM_WALK_DISTANCE * eased;
        // Alpha rises then dips toward dissolve.
        let alpha = PHANTOM_MAX_ALPHA;
        if (t < 0.18) alpha *= t / 0.18;
        else if (t > 0.7) alpha *= (1 - t) / 0.3;
        ctx.globalAlpha = alpha;
        drawPhantomSilhouette(ctx, cx, cy);
      }
      // Dissolve dust — fades regardless of walk phase.
      for (const dp of p.dustParticles) {
        const tt = dp.age / dp.lifetime;
        if (tt >= 1) continue;
        const a = (1 - tt) * 0.5;
        ctx.globalAlpha = a;
        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(dp.x - 1, dp.y - 1, 2, 2);
      }
    }
    ctx.restore();
  }
}

function drawPhantomSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  // Head — small ellipse above the body center.
  ctx.fillStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.ellipse(cx, cy - PHANTOM_BODY_H / 2 - PHANTOM_HEAD_R, PHANTOM_HEAD_R, PHANTOM_HEAD_R * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body — vertical capsule.
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    PHANTOM_BODY_W / 2,
    PHANTOM_BODY_H / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
