// Pre-rendered turret sprites — body + barrel baked once with shadow
// glow, then blitted via drawImage instead of paying for per-frame
// drawNeon shadow passes. Same trick as bullet-sprite.ts but for the
// most common enemy: in Room 3 (4 turrets) the live drawNeon path was
// firing 24 shadowBlur ops / frame just for turret bodies.
//
// Three sprites:
//  - body: outer ring + inner ring + core, all static — never rebuilt
//    after first paint.
//  - barrel (normal): triangle pointing along +X at the turret's local
//    frame, drawn with the resting glow intensity (blur 18 / 7).
//  - barrel (telegraph): same triangle, stronger glow (blur 30 / 12) +
//    full opacity, swapped in during the 0.3 s window before each shot.
//
// Each sprite has an explicit anchor exposed as a const so the live
// turret can translate(x, y).rotate(aim) then drawImage at the right
// offset to align the sprite's "turret centre" with the world position.

import { PALETTE } from "../palette";

const RADIUS = 25;
const BARREL_LEN = 28;
const BARREL_WIDTH = 12;
const COLOR = PALETTE.playerDash;

const BODY_GLOW_PADDING = 36; // covers blur 22 + a bit of headroom
const BODY_DIM = (RADIUS + BODY_GLOW_PADDING) * 2;
export const BODY_ANCHOR = BODY_DIM / 2;

const BARREL_GLOW_PADDING = 36; // covers telegraph blur 30
const BARREL_DIM_X = BARREL_GLOW_PADDING + RADIUS + BARREL_LEN + BARREL_GLOW_PADDING;
const BARREL_DIM_Y = BARREL_GLOW_PADDING * 2 + BARREL_WIDTH;
export const BARREL_ANCHOR_X = BARREL_GLOW_PADDING;
export const BARREL_ANCHOR_Y = BARREL_DIM_Y / 2;

let bodySprite: HTMLCanvasElement | null = null;
let barrelNormalSprite: HTMLCanvasElement | null = null;
let barrelTelegraphSprite: HTMLCanvasElement | null = null;

function buildBodySprite(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = BODY_DIM;
  c.height = BODY_DIM;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const cx = BODY_DIM / 2;
  const cy = BODY_DIM / 2;

  // Body double-ring with layered glow (mirrors drawNeon strong+soft).
  ctx.strokeStyle = COLOR;
  ctx.shadowColor = COLOR;
  for (const blur of [22, 8]) {
    ctx.shadowBlur = blur;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS - 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Core dot, also layered.
  ctx.fillStyle = COLOR;
  for (const blur of [14, 5]) {
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function buildBarrelSprite(telegraph: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = BARREL_DIM_X;
  c.height = BARREL_DIM_Y;
  const ctx = c.getContext("2d");
  if (!ctx) return c;

  const blurStrong = telegraph ? 30 : 18;
  const blurSoft = telegraph ? 12 : 7;
  const ox = BARREL_ANCHOR_X;
  const oy = BARREL_ANCHOR_Y;

  ctx.fillStyle = COLOR;
  ctx.globalAlpha = telegraph ? 1.0 : 0.78;
  ctx.shadowColor = COLOR;
  for (const blur of [blurStrong, blurSoft]) {
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.moveTo(ox + RADIUS, oy - BARREL_WIDTH / 2);
    ctx.lineTo(ox + RADIUS + BARREL_LEN, oy);
    ctx.lineTo(ox + RADIUS, oy + BARREL_WIDTH / 2);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

export function getTurretBodySprite(): HTMLCanvasElement {
  if (!bodySprite) bodySprite = buildBodySprite();
  return bodySprite;
}

export function getTurretBarrelSprite(telegraph: boolean): HTMLCanvasElement {
  if (telegraph) {
    if (!barrelTelegraphSprite) barrelTelegraphSprite = buildBarrelSprite(true);
    return barrelTelegraphSprite;
  }
  if (!barrelNormalSprite) barrelNormalSprite = buildBarrelSprite(false);
  return barrelNormalSprite;
}
