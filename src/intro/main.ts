import {
  createIntroState,
  drawIntro,
  trySkipIntro,
  updateIntro,
} from "./intro-cinematic";
import { audio } from "../lib/audio";

// Audio init — needs a user gesture to start the AudioContext on
// strict-autoplay browsers. Without this, drawNarration's per-char
// typewriter tick never fires because the chain isn't built yet.
audio.init();
const kickAudio = (): void => {
  audio.init();
};
window.addEventListener("keydown", kickAudio, { once: false });
window.addEventListener("pointerdown", kickAudio, { once: false });
window.addEventListener("click", kickAudio, { once: false });
window.addEventListener("touchstart", kickAudio, { once: false });

const canvas = document.getElementById("app") as HTMLCanvasElement | null;
if (!canvas) {
  // No canvas → just go straight to tutorial so the user isn't stuck.
  redirectToTutorial();
} else {
  start(canvas);
}

const INTRO_FLAG_KEY = "dash-proto:has-seen-intro";

function redirectToTutorial(): void {
  // Set the flag before navigation so a refresh-loop can't reopen the
  // intro. Wrapped in try/catch to survive privacy-mode storage quirks.
  try {
    localStorage.setItem(INTRO_FLAG_KEY, "true");
  } catch {
    /* ignore */
  }
  // Vite's GitHub-Pages base path is /vectrix/, so relative redirect
  // works for both dev (/vectrix/intro.html → /vectrix/tutorial.html)
  // and the deploy.
  window.location.href = "tutorial.html";
}

function start(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    redirectToTutorial();
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

  const state = createIntroState();
  let lastTime = performance.now();
  let redirected = false;

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    updateIntro(state, dt);
    drawIntro(ctx!, state, viewW, viewH, dpr);
    drawSkipHint(ctx!, state, viewW, viewH);
    if (state.done && !redirected) {
      redirected = true;
      redirectToTutorial();
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Skip on key press or click after the minimum watch window.
  const onSkip = () => {
    trySkipIntro(state);
  };
  window.addEventListener("keydown", onSkip);
  window.addEventListener("pointerdown", onSkip);
}

function drawSkipHint(
  ctx: CanvasRenderingContext2D,
  state: { time: number; phase: string; done: boolean },
  viewW: number,
  viewH: number,
): void {
  // Show "PRESS ANY KEY TO SKIP" once the player has watched the
  // first couple of seconds, until the fadeout phase starts. Quiet
  // bottom-right placement so it doesn't fight the cinematic.
  if (state.done) return;
  if (state.phase === "fadeout") return;
  if (state.time < 2.5) return;
  // Fade in over half a second.
  const alpha = Math.min(0.55, (state.time - 2.5) / 0.5 * 0.55);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#7d8590";
  ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("PRESS ANY KEY TO SKIP", viewW - 24, viewH - 22);
  ctx.restore();
}
