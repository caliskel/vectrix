// Camera that keeps the player locked to the centre of the viewport
// in every room, regardless of world size. The world scrolls around
// the player even on small arenas (where parts of the playfield will
// drift past the viewport edges). `bounds` is kept on the signature
// for callers but no longer clamps — request was for an "always
// centred" feel rather than the previous edge-stick behaviour.

export type Camera = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
};

export type WorldBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function createCamera(): Camera {
  return { x: 0, y: 0, targetX: 0, targetY: 0 };
}

/**
 * Lerp the camera so the player target sits exactly in the centre of
 * the viewport. The `bounds` arg is accepted for backwards
 * compatibility but is ignored — there is no edge clamp, so the
 * player stays centred even when the world is smaller than the
 * viewport (parts of the arena scroll off-screen as the player moves).
 * Default lerp 0.08 = soft follow without whiplash on quick turns.
 */
export function updateCamera(
  camera: Camera,
  targetWorldX: number,
  targetWorldY: number,
  viewportW: number,
  viewportH: number,
  _bounds: WorldBounds,
  lerp = 0.08,
): void {
  const desiredX = targetWorldX - viewportW / 2;
  const desiredY = targetWorldY - viewportH / 2;
  camera.targetX = desiredX;
  camera.targetY = desiredY;
  camera.x += (desiredX - camera.x) * lerp;
  camera.y += (desiredY - camera.y) * lerp;
}

/** Snap camera to its target instantly (used at room transitions). */
export function snapCamera(camera: Camera): void {
  camera.x = camera.targetX;
  camera.y = camera.targetY;
}
