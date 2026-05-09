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
const pickerDash = need<HTMLInputElement>("#picker-dash");
const swatchOuter = need<HTMLElement>("#swatch-outer");
const swatchIris = need<HTMLElement>("#swatch-iris");
const swatchPupil = need<HTMLElement>("#swatch-pupil");
const swatchDash = need<HTMLElement>("#swatch-dash");
const resetBtn = need<HTMLButtonElement>("#profile-reset");
const saveBtn = need<HTMLButtonElement>("#profile-save");

// Dash-demo state — every DEMO_INTERVAL the preview eye flashes its
// dash color for DEMO_DURATION so the user can see the configured
// dash color in context.
const DEMO_INTERVAL = 3.0;
const DEMO_DURATION = 0.2;
let demoTime = 0;
let demoCooldown = DEMO_INTERVAL;

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
  pickerDash.value = profile.dashColor;
  refreshSwatches();
}

function refreshSwatches() {
  swatchOuter.style.background = pickerOuter.value;
  swatchIris.style.background = pickerIris.value;
  swatchPupil.style.background = pickerPupil.value;
  swatchDash.style.background = pickerDash.value;
}

[pickerOuter, pickerIris, pickerPupil, pickerDash].forEach((p) =>
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
    dashColor: pickerDash.value,
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
  // start the dash-demo with a small initial cooldown so it triggers
  // soon after open, not on the first frame
  demoTime = 0;
  demoCooldown = 1.2;
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

function previewFrame(now: number) {
  let dt = (now - previewLast) / 1000;
  previewLast = now;
  if (dt > 0.05) dt = 0.05;

  updateEye(previewPlayer, dt, {
    threat: null,
    size: PREVIEW_PLAYER_SIZE,
    dashDurationSec: FAKE_DASH_DURATION_SEC,
  });

  // tick the dash-demo schedule — a brief color flash so the user can see
  // the dash color in context without simulating actual movement
  if (demoTime > 0) {
    demoTime = Math.max(0, demoTime - dt);
  } else {
    demoCooldown -= dt;
    if (demoCooldown <= 0) {
      demoTime = DEMO_DURATION;
      demoCooldown = DEMO_INTERVAL;
    }
  }
  const inDemo = demoTime > 0;
  const ringColor = inDemo ? pickerDash.value : pickerOuter.value;
  const pupilColor = inDemo ? pickerDash.value : pickerPupil.value;

  const ctx = previewCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);
    drawPlayerEye(ctx, previewPlayer, PREVIEW_PLAYER_SIZE, {
      ringColor,
      glowColor: ringColor,
      pupilColor,
      irisColor: pickerIris.value,
      ghostColor: pickerDash.value,
      dashDurationSec: FAKE_DASH_DURATION_SEC,
    });
  }

  if (activeOverlay && activeOverlay.id === "overlay-player") {
    previewRafId = requestAnimationFrame(previewFrame);
  } else {
    previewRafId = null;
  }
}
