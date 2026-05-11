import {
  createEpilogueState,
  drawEpilogue,
  epilogueClearKeys,
  epilogueIsInRoom,
  epilogueOnKeyDown,
  epilogueOnKeyUp,
  trySkipEpilogue,
  updateEpilogue,
} from "./epilogue-cinematic";
import { audio } from "../lib/audio";

audio.init();
const kickAudio = (): void => {
  audio.init();
};
window.addEventListener("keydown", kickAudio);
window.addEventListener("pointerdown", kickAudio);
window.addEventListener("click", kickAudio);
window.addEventListener("touchstart", kickAudio);

const canvas = document.getElementById("app") as HTMLCanvasElement | null;
if (canvas) start(canvas);

function returnToMenu(): void {
  window.location.href = import.meta.env.BASE_URL;
}

function start(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    returnToMenu();
    return;
  }

  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  let dpr = window.devicePixelRatio || 1;

  function resize(): void {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(viewW * dpr));
    canvas.height = Math.max(1, Math.floor(viewH * dpr));
    canvas.style.width = `${viewW}px`;
    canvas.style.height = `${viewH}px`;
  }
  resize();
  window.addEventListener("resize", resize);

  const state = createEpilogueState();
  let lastTime = performance.now();

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    updateEpilogue(state, dt, ctx!, viewW, viewH);
    drawEpilogue(ctx!, state, viewW, viewH, dpr);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Input model: during the void cinematic, any key/click skips
  // straight to the room scene. Once we're in the room, WASD/Shift
  // drive the hero, and Enter/Escape return to the main menu. The
  // gameplay keybinds (loadKeybinds) drive movement, so a rebound
  // player's keys work here too without further wiring.
  window.addEventListener("keydown", (e) => {
    if (!epilogueIsInRoom(state)) {
      // Still in the void scene — any keydown is "skip cinematic".
      trySkipEpilogue(state);
      return;
    }
    // Menu nav — gated to keys that don't collide with movement.
    if (e.code === "Enter" || e.code === "Escape") {
      e.preventDefault();
      returnToMenu();
      return;
    }
    epilogueOnKeyDown(state, e.code);
  });
  window.addEventListener("keyup", (e) => {
    epilogueOnKeyUp(state, e.code);
  });
  window.addEventListener("blur", () => epilogueClearKeys(state));
  window.addEventListener("pointerdown", () => {
    // Pointer click only acts as a skip during the cinematic. In the
    // room scene, clicks do nothing — menu nav is keyboard-only so
    // an accidental mouse press doesn't bounce the player out.
    if (!epilogueIsInRoom(state)) trySkipEpilogue(state);
  });
}
