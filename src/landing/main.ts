import { audio } from "../lib/audio";
import {
  DEFAULT_PLAYER_PROFILE,
  type PlayerProfile,
  createPlayer,
  drawPlayerEye,
  loadPlayerProfile,
  savePlayerProfile,
  updateEye,
} from "../lib/player";
import {
  DEFAULT_KEYBINDS,
  KEYBIND_ACTIONS,
  KEYBIND_LABELS,
  formatKeybindLabel,
  isReservedCode,
  loadKeybinds,
  saveKeybinds,
  type Keybind,
  type KeybindAction,
  type KeybindProfile,
  type KeybindSlot,
} from "../lib/keybinds";
import { startMenuBg } from "./menu-bg";

const PREVIEW_PLAYER_SIZE = 110;
const PREVIEW_CANVAS_SIZE = 300;
const FAKE_DASH_DURATION_SEC = 0.12;
const EYE_PREVIEW_SIZE = 200;
const EYE_PREVIEW_PLAYER_SIZE = 64;

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

// === Tutorial gate ===
//
// ROOMS button stays locked until the tutorial is completed; TUTORIAL
// button changes its desc text after completion.
function applyTutorialState(): void {
  const completed =
    localStorage.getItem("dash-proto:tutorial-completed") === "true";
  const tutDesc = document.getElementById("btn-tutorial-desc");
  if (tutDesc) {
    tutDesc.textContent = completed ? "Replay tutorial" : "Learn the basics";
  }
  const roomsBtn = document.getElementById("btn-rooms");
  const roomsDesc = document.getElementById("btn-rooms-desc");
  if (roomsBtn && roomsDesc) {
    if (!completed) {
      roomsBtn.classList.add("locked");
      roomsBtn.setAttribute("aria-disabled", "true");
      roomsDesc.textContent = "🔒 Complete tutorial first";
    } else {
      roomsBtn.classList.remove("locked");
      roomsBtn.removeAttribute("aria-disabled");
      roomsDesc.textContent = "Story mode";
    }
  }
}
applyTutorialState();
window.addEventListener("focus", applyTutorialState);
window.addEventListener("pageshow", applyTutorialState);
window.addEventListener("storage", applyTutorialState);

// === Animated menu background ===
const bgCanvas = need<HTMLCanvasElement>("#menu-bg-canvas");
startMenuBg(bgCanvas, {
  // Audio crackle layered on every big-glitch flash. Quiet on its own,
  // but the visual flash + the static makes the moment feel like a
  // real CRT artifact, not just a styled effect.
  onBigGlitch: () => audio.play.uiStatic(),
});

// === Menu music — same flow as before, eager start + gesture fallback ===
audio.setMusicTrack(
  "menu",
  encodeURI(import.meta.env.BASE_URL + "audio/menu/Neon Drift Menu.mp3"),
);
audio.playMusic("menu", 2.0);
audio.init();
const kickMenuMusic = () => {
  audio.init();
  audio.playMusic("menu", 2.0);
};
window.addEventListener("keydown", kickMenuMusic, { once: false });
window.addEventListener("click", kickMenuMusic, { once: false });
window.addEventListener("touchstart", kickMenuMusic, { once: false });

// === Logo entrance + glitch ===
//
// Letter-by-letter entrance via CSS keyframe + per-letter animation
// delay. Glitch effect (RGB split + horizontal shift) triggered
// periodically from JS — toggling the `.glitch` class on #logo
// activates the ::before/::after pseudo-elements baked into CSS.
const logoEl = document.getElementById("logo");
const logoLetterEls: HTMLElement[] = [];
if (logoEl) {
  logoLetterEls.push(
    ...logoEl.querySelectorAll<HTMLElement>(".logo-letter"),
  );
  logoLetterEls.forEach((el, i) => {
    el.style.animationDelay = `${i * 80}ms`;
  });
  scheduleLogoGlitch();
  // Letters finish their cascade entrance at index*80 + 280 ms. The
  // last letter (idx 6) lands at ~840 ms; wait an extra 600 ms before
  // the first flicker so the entrance reads cleanly.
  window.setTimeout(scheduleLetterFlicker, 1500);
}

function scheduleLogoGlitch(): void {
  // 10–25 s between micro-glitches; ~1 in 6 chance for a longer one.
  const delay = 10000 + Math.random() * 15000;
  window.setTimeout(() => {
    if (!logoEl) return;
    const isLong = Math.random() < 0.15;
    logoEl.classList.add("glitch");
    window.setTimeout(
      () => {
        logoEl.classList.remove("glitch");
        scheduleLogoGlitch();
      },
      isLong ? 200 : 60,
    );
  }, delay);
}

// === Per-letter neon flicker ===
//
// Picks a random VECTRIX letter every 1.5–4.5 s and runs a flicker
// sequence on it via inline `style.opacity`. Opacity affects the
// rendered text AND the text-shadow glow proportionally, so dimming
// reads as "this bulb is losing power." Two modes — most are short
// blinks, ~25 % are sustained brownouts where the letter goes mostly
// dark for ~1–2 s, then stutters back to full.
//
// Inline opacity wins over the CSS `.logo` breathing and the
// `letter-enter` keyframe (which has long since completed by the
// time the first flicker fires), so the sequences don't fight other
// animations. Final step clears the inline value so CSS takes over
// again until the next flicker.

const FLICKER_SHORT_SEQ: { o: number; at: number }[] = [
  { o: 0.2, at: 0 },
  { o: 1, at: 40 },
  { o: 0.1, at: 90 },
  { o: 1, at: 140 },
  { o: 0.45, at: 200 },
  { o: 1, at: 270 },
];
const FLICKER_LONG_DIM = 0.12;
const FLICKER_LONG_REIGNITE: { o: number; at: number }[] = [
  // Tail-end stutter that reignites the bulb. Offsets are added to
  // the brown-out hold's end timestamp inside runLetterFlicker.
  { o: 1, at: 40 },
  { o: 0.2, at: 90 },
  { o: 1, at: 150 },
  { o: 0.35, at: 220 },
  { o: 1, at: 300 },
];

function scheduleLetterFlicker(): void {
  const delay = 1500 + Math.random() * 3000;
  window.setTimeout(() => {
    if (logoLetterEls.length === 0) {
      scheduleLetterFlicker();
      return;
    }
    const letter =
      logoLetterEls[Math.floor(Math.random() * logoLetterEls.length)];
    const isLong = Math.random() < 0.25;
    if (isLong) runLongFlicker(letter);
    else runShortFlicker(letter);
    scheduleLetterFlicker();
  }, delay);
}

// Set opacity with !important. The `letter-enter` CSS animation runs
// with `animation-fill-mode: forwards`, which keeps `opacity: 1` at
// the "Animations" cascade origin — that origin outranks regular
// author-inline styles, so a plain `letter.style.opacity = "0.2"`
// is silently ignored. !important inline lands at the "important
// author" origin which beats the animation.
function setOpacityImportant(letter: HTMLElement, value: number): void {
  letter.style.setProperty("opacity", String(value), "important");
}
function clearOpacity(letter: HTMLElement): void {
  letter.style.removeProperty("opacity");
}

function runShortFlicker(letter: HTMLElement): void {
  for (const step of FLICKER_SHORT_SEQ) {
    window.setTimeout(() => {
      setOpacityImportant(letter, step.o);
    }, step.at);
  }
  const total =
    FLICKER_SHORT_SEQ[FLICKER_SHORT_SEQ.length - 1].at + 80;
  window.setTimeout(() => {
    clearOpacity(letter);
  }, total);
}

function runLongFlicker(letter: HTMLElement): void {
  const holdMs = 800 + Math.random() * 1400;
  // Drop to brown-out immediately.
  setOpacityImportant(letter, FLICKER_LONG_DIM);
  // Then the reignite stutter after the hold.
  for (const step of FLICKER_LONG_REIGNITE) {
    window.setTimeout(() => {
      setOpacityImportant(letter, step.o);
    }, holdMs + step.at);
  }
  const total =
    holdMs + FLICKER_LONG_REIGNITE[FLICKER_LONG_REIGNITE.length - 1].at + 100;
  window.setTimeout(() => {
    clearOpacity(letter);
  }, total);
}

// === Button entrance + hover/click sounds + flash ===
//
// Cascade slide-in from bottom — 100 ms between buttons. The `.entered`
// class swaps in the keyframe; without it the buttons stay at their
// pre-animation state (opacity 0 / translateY 20px) defined inline in
// the stylesheet so we never get the FOUC of fully-visible buttons.
const buttonEls = Array.from(
  document.querySelectorAll<HTMLElement>(".menu-btn"),
);
buttonEls.forEach((btn, i) => {
  btn.style.animationDelay = `${1100 + i * 100}ms`;
  btn.classList.add("entered");

  btn.addEventListener("mouseenter", () => {
    if (btn.classList.contains("locked")) return;
    audio.play.uiHover();
  });
  btn.addEventListener("focus", () => {
    if (btn.classList.contains("locked")) return;
    audio.play.uiHover();
  });
  btn.addEventListener("click", (e) => {
    if (btn.classList.contains("locked")) {
      e.preventDefault();
      return;
    }
    audio.play.uiClick();
    // Cyan flash overlay. For navigation buttons we delay the actual
    // page nav by 120 ms so the flash gets to play; data-overlay
    // buttons open their overlay immediately, the flash plays on top.
    btn.classList.remove("clicked");
    // Force reflow so re-adding the class restarts the animation.
    void btn.offsetWidth;
    btn.classList.add("clicked");
    const isAnchor = btn instanceof HTMLAnchorElement;
    if (isAnchor) {
      e.preventDefault();
      const href = btn.getAttribute("href");
      if (href) {
        window.setTimeout(() => {
          window.location.href = href;
        }, 120);
      }
    }
  });
});

// === Eye preview that tracks the cursor ===
//
// Separate from the Player-overlay preview canvas; lives in the main
// menu and uses pointer position relative to the canvas as a virtual
// "threat" so the pupil tilts toward the mouse via the existing
// updateEye() logic.
const eyeCanvas = need<HTMLCanvasElement>("#eye-preview-canvas");
const eyePlayer = createPlayer();
eyePlayer.x = EYE_PREVIEW_SIZE / 2;
eyePlayer.y = EYE_PREVIEW_SIZE / 2;
let mouseX = -9999;
let mouseY = -9999;
let mouseSeen = false;
window.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  mouseSeen = true;
});
(function initEyeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  eyeCanvas.width = EYE_PREVIEW_SIZE * dpr;
  eyeCanvas.height = EYE_PREVIEW_SIZE * dpr;
  eyeCanvas.style.width = `${EYE_PREVIEW_SIZE}px`;
  eyeCanvas.style.height = `${EYE_PREVIEW_SIZE}px`;
  const ctx = eyeCanvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
})();

let eyeLast = performance.now();
let eyeProfile = loadPlayerProfile();
// React to a Save in the Player overlay so the menu preview updates
// in real time without a reload.
window.addEventListener("storage", () => {
  eyeProfile = loadPlayerProfile();
});

function eyeFrame(now: number) {
  let dt = (now - eyeLast) / 1000;
  eyeLast = now;
  if (dt > 0.05) dt = 0.05;

  // Convert global mouse coords → eye-canvas local coords. If the
  // pointer hasn't moved yet OR is far from the canvas, fall back to
  // idle-look (null threat) so the eye breathes instead of pinning.
  const rect = eyeCanvas.getBoundingClientRect();
  const localX = mouseX - rect.left;
  const localY = mouseY - rect.top;
  const inRange =
    mouseSeen &&
    localX > -200 &&
    localX < rect.width + 200 &&
    localY > -200 &&
    localY < rect.height + 200;
  const threat = inRange
    ? { x: localX, y: localY }
    : null;

  updateEye(eyePlayer, dt, {
    threat,
    size: EYE_PREVIEW_PLAYER_SIZE,
    dashDurationSec: FAKE_DASH_DURATION_SEC,
  });

  const ctx = eyeCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, EYE_PREVIEW_SIZE, EYE_PREVIEW_SIZE);
    drawPlayerEye(ctx, eyePlayer, EYE_PREVIEW_PLAYER_SIZE, {
      ringColor: eyeProfile.outerRing,
      glowColor: eyeProfile.outerRing,
      pupilColor: eyeProfile.pupil,
      irisColor: eyeProfile.iris,
      ghostColor: "#00e5ff",
      dashDurationSec: FAKE_DASH_DURATION_SEC,
    });
  }
  requestAnimationFrame(eyeFrame);
}
requestAnimationFrame(eyeFrame);

// === Overlays (unchanged behavior from previous design) ===
type OverlayName = "player" | "controls" | "about";

function setOverlay(name: OverlayName | null) {
  if (activeOverlay) {
    if (activeOverlay.id === "overlay-player") stopPreview();
    if (activeOverlay.id === "overlay-controls") cancelControlsCapture();
    activeOverlay.setAttribute("hidden", "");
    activeOverlay = null;
  }
  if (!name) return;
  const el = document.getElementById(`overlay-${name}`);
  if (!el) return;
  el.removeAttribute("hidden");
  activeOverlay = el;
  if (name === "player") onPlayerOpen();
  if (name === "controls") onControlsOpen();
  if (name === "about") onAboutOpen();
}

document.querySelectorAll<HTMLElement>("[data-overlay]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const target = el.dataset.overlay as OverlayName | undefined;
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
  // Refresh the menu eye-preview right away — the storage event
  // doesn't fire for same-tab writes.
  eyeProfile = profile;
  setOverlay(null);
});

function onPlayerOpen() {
  applyProfileToPickers(loadPlayerProfile());
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

  const ctx = previewCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, PREVIEW_CANVAS_SIZE, PREVIEW_CANVAS_SIZE);
    drawPlayerEye(ctx, previewPlayer, PREVIEW_PLAYER_SIZE, {
      ringColor: pickerOuter.value,
      glowColor: pickerOuter.value,
      pupilColor: pickerPupil.value,
      irisColor: pickerIris.value,
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

// === Controls overlay ===
const controlsTableEl = document.getElementById(
  "controls-table",
) as HTMLDivElement | null;
const controlsResetBtn = document.getElementById(
  "controls-reset",
) as HTMLButtonElement | null;
const controlsToastEl = document.getElementById(
  "controls-toast",
) as HTMLDivElement | null;

type CaptureTarget = { action: KeybindAction; slot: "primary" | "secondary" };

let currentKeybinds: KeybindProfile = loadKeybinds();
let capturing: CaptureTarget | null = null;
let captureCell: HTMLButtonElement | null = null;
let toastTimer: number | null = null;

function showControlsToast(message: string): void {
  if (!controlsToastEl) return;
  controlsToastEl.textContent = message;
  controlsToastEl.classList.add("visible");
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    controlsToastEl.classList.remove("visible");
    toastTimer = null;
  }, 1500);
}

function renderControlsTable(): void {
  if (!controlsTableEl) return;
  Array.from(controlsTableEl.children).forEach((child) => {
    if (!child.classList.contains("controls-row-header")) {
      controlsTableEl.removeChild(child);
    }
  });
  for (const action of KEYBIND_ACTIONS) {
    const slot = currentKeybinds[action];
    const labelEl = document.createElement("div");
    labelEl.className = "controls-action";
    labelEl.textContent = KEYBIND_LABELS[action];
    controlsTableEl.appendChild(labelEl);
    controlsTableEl.appendChild(buildCell(action, "primary", slot.primary));
    controlsTableEl.appendChild(buildCell(action, "secondary", slot.secondary));
  }
}

function buildCell(
  action: KeybindAction,
  which: "primary" | "secondary",
  code: Keybind | null,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "controls-cell";
  btn.type = "button";
  btn.dataset.action = action;
  btn.dataset.which = which;
  btn.textContent = formatKeybindLabel(code);
  btn.addEventListener("click", () => beginCapture(action, which, btn));
  return btn;
}

function beginCapture(
  action: KeybindAction,
  which: "primary" | "secondary",
  cell: HTMLButtonElement,
): void {
  if (capturing) cancelControlsCapture();
  capturing = { action, slot: which };
  captureCell = cell;
  cell.classList.add("capturing");
  cell.textContent = "press a key…";
}

function cancelControlsCapture(): void {
  if (captureCell && capturing) {
    captureCell.classList.remove("capturing");
    const slot = currentKeybinds[capturing.action];
    const code = capturing.slot === "primary" ? slot.primary : slot.secondary;
    captureCell.textContent = formatKeybindLabel(code);
  }
  capturing = null;
  captureCell = null;
}

function applyCapture(code: string): void {
  if (!capturing) return;
  if (isReservedCode(code)) {
    showControlsToast("RESERVED KEY");
    return;
  }
  const target = capturing;
  const slot: KeybindSlot = currentKeybinds[target.action];
  for (const otherAction of KEYBIND_ACTIONS) {
    if (otherAction === target.action) continue;
    const other = currentKeybinds[otherAction];
    if (other.primary === code) {
      showControlsToast(
        `${formatKeybindLabel(code)} ALREADY ON ${KEYBIND_LABELS[otherAction]}`,
      );
      return;
    }
    if (other.secondary === code) {
      other.secondary = null;
    }
  }
  if (target.slot === "primary") {
    if (slot.secondary === code) slot.secondary = null;
    slot.primary = code;
  } else {
    if (slot.primary === code) {
      slot.secondary = null;
    } else {
      slot.secondary = code;
    }
  }
  saveKeybinds(currentKeybinds);
  cancelControlsCapture();
  renderControlsTable();
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === "Escape") {
      cancelControlsCapture();
      return;
    }
    applyCapture(e.code);
  },
  true,
);

function onControlsOpen(): void {
  currentKeybinds = loadKeybinds();
  renderControlsTable();
}

if (controlsResetBtn) {
  controlsResetBtn.addEventListener("click", () => {
    currentKeybinds = JSON.parse(JSON.stringify(DEFAULT_KEYBINDS));
    saveKeybinds(currentKeybinds);
    cancelControlsCapture();
    renderControlsTable();
  });
}

// === About overlay ===
const aboutBodyEl = document.getElementById(
  "about-body",
) as HTMLDivElement | null;

function onAboutOpen(): void {
  if (!aboutBodyEl) return;
  const profile = loadKeybinds();
  const lines: string[] = [];
  lines.push("VECTRIX — neon bullet-hell prototype.");
  lines.push("");
  lines.push("MODES");
  lines.push("  TUTORIAL — onboarding rooms");
  lines.push("  ROOMS    — campaign / story");
  lines.push("  SANDBOX  — endless practice / score attack");
  lines.push("");
  lines.push("CONTROLS");
  lines.push(`  Move    ${describeKeyPair(profile, "moveUp")} / ${describeKeyPair(profile, "moveLeft")} / ${describeKeyPair(profile, "moveDown")} / ${describeKeyPair(profile, "moveRight")}`);
  lines.push(`  Dash    ${describeKeyPair(profile, "dash")}`);
  lines.push(`  Walk    ${describeKeyPair(profile, "walk")}  (hold to slow down)`);
  lines.push("  Pause   Esc or Tab");
  lines.push("  Dev     F1 (rooms / tutorial only)");
  lines.push("");
  lines.push("Rebind keys on the CONTROLS page; reset there to defaults.");
  aboutBodyEl.textContent = lines.join("\n");
}

function describeKeyPair(profile: KeybindProfile, action: KeybindAction): string {
  const slot = profile[action];
  const primary = formatKeybindLabel(slot.primary);
  if (slot.secondary === null) return primary;
  return `${primary} / ${formatKeybindLabel(slot.secondary)}`;
}
