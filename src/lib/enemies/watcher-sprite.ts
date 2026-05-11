// Pre-rendered watcher body sprite — outer neon ring + three iris
// discs + gloss highlight. Everything that doesn't move with the
// pupil is baked once. Pupil (dot + catchlight) stays live so the
// gaze still tracks the player every frame.
//
// Replaces one drawNeon (blur 8 + 3 = 2 shadow ops) plus 5 fill arcs
// and a translucent ellipse with one drawImage. Per-frame savings are
// smaller than turret/hunter (watcher counts are 1 per room max),
// but the path was still ~7 ctx ops per frame on every render.

const WATCHER_RADIUS = 30;
const OUTER_RING_W = 2.5;
const IRIS_OUTER_R = 24;
const IRIS_MID_R = 19;
const IRIS_INNER_R = 14;
const IRIS_OUTER_COLOR = "#ff1744";
const IRIS_MID_COLOR = "#c8002a";
const IRIS_INNER_COLOR = "#6b0014";
const GLOSS_OFFSET_Y = -16;
const GLOSS_W = 12;
const GLOSS_H = 5;
const GLOSS_ALPHA = 0.2;
const OUTER_GLOW_STRONG = 8;
const OUTER_GLOW_SOFT = 3;

const PADDING = OUTER_GLOW_STRONG * 2 + 4;
const DIM = (WATCHER_RADIUS + PADDING) * 2;
export const WATCHER_SPRITE_ANCHOR = DIM / 2;

let sprite: HTMLCanvasElement | null = null;

function build(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = DIM;
  c.height = DIM;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const cx = DIM / 2;
  const cy = DIM / 2;

  // Outer ring — neon stroke with layered glow.
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = OUTER_RING_W;
  ctx.shadowColor = "#f8fafc";
  for (const blur of [OUTER_GLOW_STRONG, OUTER_GLOW_SOFT]) {
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.arc(cx, cy, WATCHER_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Iris stack — three opaque discs, no shadow.
  ctx.shadowBlur = 0;
  ctx.fillStyle = IRIS_OUTER_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, IRIS_OUTER_R, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = IRIS_MID_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, IRIS_MID_R, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = IRIS_INNER_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, IRIS_INNER_R, 0, Math.PI * 2);
  ctx.fill();

  // Gloss highlight ellipse.
  ctx.globalAlpha = GLOSS_ALPHA;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(cx, cy + GLOSS_OFFSET_Y, GLOSS_W, GLOSS_H, 0, 0, Math.PI * 2);
  ctx.fill();

  return c;
}

export function getWatcherSprite(): HTMLCanvasElement {
  if (!sprite) sprite = build();
  return sprite;
}
