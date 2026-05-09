export const BULLET_TRAIL = 5;

export type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: boolean;
  nearMissed: boolean;
  dashedThroughId: number; // last dash session id this bullet was awarded for
  // circular trail buffer (pre-allocated, no per-frame allocation)
  trailX: Float32Array;
  trailY: Float32Array;
  trailIdx: number; // next write slot
  trailCount: number; // valid samples, capped at BULLET_TRAIL
};

export function makeBullet(
  x: number,
  y: number,
  vx: number,
  vy: number,
  bounces: boolean,
): Bullet {
  return {
    x,
    y,
    vx,
    vy,
    bounces,
    nearMissed: false,
    dashedThroughId: -1,
    trailX: new Float32Array(BULLET_TRAIL),
    trailY: new Float32Array(BULLET_TRAIL),
    trailIdx: 0,
    trailCount: 0,
  };
}

export function pushTrailSample(b: Bullet): void {
  b.trailX[b.trailIdx] = b.x;
  b.trailY[b.trailIdx] = b.y;
  b.trailIdx = (b.trailIdx + 1) % BULLET_TRAIL;
  if (b.trailCount < BULLET_TRAIL) b.trailCount++;
}
