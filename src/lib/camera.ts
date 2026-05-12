// Camera that keeps the player locked to the centre of the viewport
// in every room, regardless of world size. The world scrolls around
// the player even on small arenas (where parts of the playfield will
// drift past the viewport edges). `bounds` is kept on the signature
// for callers but no longer clamps — request was for an "always
// centred" feel rather than the previous edge-stick behaviour.

export type CameraMode = "follow" | "edit";

export type Camera = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  // Editor-only state. In `follow` mode (default) `updateCamera`
  // lerps toward the player. In `edit` mode it short-circuits so
  // `panCamera` / `setCameraZoom` are the only authority over the
  // viewport — the editor controls position directly.
  mode: CameraMode;
  // World-space zoom factor applied inside the world transform.
  // 1.0 = identity; clamped to [0.5, 2.0] by `setCameraZoom`.
  // Survives `updateCamera` calls — only `restartRun` resets it.
  zoom: number;
};

export type WorldBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const CAMERA_ZOOM_MIN = 0.5;
export const CAMERA_ZOOM_MAX = 2.0;

export function createCamera(): Camera {
  return { x: 0, y: 0, targetX: 0, targetY: 0, mode: "follow", zoom: 1 };
}

/**
 * Lerp the camera so the player target sits exactly in the centre of
 * the viewport. The `bounds` arg is accepted for backwards
 * compatibility but is ignored — there is no edge clamp, so the
 * player stays centred even when the world is smaller than the
 * viewport (parts of the arena scroll off-screen as the player moves).
 * Default lerp 0.08 = soft follow without whiplash on quick turns.
 *
 * In `edit` mode this is a no-op — the editor owns camera state
 * directly through panCamera / setCameraZoom.
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
  if (camera.mode === "edit") return;
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

/**
 * Switch camera mode. Entering `edit` freezes the camera at its
 * current position so the follow lerp doesn't fight pan input on
 * the very next frame; leaving `edit` rearms target tracking by
 * latching the current position as the new target (the next
 * `updateCamera` call will lerp from there).
 */
export function setCameraMode(camera: Camera, mode: CameraMode): void {
  if (camera.mode === mode) return;
  camera.mode = mode;
  if (mode === "edit") {
    camera.targetX = camera.x;
    camera.targetY = camera.y;
  } else {
    // Re-arm follow at current position; updateCamera will rewrite
    // target next frame from the player's actual coords.
    camera.targetX = camera.x;
    camera.targetY = camera.y;
  }
}

/**
 * Pan the camera by a world-space delta. Editor-only; in follow
 * mode the next `updateCamera` would overwrite the change anyway,
 * so callers should be in `edit` mode before panning.
 */
export function panCamera(camera: Camera, dx: number, dy: number): void {
  camera.x += dx;
  camera.y += dy;
  camera.targetX = camera.x;
  camera.targetY = camera.y;
}

/** Clamp + write zoom. Caller is responsible for cursor-pivot math. */
export function setCameraZoom(camera: Camera, zoom: number): void {
  camera.zoom = Math.max(CAMERA_ZOOM_MIN, Math.min(CAMERA_ZOOM_MAX, zoom));
}

/**
 * Centre the camera on a world point. Editor uses this for the
 * "Center on spawn" command; viewport size is taken in world units
 * (canonical room space — usually `ROOM_W_PX` / `ROOM_H_PX`).
 */
export function centerCameraOn(
  camera: Camera,
  worldX: number,
  worldY: number,
  viewportW: number,
  viewportH: number,
): void {
  const effectiveW = viewportW / camera.zoom;
  const effectiveH = viewportH / camera.zoom;
  camera.x = worldX - effectiveW / 2;
  camera.y = worldY - effectiveH / 2;
  camera.targetX = camera.x;
  camera.targetY = camera.y;
}
