// Camera follow with viewport clamping. Used by rooms wider/taller
// than the on-screen letterbox so the player stays roughly centered
// while the world scrolls. Small rooms (width/height ≤ viewport) opt
// out via Room.useCamera = false; updateCamera is then never called.

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
 * Lerp the camera toward (target - viewport/2), clamped so it can't
 * scroll past the world edges. Default lerp 0.08 gives a soft follow
 * that doesn't whiplash on quick player turns.
 */
export function updateCamera(
  camera: Camera,
  targetWorldX: number,
  targetWorldY: number,
  viewportW: number,
  viewportH: number,
  bounds: WorldBounds,
  lerp = 0.08,
): void {
  let desiredX = targetWorldX - viewportW / 2;
  let desiredY = targetWorldY - viewportH / 2;
  const maxX = bounds.maxX - viewportW;
  const maxY = bounds.maxY - viewportH;
  if (desiredX < bounds.minX) desiredX = bounds.minX;
  if (desiredX > maxX) desiredX = maxX;
  if (desiredY < bounds.minY) desiredY = bounds.minY;
  if (desiredY > maxY) desiredY = maxY;
  // World smaller than viewport → center it (clamp can flip if maxX <
  // minX); guard so we don't oscillate around a negative range.
  if (maxX < bounds.minX) desiredX = (bounds.minX + bounds.maxX - viewportW) / 2;
  if (maxY < bounds.minY) desiredY = (bounds.minY + bounds.maxY - viewportH) / 2;
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
