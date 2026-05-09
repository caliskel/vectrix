import { loadSettings, saveSettings, type Settings } from "./config";
import { createMenu } from "./menu";

const settings: Settings = loadSettings();
const save = () => saveSettings(settings);

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
const menu = createMenu(settings, save);

function isBoundKey(k: string): boolean {
  for (const v of Object.values(settings.bindings)) if (v === k) return true;
  return false;
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();

  if (menu.isCapturing()) {
    e.preventDefault();
    if (k === "escape") menu.cancelCapture();
    else menu.acceptCapturedKey(k);
    return;
  }

  if (k === settings.bindings.menu1 || k === settings.bindings.menu2) {
    e.preventDefault();
    menu.toggle();
    keys.clear();
    return;
  }

  if (menu.isOpen()) {
    // game input ignored while paused; let the DOM handle keys for inputs
    return;
  }

  keys.add(k);
  if (isBoundKey(k)) e.preventDefault();
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});
window.addEventListener("blur", () => keys.clear());

const ACCEL = 2400;
const MAX_SPEED = 440;
const FRICTION = 8.0;
const SPAWN_ANGLE_SPREAD = Math.PI / 3;
const DEATH_PAUSE = 0.5;
const BEST_KEY = "dash-prototype:best";

type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: boolean;
};

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
let spawnTimer = 0;
let runTime = 0;
let started = false;
let best = Number.parseFloat(localStorage.getItem(BEST_KEY) ?? "0") || 0;

type GameState = "alive" | "dying";
let gameState: GameState = "alive";
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
  spawnTimer = 0;
  runTime = 0;
  started = false;
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
  player.iframeTime = settings.dash.iframesMs / 1000;
  const v = dashSpeedNow();
  player.vx = dx * v;
  player.vy = dy * v;
}

function spawnBullet() {
  const sz = settings.bullets.size;
  const h = sz / 2;
  const edge = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;
  let nx = 0;
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
  const speed = settings.bullets.speed;
  const bounces = Math.random() < settings.bullets.bounceChance / 100;

  while (bullets.length >= settings.bullets.maxBullets) bullets.shift();
  bullets.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    bounces,
  });
}

function aabbHit(b: Bullet): boolean {
  const ph = settings.player.size / 2;
  const bh = settings.bullets.size / 2;
  return (
    Math.abs(b.x - player.x) < ph + bh && Math.abs(b.y - player.y) < ph + bh
  );
}

function die() {
  gameState = "dying";
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

  if (menu.isOpen()) {
    // freeze simulation; render so the canvas under the overlay stays consistent
    render();
    requestAnimationFrame(frame);
    return;
  }

  if (gameState === "alive") {
    if (!started) {
      const probe = inputDir();
      if (probe.x !== 0 || probe.y !== 0 || keys.has(settings.bindings.dash)) {
        started = true;
      }
    }
    if (started) runTime += dt;

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
      player.vx += input.x * ACCEL * dt;
      player.vy += input.y * ACCEL * dt;
      const damp = Math.exp(-FRICTION * dt);
      player.vx *= damp;
      player.vy *= damp;
      const cap = keys.has(settings.bindings.walk)
        ? MAX_SPEED * settings.player.walkFactor
        : MAX_SPEED;
      const sp = Math.hypot(player.vx, player.vy);
      if (sp > cap && (input.x !== 0 || input.y !== 0)) {
        const k = cap / sp;
        player.vx *= k;
        player.vy *= k;
      }
    }

    if (player.iframeTime > 0)
      player.iframeTime = Math.max(0, player.iframeTime - dt);
    if (player.cooldown > 0)
      player.cooldown = Math.max(0, player.cooldown - dt);

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const half = settings.player.size / 2;
    if (player.x < half) {
      player.x = half;
      player.vx = 0;
    }
    if (player.y < half) {
      player.y = half;
      player.vy = 0;
    }
    if (player.x > viewW - half) {
      player.x = viewW - half;
      player.vx = 0;
    }
    if (player.y > viewH - half) {
      player.y = viewH - half;
      player.vy = 0;
    }

    if (started) {
      const interval = settings.bullets.spawnIntervalMs / 1000;
      spawnTimer += dt;
      while (spawnTimer >= interval) {
        spawnTimer -= interval;
        spawnBullet();
      }
    }

    const bh = settings.bullets.size / 2;
    for (const b of bullets) {
      const px = b.x;
      const py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.bounces) {
        if (b.x < bh && px >= bh && b.vx < 0) {
          b.x = bh;
          b.vx = -b.vx;
        }
        if (b.x > viewW - bh && px <= viewW - bh && b.vx > 0) {
          b.x = viewW - bh;
          b.vx = -b.vx;
        }
        if (b.y < bh && py >= bh && b.vy < 0) {
          b.y = bh;
          b.vy = -b.vy;
        }
        if (b.y > viewH - bh && py <= viewH - bh && b.vy > 0) {
          b.y = viewH - bh;
          b.vy = -b.vy;
        }
      }
    }

    bullets = bullets.filter(
      (b) => b.x > -60 && b.x < viewW + 60 && b.y > -60 && b.y < viewH + 60,
    );
    while (bullets.length > settings.bullets.maxBullets) bullets.shift();

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
      gameState = "alive";
      resetRun();
    }
  }

  render();
  requestAnimationFrame(frame);
}

function render() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, viewW, viewH);

  const bSize = settings.bullets.size;
  ctx.fillStyle = settings.bullets.color;
  for (const b of bullets) {
    ctx.fillRect(b.x - bSize / 2, b.y - bSize / 2, bSize, bSize);
  }

  const pSize = settings.player.size;

  if (gameState === "alive") {
    const dashing = player.dashTime > 0;
    const invuln = player.iframeTime > 0;
    const cooling = player.cooldown > 0;
    const walking = keys.has(settings.bindings.walk);

    if (dashing) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = settings.player.colorDash;
      const trailLen = pSize * 1.3;
      ctx.fillRect(
        player.x - pSize / 2 - player.dashDirX * trailLen,
        player.y - pSize / 2 - player.dashDirY * trailLen,
        pSize,
        pSize,
      );
      ctx.restore();
    }

    let color: string;
    if (dashing || invuln) color = settings.player.colorDash;
    else if (walking) color = settings.player.colorWalk;
    else color = settings.player.colorIdle;

    ctx.fillStyle = color;
    ctx.fillRect(player.x - pSize / 2, player.y - pSize / 2, pSize, pSize);

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
  } else {
    const k = dyingTime / DEATH_PAUSE;
    ctx.save();
    ctx.globalAlpha = 0.45 * k;
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();

    const burst = (1 - k) * pSize * 2.2;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.strokeStyle = "#fca5a5";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      player.x - pSize / 2 - burst / 2,
      player.y - pSize / 2 - burst / 2,
      pSize + burst,
      pSize + burst,
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
