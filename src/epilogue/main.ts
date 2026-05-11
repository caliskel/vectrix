import {
  createEpilogueState,
  drawEpilogue,
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
    updateEpilogue(state, dt);
    drawEpilogue(ctx!, state, viewW, viewH, dpr);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Input handling: during void scene any input skips to the room
  // scene; once we're in the room scene, any input returns to main
  // menu. A 600 ms grace window after entering the room scene gates
  // the menu nav so a stray key from the cinematic skip doesn't
  // immediately bounce out.
  const ROOM_INPUT_GRACE_SEC = 0.6;
  function handleInput(): void {
    if (state.phase === "roompresent") {
      if (state.profanityStart < ROOM_INPUT_GRACE_SEC) return;
      returnToMenu();
      return;
    }
    trySkipEpilogue(state);
  }
  window.addEventListener("keydown", handleInput);
  window.addEventListener("pointerdown", handleInput);
}
