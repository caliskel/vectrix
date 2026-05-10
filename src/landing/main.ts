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

// Reflect tutorial-completed state in the menu — ROOMS card stays
// locked until the player has been through the tutorial, and the
// tutorial card swaps its blurb to "Replay" once it's done.
function applyTutorialState(): void {
  const completed =
    localStorage.getItem("dash-proto:tutorial-completed") === "true";
  const tutDesc = document.getElementById("link-tutorial-desc");
  if (tutDesc) {
    tutDesc.textContent = completed ? "Replay tutorial" : "Learn the basics";
  }
  const roomsLink = document.getElementById("link-rooms");
  const roomsDesc = document.getElementById("link-rooms-desc");
  if (roomsLink && roomsDesc) {
    if (!completed) {
      roomsLink.classList.add("locked");
      roomsLink.setAttribute("aria-disabled", "true");
      roomsDesc.textContent = "🔒 Complete tutorial first";
    } else {
      roomsLink.classList.remove("locked");
      roomsLink.removeAttribute("aria-disabled");
      roomsDesc.textContent = "Story mode";
    }
  }
}
applyTutorialState();
// Re-read the flag whenever the user comes back to the tab — covers
// returning from /tutorial.html via in-page navigation, the bfcache
// pageshow event, and the cross-tab `storage` event when localStorage
// is mutated elsewhere. Without this the menu would stay locked even
// after the player completes the tutorial in another tab.
window.addEventListener("focus", applyTutorialState);
window.addEventListener("pageshow", applyTutorialState);
window.addEventListener("storage", applyTutorialState);

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
  // Controls overlay capture mode owns its own keydown — it
  // installs a higher-priority listener while capturing so we
  // never see those events here.
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
      // dash eye stays canonical cyan in-game; the preview never enters
      // a dash state but keep this consistent in case the caller does
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

// === Controls overlay wiring ===
//
// Six action rows (movement / dash / walk) × two slots (primary +
// secondary). Click any cell → capture mode: the next non-reserved
// keydown writes that code into the slot and auto-saves. Esc inside
// capture cancels without changing the binding; Esc outside capture
// closes the overlay.
//
// Reserved system keys (Escape / Tab / F1) are rejected during
// capture; primary slots can never be set to null (the action would
// have no key); secondary slots can be cleared by binding them to
// the same value as primary, which the capture path then forces to
// null. Duplicate cleanup: binding a key already used by another
// slot clears that other slot first (primary clears can't, so the
// new owner wins).

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
  // Tear the previous rows out (keeping the header row untouched
  // since it's marked with a static class).
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

  // If this code is already in any slot, evict it from there. For
  // a primary that "loses" its only code we'd leave the action
  // empty — disallow.
  for (const otherAction of KEYBIND_ACTIONS) {
    if (otherAction === target.action) continue;
    const other = currentKeybinds[otherAction];
    if (other.primary === code) {
      // Would orphan another action's primary — forbid the bind.
      showControlsToast(
        `${formatKeybindLabel(code)} ALREADY ON ${KEYBIND_LABELS[otherAction]}`,
      );
      return;
    }
    if (other.secondary === code) {
      other.secondary = null;
    }
  }
  // Inside the same action: setting one slot to the value of the
  // other clears the duplicate.
  if (target.slot === "primary") {
    if (slot.secondary === code) slot.secondary = null;
    slot.primary = code;
  } else {
    // Secondary equal to primary → clear it (the player's way of
    // emptying a secondary cell).
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

// Capture-mode keydown intercept. Installed once; gates on
// `capturing !== null` so it's idle most of the time.
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
  // Capture phase so we beat the higher-up listener that would
  // close the overlay on Escape.
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
//
// Static cheat sheet + dynamic controls list pulled from the
// current keybind profile. The body rebuilds on every open so a
// rebind in Controls shows up immediately when the player opens
// About after.

const aboutBodyEl = document.getElementById(
  "about-body",
) as HTMLDivElement | null;

function onAboutOpen(): void {
  if (!aboutBodyEl) return;
  const profile = loadKeybinds();
  const lines: string[] = [];
  lines.push("DASH — neon bullet-hell prototype.");
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
