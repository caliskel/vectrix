// Developer toggles — process-local flags that adjust damage flow.
// `enabled` makes the player immune to damage (god mode); `instakill`
// makes the boss die on any successful damage call (and enemies
// drop in one hit). They are independent — turning god mode on no
// longer also enables instakill, which was clobbering the death
// cinematic test runs.
//
// Lives in module state and intentionally NOT persisted to
// localStorage so dev tweaks can never leak into a built/shipped
// session: every reload starts on `false`.

let enabled = false;
let instakill = false;
let installed = false;

export function isGodMode(): boolean {
  return enabled;
}

export function setGodMode(value: boolean): void {
  enabled = value;
}

export function isInstakill(): boolean {
  return instakill;
}

export function setInstakill(value: boolean): void {
  instakill = value;
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
  if (!enabled && !instakill) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "700 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#facc15";
  ctx.shadowColor = "#facc15";
  ctx.shadowBlur = 8;
  let label = "";
  if (enabled && instakill) label = "GOD MODE + INSTAKILL";
  else if (enabled) label = "GOD MODE";
  else label = "INSTAKILL";
  ctx.fillText(label, viewW / 2, 12);
  ctx.restore();
}
