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
  if (k === " " || k === "w" || k === "a" || k === "s" || k === "d") {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});
window.addEventListener("blur", () => keys.clear());

const ACCEL = 2400;          // px/s^2 while pressing a direction
const MAX_SPEED = 360;       // px/s soft cap for normal movement
const FRICTION = 8.0;        // exponential damping per second
const DASH_SPEED = 1300;     // px/s during dash
const DASH_DURATION = 0.12;  // 120 ms
const DASH_IFRAMES = 0.15;   // slightly longer than dash
const DASH_COOLDOWN = 0.40;  // 400 ms after dash ends
const PLAYER_SIZE = 28;

const player = {
  x: viewW / 2,
  y: viewH / 2,
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

let lastTime = performance.now();

function frame(now: number) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.05) dt = 0.05; // clamp big spikes (tab switch)

  if (keys.has(" ")) {
    tryStartDash();
    keys.delete(" "); // require re-press
  }

  if (player.dashTime > 0) {
    player.dashTime -= dt;
    player.vx = player.dashDirX * DASH_SPEED;
    player.vy = player.dashDirY * DASH_SPEED;
    if (player.dashTime <= 0) {
      player.dashTime = 0;
      player.cooldown = DASH_COOLDOWN;
      // bleed off some of the dash speed so exit feels snappy but not abrupt
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

    const speed = Math.hypot(player.vx, player.vy);
    if (speed > MAX_SPEED && (input.x !== 0 || input.y !== 0)) {
      const k = MAX_SPEED / speed;
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

  render();
  requestAnimationFrame(frame);
}

function render() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, viewW, viewH);

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

  let color: string;
  if (dashing) color = "#22d3ee";
  else if (invuln) color = "#a5f3fc";
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
}

requestAnimationFrame((t) => {
  lastTime = t;
  requestAnimationFrame(frame);
});
