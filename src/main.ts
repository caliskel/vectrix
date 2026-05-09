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
const menu = createMenu(settings, save, () => resetRun());

// Normalize KeyboardEvent.code so the left/right variant of a modifier
// shares a single binding (Shift, Control, Alt, Meta).
function normalizeCode(code: string): string {
  switch (code) {
    case "ShiftLeft":
    case "ShiftRight":
      return "Shift";
    case "ControlLeft":
    case "ControlRight":
      return "Control";
    case "AltLeft":
    case "AltRight":
      return "Alt";
    case "MetaLeft":
    case "MetaRight":
      return "Meta";
  }
  return code;
}

function isBoundKey(k: string): boolean {
  for (const v of Object.values(settings.bindings)) if (v === k) return true;
  return false;
}

window.addEventListener("keydown", (e) => {
  const code = normalizeCode(e.code);

  if (menu.isCapturing()) {
    e.preventDefault();
    if (code === "Escape") menu.cancelCapture();
    else menu.acceptCapturedKey(code);
    return;
  }

  if (code === settings.bindings.menu1 || code === settings.bindings.menu2) {
    e.preventDefault();
    menu.toggle();
    keys.clear();
    return;
  }

  if (menu.isOpen()) {
    // game input ignored while paused; let the DOM handle keys for inputs
    return;
  }

  keys.add(code);
  if (isBoundKey(code)) e.preventDefault();
});

window.addEventListener("keyup", (e) => {
  keys.delete(normalizeCode(e.code));
});
window.addEventListener("blur", () => keys.clear());

// ACCEL is derived from maxSpeed so the friction-determined natural cap
// stays slightly above maxSpeed and the cap clamp actually engages.
const ACCEL_FACTOR = 9;
const FRICTION = 8.0;
const SPAWN_ANGLE_SPREAD = Math.PI / 3;
const DEATH_PAUSE = 0.5;
const WALL_THICKNESS = 6;
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
let initialFillDone = false;
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
  initialFillDone = false;
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
  const inset = h + WALL_THICKNESS;
  const edge = Math.floor(Math.random() * 4);
  const xRange = viewW - 2 * inset;
  const yRange = viewH - 2 * inset;
  let x = 0;
  let y = 0;
  let nx = 0;
  let ny = 0;
  if (edge === 0) {
    x = inset + Math.random() * xRange;
    y = inset;
    ny = 1;
  } else if (edge === 1) {
    x = viewW - inset;
    y = inset + Math.random() * yRange;
    nx = -1;
  } else if (edge === 2) {
    x = inset + Math.random() * xRange;
    y = viewH - inset;
    ny = -1;
  } else {
    x = inset;
    y = inset + Math.random() * yRange;
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
      const accel = settings.player.maxSpeed * ACCEL_FACTOR;
      player.vx += input.x * accel * dt;
      player.vy += input.y * accel * dt;
      const damp = Math.exp(-FRICTION * dt);
      player.vx *= damp;
      player.vy *= damp;
      const maxSpeed = settings.player.maxSpeed;
      const cap = keys.has(settings.bindings.walk)
        ? maxSpeed * settings.player.walkFactor
        : maxSpeed;
      const sp = Math.hypot(player.vx, player.vy);
      if (sp > cap) {
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
    const minX = WALL_THICKNESS + half;
    const maxX = viewW - WALL_THICKNESS - half;
    const minY = WALL_THICKNESS + half;
    const maxY = viewH - WALL_THICKNESS - half;
    if (player.x < minX) {
      player.x = minX;
      player.vx = 0;
    }
    if (player.y < minY) {
      player.y = minY;
      player.vy = 0;
    }
    if (player.x > maxX) {
      player.x = maxX;
      player.vx = 0;
    }
    if (player.y > maxY) {
      player.y = maxY;
      player.vy = 0;
    }

    if (started) {
      if (
        !initialFillDone &&
        bullets.length >= settings.bullets.maxBullets
      ) {
        initialFillDone = true;
      }
      const baseInterval = settings.bullets.spawnIntervalMs / 1000;
      const filling =
        !initialFillDone && bullets.length < settings.bullets.maxBullets;
      const effInterval = filling ? 0.04 : baseInterval;
      const perTick = filling ? 4 : 1;
      spawnTimer += dt;
      while (
        spawnTimer >= effInterval &&
        bullets.length < settings.bullets.maxBullets
      ) {
        spawnTimer -= effInterval;
        for (
          let i = 0;
          i < perTick && bullets.length < settings.bullets.maxBullets;
          i++
        ) {
          spawnBullet();
        }
      }
    }

    const bh = settings.bullets.size / 2;
    const minBx = WALL_THICKNESS + bh;
    const maxBx = viewW - WALL_THICKNESS - bh;
    const minBy = WALL_THICKNESS + bh;
    const maxBy = viewH - WALL_THICKNESS - bh;
    for (const b of bullets) {
      const px = b.x;
      const py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.bounces) {
        if (b.x < minBx && px >= minBx && b.vx < 0) {
          b.x = minBx;
          b.vx = -b.vx;
        }
        if (b.x > maxBx && px <= maxBx && b.vx > 0) {
          b.x = maxBx;
          b.vx = -b.vx;
        }
        if (b.y < minBy && py >= minBy && b.vy < 0) {
          b.y = minBy;
          b.vy = -b.vy;
        }
        if (b.y > maxBy && py <= maxBy && b.vy > 0) {
          b.y = maxBy;
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

  // arena frame — drawn first so bullets/player visually sit on top of it
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = WALL_THICKNESS;
  ctx.strokeRect(
    WALL_THICKNESS / 2,
    WALL_THICKNESS / 2,
    viewW - WALL_THICKNESS,
    viewH - WALL_THICKNESS,
  );
  ctx.restore();

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
