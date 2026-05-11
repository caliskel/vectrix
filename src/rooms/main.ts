import { start } from "./rooms-game";
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
