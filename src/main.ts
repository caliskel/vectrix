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
}
resize();
window.addEventListener("resize", resize);

const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === "w" || k === "a" || k === "s" || k === "d") {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});
window.addEventListener("blur", () => keys.clear());

const ACCEL = 2400;
const MAX_SPEED = 440;
const WALK_FACTOR = 0.3;
const FRICTION = 8.0;
const DASH_SPEED = 950;
const DASH_DURATION = 0.09;
const DASH_IFRAMES = 0.11;
const DASH_COOLDOWN = 0.40;
const PLAYER_SIZE = 28;

const BULLET_SIZE = 6;
const BULLET_SPEED_MIN = 170;
const BULLET_SPEED_MAX = 380;
const BULLETS_PER_SPAWN = 2;
const SPAWN_ANGLE_SPREAD = Math.PI / 3; // ±60° from inward perpendicular
const BOUNCE_CHANCE = 0.8;
const SPAWN_INTERVAL_INITIAL = 0.8;
const SPAWN_INTERVAL_MIN = 0.2;
const RAMP_DURATION = 10;
const DEATH_PAUSE = 0.5;

const BEST_KEY = "dash-prototype:best";

type Bullet = { x: number; y: number; vx: number; vy: number };

const player = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  facingX: 0,
  facingY: -1,
  dashTime: 0,
  iframeTime: 0,
  cooldown: 0,
  dashDirX: 0,
  dashDirY: 0,
};

let bullets: Bullet[] = [];
let spawnInterval = SPAWN_INTERVAL_INITIAL;
let spawnTimer = 0;
let runTime = 0;
let started = false;
let best = Number.parseFloat(localStorage.getItem(BEST_KEY) ?? "0") || 0;

type State = "alive" | "dying";
let state: State = "alive";
let dyingTime = 0;

function resetRun() {
  player.x = viewW / 2;
  player.y = viewH / 2;
  player.vx = 0;
  player.vy = 0;
  player.facingX = 0;
  player.facingY = -1;
  player.dashTime = 0;
  player.iframeTime = 0;
  player.cooldown = 0;
  bullets = [];
  spawnInterval = SPAWN_INTERVAL_INITIAL;
  spawnTimer = 0;
  runTime = 0;
  started = false;
}
resetRun();

function inputDir(): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (keys.has("a") || keys.has("arrowleft")) x -= 1;
  if (keys.has("d") || keys.has("arrowright")) x += 1;
  if (keys.has("w") || keys.has("arrowup")) y -= 1;
  if (keys.has("s") || keys.has("arrowdown")) y += 1;
  const len = Math.hypot(x, y);
  if (len > 0) {
    x /= len;
    y /= len;
  }
  return { x, y };
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
  player.dashTime = DASH_DURATION;
  player.iframeTime = DASH_IFRAMES;
  player.vx = dx * DASH_SPEED;
  player.vy = dy * DASH_SPEED;
}

function spawnBullet() {
  const edge = Math.floor(Math.random() * 4);
  const h = BULLET_SIZE / 2;
  let x = 0;
  let y = 0;
  let nx = 0; // inward perpendicular (unit)
  let ny = 0;
  if (edge === 0) {
    x = Math.random() * viewW;
    y = h;
    ny = 1;
  } else if (edge === 1) {
    x = viewW - h;
    y = Math.random() * viewH;
    nx = -1;
  } else if (edge === 2) {
    x = Math.random() * viewW;
    y = viewH - h;
    ny = -1;
  } else {
    x = h;
    y = Math.random() * viewH;
    nx = 1;
  }
  const baseAngle = Math.atan2(ny, nx);
  const offset = (Math.random() * 2 - 1) * SPAWN_ANGLE_SPREAD;
  const angle = baseAngle + offset;
  const speed = BULLET_SPEED_MIN + Math.random() * (BULLET_SPEED_MAX - BULLET_SPEED_MIN);
  bullets.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  });
}

function updateRampDifficulty() {
  const t = Math.min(runTime / RAMP_DURATION, 1);
  const eased = t * t; // ease-in: calm start, sharper ramp toward the end
  spawnInterval =
    SPAWN_INTERVAL_INITIAL + (SPAWN_INTERVAL_MIN - SPAWN_INTERVAL_INITIAL) * eased;
}

function aabbHit(b: Bullet): boolean {
  const ph = PLAYER_SIZE / 2;
  const bh = BULLET_SIZE / 2;
  return Math.abs(b.x - player.x) < ph + bh && Math.abs(b.y - player.y) < ph + bh;
}

function die() {
  state = "dying";
  dyingTime = DEATH_PAUSE;
  if (runTime > best) {
    best = runTime;
    localStorage.setItem(BEST_KEY, String(best));
  }
}

let lastTime = performance.now();

function frame(now: number) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.05) dt = 0.05;

  if (state === "alive") {
    if (!started) {
      const probe = inputDir();
      if (probe.x !== 0 || probe.y !== 0 || keys.has("x")) started = true;
    }
    if (started) {
      runTime += dt;
      updateRampDifficulty();
    }

    if (keys.has("x")) {
      tryStartDash();
      keys.delete("x");
    }

    if (player.dashTime > 0) {
      player.dashTime -= dt;
      player.vx = player.dashDirX * DASH_SPEED;
      player.vy = player.dashDirY * DASH_SPEED;
      if (player.dashTime <= 0) {
        player.dashTime = 0;
        player.cooldown = DASH_COOLDOWN;
        player.vx *= 0.35;
        player.vy *= 0.35;
      }
    } else {
      const input = inputDir();
      if (input.x !== 0 || input.y !== 0) {
        player.facingX = input.x;
        player.facingY = input.y;
      }
      player.vx += input.x * ACCEL * dt;
      player.vy += input.y * ACCEL * dt;
      const damp = Math.exp(-FRICTION * dt);
      player.vx *= damp;
      player.vy *= damp;
      const cap = keys.has("shift") ? MAX_SPEED * WALK_FACTOR : MAX_SPEED;
      const sp = Math.hypot(player.vx, player.vy);
      if (sp > cap && (input.x !== 0 || input.y !== 0)) {
        const k = cap / sp;
        player.vx *= k;
        player.vy *= k;
      }
    }

    if (player.iframeTime > 0) player.iframeTime = Math.max(0, player.iframeTime - dt);
    if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt);

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const half = PLAYER_SIZE / 2;
    if (player.x < half) { player.x = half; player.vx = 0; }
    if (player.y < half) { player.y = half; player.vy = 0; }
    if (player.x > viewW - half) { player.x = viewW - half; player.vx = 0; }
    if (player.y > viewH - half) { player.y = viewH - half; player.vy = 0; }

    if (started) {
      spawnTimer += dt;
      while (spawnTimer >= spawnInterval) {
        spawnTimer -= spawnInterval;
        for (let i = 0; i < BULLETS_PER_SPAWN; i++) spawnBullet();
      }
    }

    const bh = BULLET_SIZE / 2;
    for (const b of bullets) {
      const px = b.x;
      const py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // rising-edge bounce: only roll on the frame the bullet crosses the edge
      if (b.x < bh && px >= bh && b.vx < 0 && Math.random() < BOUNCE_CHANCE) {
        b.x = bh;
        b.vx = -b.vx;
      }
      if (b.x > viewW - bh && px <= viewW - bh && b.vx > 0 && Math.random() < BOUNCE_CHANCE) {
        b.x = viewW - bh;
        b.vx = -b.vx;
      }
      if (b.y < bh && py >= bh && b.vy < 0 && Math.random() < BOUNCE_CHANCE) {
        b.y = bh;
        b.vy = -b.vy;
      }
      if (b.y > viewH - bh && py <= viewH - bh && b.vy > 0 && Math.random() < BOUNCE_CHANCE) {
        b.y = viewH - bh;
        b.vy = -b.vy;
      }
    }

    bullets = bullets.filter(
      (b) => b.x > -60 && b.x < viewW + 60 && b.y > -60 && b.y < viewH + 60,
    );

    if (player.iframeTime <= 0) {
      for (const b of bullets) {
        if (aabbHit(b)) {
          die();
          break;
        }
      }
    }
  } else {
    dyingTime -= dt;
    if (dyingTime <= 0) {
      state = "alive";
      resetRun();
    }
  }

  render();
  requestAnimationFrame(frame);
}

function render() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.fillStyle = "#ef4444";
  for (const b of bullets) {
    ctx.fillRect(b.x - BULLET_SIZE / 2, b.y - BULLET_SIZE / 2, BULLET_SIZE, BULLET_SIZE);
  }

  if (state === "alive") {
    const dashing = player.dashTime > 0;
    const invuln = player.iframeTime > 0;
    const cooling = player.cooldown > 0;

    if (dashing) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#22d3ee";
      const trailLen = 36;
      ctx.fillRect(
        player.x - PLAYER_SIZE / 2 - player.dashDirX * trailLen,
        player.y - PLAYER_SIZE / 2 - player.dashDirY * trailLen,
        PLAYER_SIZE,
        PLAYER_SIZE,
      );
      ctx.restore();
    }

    const walking = keys.has("shift");
    let color: string;
    if (dashing) color = "#22d3ee";
    else if (invuln) color = "#a5f3fc";
    else if (walking) color = "#fbbf24";
    else if (cooling) color = "#9ca3af";
    else color = "#ffffff";

    ctx.fillStyle = color;
    ctx.fillRect(player.x - PLAYER_SIZE / 2, player.y - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);

    if (cooling) {
      const r = PLAYER_SIZE * 0.9;
      const t = 1 - player.cooldown / DASH_COOLDOWN;
      ctx.strokeStyle = "rgba(156,163,175,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      ctx.stroke();
    }
  } else {
    const k = dyingTime / DEATH_PAUSE;
    ctx.save();
    ctx.globalAlpha = 0.45 * k;
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();

    const burst = (1 - k) * PLAYER_SIZE * 2.2;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.strokeStyle = "#fca5a5";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      player.x - PLAYER_SIZE / 2 - burst / 2,
      player.y - PLAYER_SIZE / 2 - burst / 2,
      PLAYER_SIZE + burst,
      PLAYER_SIZE + burst,
    );
    ctx.restore();
  }

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`Time: ${runTime.toFixed(1)}s`, viewW / 2, 16);
  ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#9ca3af";
  ctx.fillText(`Best: ${best.toFixed(1)}s`, viewW / 2, 44);
  ctx.restore();
}

requestAnimationFrame((t) => {
  lastTime = t;
  requestAnimationFrame(frame);
});
