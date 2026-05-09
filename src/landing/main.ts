import { drawNeon } from "../lib/neon";
import {
  DEFAULT_PLAYER_PROFILE,
  type PlayerProfile,
  createPlayer,
  drawPlayerEye,
  loadPlayerProfile,
  savePlayerProfile,
  updateEye,
} from "../lib/player";

const PREVIEW_PLAYER_SIZE = 110;
const PREVIEW_CANVAS_SIZE = 300;
const FAKE_DASH_DURATION_SEC = 0.12;

function $<T extends HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}
function need<T extends HTMLElement>(sel: string): T {
  const el = $(sel);
  if (!el) throw new Error(`landing: missing ${sel}`);
  return el as T;
}

let activeOverlay: HTMLElement | null = null;
let previewRafId: number | null = null;
let previewLast = performance.now();
const previewPlayer = createPlayer();
previewPlayer.x = PREVIEW_CANVAS_SIZE / 2;
previewPlayer.y = PREVIEW_CANVAS_SIZE / 2;

function setOverlay(name: "player" | "about" | null) {
  if (activeOverlay) {
    if (activeOverlay.id === "overlay-player") stopPreview();
    activeOverlay.setAttribute("hidden", "");
    activeOverlay = null;
  }
  if (!name) return;
  const el = document.getElementById(`overlay-${name}`);
  if (!el) return;
  el.removeAttribute("hidden");
  activeOverlay = el;
  if (name === "player") onPlayerOpen();
}

document.querySelectorAll<HTMLElement>("[data-overlay]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const target = el.dataset.overlay as "player" | "about" | undefined;
    if (target) setOverlay(target);
  });
});
document.querySelectorAll<HTMLElement>("[data-close]").forEach((el) => {
  el.addEventListener("click", () => setOverlay(null));
});

window.addEventListener("keydown", (e) => {
  if (!activeOverlay) return;
  if (e.key === "Escape") {
    e.preventDefault();
    setOverlay(null);
    return;
  }
  if (e.key === "Tab") {
    // overlays don't need focus traversal — keep tab from leaking through
    e.preventDefault();
  }
});

// === Player overlay wiring ===
const previewCanvas = need<HTMLCanvasElement>("#preview-canvas");
const pickerOuter = need<HTMLInputElement>("#picker-outer");
const pickerIris = need<HTMLInputElement>("#picker-iris");
const pickerPupil = need<HTMLInputElement>("#picker-pupil");
const pickerDashParticles = need<HTMLInputElement>("#picker-dash-particles");
const swatchOuter = need<HTMLElement>("#swatch-outer");
const swatchIris = need<HTMLElement>("#swatch-iris");
const swatchPupil = need<HTMLElement>("#swatch-pupil");
const swatchDashParticles = need<HTMLElement>("#swatch-dash-particles");
const resetBtn = need<HTMLButtonElement>("#profile-reset");
const saveBtn = need<HTMLButtonElement>("#profile-save");

// Pseudo-dash: every DEMO_INTERVAL the preview eye darts a few px to the
// right and back over PSEUDO_DASH_DURATION, leaving a trail of sparks
// in the chosen DASH PARTICLES color. The eye itself doesn't change
// color — that's the whole point: showing the particle color in
// context without recoloring the orb.
const DEMO_INTERVAL = 3.0;
const PSEUDO_DASH_DURATION = 0.2;
const PSEUDO_DASH_OFFSET_PX = 28;
let pseudoDashElapsed = -1; // -1 when idle, otherwise counts up to PSEUDO_DASH_DURATION
let demoCooldown = 1.2;

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  initialSize: number;
  age: number;
  lifetime: number;
  color: string;
};
const sparks: Spark[] = [];

(function initPreviewCanvas() {
  const dpr = window.devicePixelRatio || 1;
  previewCanvas.width = PREVIEW_CANVAS_SIZE * dpr;
  previewCanvas.height = PREVIEW_CANVAS_SIZE * dpr;
  previewCanvas.style.width = `${PREVIEW_CANVAS_SIZE}px`;
  previewCanvas.style.height = `${PREVIEW_CANVAS_SIZE}px`;
  const ctx = previewCanvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
})();

function applyProfileToPickers(profile: PlayerProfile) {
  pickerOuter.value = profile.outerRing;
  pickerIris.value = profile.iris;
  pickerPupil.value = profile.pupil;
  pickerDashParticles.value = profile.dashParticles;
  refreshSwatches();
}

function refreshSwatches() {
  swatchOuter.style.background = pickerOuter.value;
  swatchIris.style.background = pickerIris.value;
  swatchPupil.style.background = pickerPupil.value;
  swatchDashParticles.style.background = pickerDashParticles.value;
}

[pickerOuter, pickerIris, pickerPupil, pickerDashParticles].forEach((p) =>
  p.addEventListener("input", refreshSwatches),
);

resetBtn.addEventListener("click", () => {
  applyProfileToPickers(DEFAULT_PLAYER_PROFILE);
});

saveBtn.addEventListener("click", () => {
  const profile: PlayerProfile = {
    outerRing: pickerOuter.value,
    iris: pickerIris.value,
    pupil: pickerPupil.value,
    dashParticles: pickerDashParticles.value,
  };
  savePlayerProfile(profile);
  setOverlay(null);
});

function onPlayerOpen() {
  applyProfileToPickers(loadPlayerProfile());
  // restart the preview player so it doesn't carry over a half-finished
  // blink or pupil offset from a previous open
  previewPlayer.pupilOffsetX = 0;
  previewPlayer.pupilOffsetY = 0;
  previewPlayer.shakeTime = 0;
  previewPlayer.dilateTime = 0;
  previewPlayer.blinkActive = false;
  previewPlayer.blinkElapsed = 0;
  previewPlayer.blinkCooldown = 2 + Math.random() * 2;
  previewPlayer.idleTargetX = 0;
  previewPlayer.idleTargetY = 0;
  previewPlayer.nextIdleSwitchAt = 0;
  previewPlayer.lastSawDangerAt = Number.NEGATIVE_INFINITY;
  previewPlayer.dashGhosts = [];
  previewPlayer.ghostSpawnTimer = 0;
  previewPlayer.isClosing = false;
  previewPlayer.closeAmount = 0;
  previewPlayer.x = PREVIEW_CANVAS_SIZE / 2;
  previewPlayer.y = PREVIEW_CANVAS_SIZE / 2;
  // start the pseudo-dash with a small initial cooldown so it triggers
  // soon after open, not on the first frame
  pseudoDashElapsed = -1;
  demoCooldown = 1.2;
  sparks.length = 0;
  previewLast = performance.now();
  if (previewRafId === null) {
    previewRafId = requestAnimationFrame(previewFrame);
  }
}

function stopPreview() {
  if (previewRafId !== null) {
    cancelAnimationFrame(previewRafId);
    previewRafId = null;
  }
}

function spawnSpark(color: string) {
  // emit "behind" the eye — leftward fan since the pseudo-dash always
  // travels +x. Slight upward drift for a floaty trail look.
  const angle = Math.PI + (Math.random() - 0.5) * 1.0;
  const speed = 80 + Math.random() * 100;
  const sz = 3 + Math.random() * 3;
  sparks.push({
    x: previewPlayer.x,
    y: previewPlayer.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 18,
    size: sz,
    initialSize: sz,
    age: 0,
    lifetime: 0.4 + Math.random() * 0.2,
    color,
  });
}

function updateSparks(dt: number) {
  if (sparks.length === 0) return;
  for (const s of sparks) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const k = Math.pow(0.95, dt * 60);
    s.vx *= k;
    s.vy *= k;
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    if (sparks[i].age >= sparks[i].lifetime) sparks.splice(i, 1);
  }
}

function drawSparks(ctx: CanvasRenderingContext2D) {
  for (const s of sparks) {
    const t = s.age / s.lifetime;
    const alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
    const sz = Math.max(0.5, s.initialSize * (1 - t));
    ctx.save();
    ctx.globalAlpha = alpha;
    drawNeon(
      ctx,
      () => {
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
      },
      s.color,
      8,
      3,
    );
    ctx.restore();
  }
}

function previewFrame(now: number) {
  let dt = (now - previewLast) / 1000;
  previewLast = now;
  if (dt > 0.05) dt = 0.05;

  updateEye(previewPlayer, dt, {
    threat: null,
    size: PREVIEW_PLAYER_SIZE,
    dashDurationSec: FAKE_DASH_DURATION_SEC,
  });

  // pseudo-dash: brief sideways nudge with sparks trailing behind,
  // recurring on a cooldown. Eye colors stay on the picker idle values
  // — only the sparks are the user's chosen DASH PARTICLES color.
  if (pseudoDashElapsed >= 0) {
    pseudoDashElapsed += dt;
    const t = pseudoDashElapsed / PSEUDO_DASH_DURATION;
    if (t >= 1) {
      pseudoDashElapsed = -1;
      previewPlayer.x = PREVIEW_CANVAS_SIZE / 2;
    } else {
      // 0 → +offset → 0 over the duration (half-sine arc)
      const wave = Math.sin(t * Math.PI);
      previewPlayer.x = PREVIEW_CANVAS_SIZE / 2 + PSEUDO_DASH_OFFSET_PX * wave;
      // emit ~70 % of frames so the trail reads as a stream, not a wall
      if (Math.random() < 0.7) spawnSpark(pickerDashParticles.value);
    }
  } else {
    demoCooldown -= dt;
    if (demoCooldown <= 0) {
      pseudoDashElapsed = 0;
      demoCooldown = DEMO_INTERVAL;
    }
  }
  updateSparks(dt);

  const ctx = previewCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);
    drawSparks(ctx);
    drawPlayerEye(ctx, previewPlayer, PREVIEW_PLAYER_SIZE, {
      ringColor: pickerOuter.value,
      glowColor: pickerOuter.value,
      pupilColor: pickerPupil.value,
      irisColor: pickerIris.value,
      // dash eye stays canonical cyan in-game; preview keeps it consistent
      ghostColor: "#00e5ff",
      dashDurationSec: FAKE_DASH_DURATION_SEC,
    });
  }

  if (activeOverlay && activeOverlay.id === "overlay-player") {
    previewRafId = requestAnimationFrame(previewFrame);
  } else {
    previewRafId = null;
  }
}
