import { start } from "./tutorial-game";

const canvas = document.getElementById("app") as HTMLCanvasElement | null;
if (canvas) start(canvas);
