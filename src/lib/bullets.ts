export const BULLET_TRAIL = 5;

export type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: boolean;
  nearMissed: boolean;
  dashedThroughId: number; // last dash session id this bullet was awarded for
  /** Set once this bullet has entered the player's flinch radius — keeps
   *  a single bullet from triggering more than one flinch as it crosses. */
  flinchTriggered: boolean;
  // circular trail buffer (pre-allocated, no per-frame allocation)
  trailX: Float32Array;
  trailY: Float32Array;
  trailIdx: number; // next write slot
  trailCount: number; // valid samples, capped at BULLET_TRAIL
};

// === Bullet pool ===
// V8 handles small-object allocation well, but each Bullet drags two
// Float32Array(5) buffers + their ArrayBuffers — the per-allocation
// overhead is real once Sentinel radial bursts (12 bullets) + mine
// detonations (6) + four turrets are all firing. Pooling reuses the
// Float32Arrays too, so a bullet's full memory footprint is reused
// instead of churned through GC.
//
// Callers should acquire via `acquireBullet(...)` and return via
// `releaseBullet(b)` when the bullet is filtered out. The old
// `makeBullet(...)` is kept as the internal allocator (and as a
// fallback for any code not yet migrated) — behaviour is identical
// from the caller's side.
const bulletPool: Bullet[] = [];

export function acquireBullet(
  x: number,
  y: number,
  vx: number,
  vy: number,
  bounces: boolean,
): Bullet {
  const recycled = bulletPool.pop();
  if (recycled) {
    recycled.x = x;
    recycled.y = y;
    recycled.vx = vx;
    recycled.vy = vy;
    recycled.bounces = bounces;
    recycled.nearMissed = false;
    recycled.dashedThroughId = -1;
    recycled.flinchTriggered = false;
    recycled.trailIdx = 0;
    recycled.trailCount = 0;
    // Trail buffers are intentionally NOT zeroed — trailCount = 0
    // already gates reads, so stale samples never get drawn.
    return recycled;
  }
  return makeBullet(x, y, vx, vy, bounces);
}

export function releaseBullet(b: Bullet): void {
  bulletPool.push(b);
}

/** In-place compaction: keeps every bullet for which `keep(b)` returns
 *  true, releases the rest back to the pool, and trims the array. Use
 *  in place of `bullets = bullets.filter(...)` to avoid the
 *  per-frame array allocation AND to recycle dead bullets. */
export function compactBullets(
  bullets: Bullet[],
  keep: (b: Bullet) => boolean,
): void {
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < bullets.length; readIdx++) {
    const b = bullets[readIdx];
    if (keep(b)) {
      bullets[writeIdx++] = b;
    } else {
      releaseBullet(b);
    }
  }
  bullets.length = writeIdx;
}

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
    flinchTriggered: false,
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
