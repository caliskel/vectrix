import { start } from "./tutorial-game";
import { audio } from "../lib/audio";

// Aggressive first-gesture audio kick. Browsers require a user
// gesture to unlock the AudioContext, and same-origin navigation
// (intro → tutorial) doesn't transfer that gesture state. Listening
// on every plausible first-interaction event so ANY input the player
// makes — key, click, tap, touch — wakes up the audio chain.
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
