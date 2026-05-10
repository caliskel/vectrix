// Developer toggle — process-local flag that makes the player
// immune to damage. Lives in module state and is intentionally
// NOT persisted to localStorage so it can never accidentally leak
// into a built/shipped session: every reload starts on `false`.
//
// Sandbox uses installGodModeToggle() to bind F1 directly. Rooms +
// tutorial route the toggle through the dev-menu overlay instead
// (F1 opens a menu with godmode + room teleport), so they call
// setGodMode() from the menu callback rather than installing the
// global F1 listener.

let enabled = false;
let installed = false;

export function isGodMode(): boolean {
  return enabled;
}

export function setGodMode(value: boolean): void {
  enabled = value;
}

export function installGodModeToggle(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (e.code === "F1") {
      e.preventDefault();
      enabled = !enabled;
    }
  });
}

export function drawGodModeBadge(
  ctx: CanvasRenderingContext2D,
  viewW: number,
): void {
  if (!enabled) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "700 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#facc15";
  ctx.shadowColor = "#facc15";
  ctx.shadowBlur = 8;
  ctx.fillText("GOD MODE", viewW / 2, 12);
  ctx.restore();
}
