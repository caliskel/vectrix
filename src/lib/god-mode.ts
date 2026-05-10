// Developer toggle — F1 flips a process-local flag that makes the
// player immune to damage. Lives in module state and is intentionally
// NOT persisted to localStorage so it can never accidentally leak
// into a built/shipped session: every reload starts on `false`.
//
// Each game file calls installGodModeToggle() once and reads
// isGodMode() from its damage-application paths; drawGodModeBadge()
// stamps a small HUD label so a forgotten flag is visible at a
// glance.

let enabled = false;
let installed = false;

export function isGodMode(): boolean {
  return enabled;
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
