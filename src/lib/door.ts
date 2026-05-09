import { drawNeon } from "./neon";
import { PALETTE } from "./palette";

export type DoorState = "closed" | "open";

export type Door = {
  x: number; // center
  y: number;
  w: number;
  h: number;
  state: DoorState;
  pulse: number; // accumulator for the open-state pulsing animation
  // when open, transitioning briefly suppresses re-trigger so the player
  // doesn't bounce between rooms
};

export function makeDoor(
  x: number,
  y: number,
  w: number,
  h: number,
  initial: DoorState = "closed",
): Door {
  return { x, y, w, h, state: initial, pulse: 0 };
}

export function playerOverlapsDoor(
  door: Door,
  px: number,
  py: number,
  half: number,
): boolean {
  const dx1 = door.x - door.w / 2;
  const dx2 = door.x + door.w / 2;
  const dy1 = door.y - door.h / 2;
  const dy2 = door.y + door.h / 2;
  return (
    px + half > dx1 && px - half < dx2 && py + half > dy1 && py - half < dy2
  );
}

export function drawDoor(ctx: CanvasRenderingContext2D, door: Door): void {
  const left = door.x - door.w / 2;
  const top = door.y - door.h / 2;

  if (door.state === "closed") {
    ctx.save();
    ctx.fillStyle = PALETTE.bgGrid;
    ctx.fillRect(left, top, door.w, door.h);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 1, top + 1, door.w - 2, door.h - 2);
    drawNeon(
      ctx,
      () => {
        ctx.strokeStyle = PALETTE.bullet;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(left + 18, top + 18);
        ctx.lineTo(left + door.w - 18, top + door.h - 18);
        ctx.moveTo(left + door.w - 18, top + 18);
        ctx.lineTo(left + 18, top + door.h - 18);
        ctx.stroke();
      },
      PALETTE.bullet,
      18,
      6,
    );
    ctx.restore();
  } else {
    // pulsing arrow → toward next room
    const phase = (Math.sin(door.pulse * 5) + 1) / 2; // 0..1
    const alpha = 0.55 + 0.4 * phase;
    drawNeon(
      ctx,
      () => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = PALETTE.pickupHP;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const cx = door.x;
        const cy = door.y;
        const sz = 32;
        ctx.beginPath();
        ctx.moveTo(cx - sz * 0.5, cy - sz * 0.55);
        ctx.lineTo(cx + sz * 0.6, cy);
        ctx.lineTo(cx - sz * 0.5, cy + sz * 0.55);
        ctx.stroke();
        ctx.restore();
      },
      PALETTE.pickupHP,
      24,
      8,
    );
  }
}
