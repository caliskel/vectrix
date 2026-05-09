import { audio } from "./audio";
import {
  DEFAULT_SETTINGS,
  PRESETS,
  deepAssign,
  type Bindings,
  type Settings,
} from "./config";

const KEY_LABELS: Record<string, string> = {
  Space: "Space",
  Shift: "Shift",
  Control: "Ctrl",
  Alt: "Alt",
  Meta: "Meta",
  Tab: "Tab",
  Escape: "Esc",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Del",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3); // KeyX → X
  if (code.startsWith("Digit")) return code.slice(5); // Digit1 → 1
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

const STYLE = `
.dp-menu-root {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.85);
  display: none;
  z-index: 100;
  overflow: auto;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #fff;
}
.dp-menu-root.open { display: flex; align-items: flex-start; justify-content: center; padding: 36px 16px; }
.dp-panel {
  width: 100%; max-width: 640px;
  background: rgba(20,20,22,0.94);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 12px;
  padding: 22px 26px 26px;
  box-shadow: 0 30px 60px rgba(0,0,0,0.55);
}
.dp-title {
  font-size: 22px; font-weight: 600; margin: 0 0 4px;
  letter-spacing: 0.01em;
}
.dp-hint { color: #888; font-size: 12px; margin: 0 0 18px; }
.dp-section { margin-top: 18px; }
.dp-section h3 {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em;
  color: #777; margin: 0 0 10px; font-weight: 600;
}
.dp-row {
  display: grid; grid-template-columns: 1fr auto;
  align-items: center;
  padding: 6px 0; gap: 12px;
}
.dp-row label { font-size: 14px; color: #ddd; }
.dp-row .ctrl { display: flex; align-items: center; gap: 10px; min-width: 240px; justify-content: flex-end; }
.dp-row .val { font-variant-numeric: tabular-nums; color: #aaa; min-width: 64px; text-align: right; font-size: 13px; }
.dp-row input[type=range] { flex: 1 1 160px; accent-color: #00e5ff; }
.dp-row input[type=color] {
  width: 38px; height: 28px; border: 1px solid rgba(255,255,255,0.15);
  background: transparent; padding: 0; border-radius: 5px;
  cursor: pointer;
}
.dp-bind {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.15);
  color: #fff;
  font: inherit; font-size: 13px;
  padding: 6px 14px; border-radius: 5px;
  cursor: pointer; min-width: 110px;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.dp-bind:hover { background: rgba(255,255,255,0.12); }
.dp-bind.capturing {
  background: rgba(0,229,255,0.18);
  border-color: #00e5ff;
  color: #00e5ff;
}
.dp-presets { display: flex; gap: 10px; flex-wrap: wrap; }
.dp-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #fff;
  font: inherit; font-size: 13px;
  padding: 9px 18px; border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.dp-btn:hover { background: rgba(255,255,255,0.15); }
.dp-btn.danger { color: #ff8b8b; border-color: rgba(255,139,139,0.32); margin-left: auto; }
.dp-btn.danger:hover { background: rgba(255,139,139,0.12); }
`;

const STYLE_ID = "dp-menu-style";
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

export type MenuHandle = {
  root: HTMLElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  isCapturing(): boolean;
  acceptCapturedKey(key: string): void;
  cancelCapture(): void;
};

type CaptureSlot = { target: keyof Bindings; button: HTMLButtonElement };

export function createMenu(
  settings: Settings,
  save: () => void,
  restartRun: () => void,
): MenuHandle {
  injectStyle();

  const root = document.createElement("div");
  root.className = "dp-menu-root";

  let open = false;
  let capturing: CaptureSlot | null = null;

  function rebuild() {
    root.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "dp-panel";
    panel.appendChild(makeHeader());
    panel.appendChild(makeBindings());
    panel.appendChild(makeRun());
    panel.appendChild(makeBullets());
    panel.appendChild(makePlayer());
    panel.appendChild(makeDash());
    panel.appendChild(makePickups());
    panel.appendChild(makeAudio());
    panel.appendChild(makePresets());
    root.appendChild(panel);
  }

  function makeHeader() {
    const wrap = document.createElement("div");
    const t = document.createElement("h2");
    t.className = "dp-title";
    t.textContent = "Settings";
    wrap.appendChild(t);
    const h = document.createElement("p");
    h.className = "dp-hint";
    h.textContent = `${keyLabel(settings.bindings.menu1)} or ${keyLabel(
      settings.bindings.menu2,
    )} closes the menu · changes apply live`;
    wrap.appendChild(h);
    return wrap;
  }

  function makeSection(title: string) {
    const s = document.createElement("div");
    s.className = "dp-section";
    const h = document.createElement("h3");
    h.textContent = title;
    s.appendChild(h);
    return s;
  }

  function makeRow(label: string, control: HTMLElement) {
    const row = document.createElement("div");
    row.className = "dp-row";
    const l = document.createElement("label");
    l.textContent = label;
    row.appendChild(l);
    const c = document.createElement("div");
    c.className = "ctrl";
    c.appendChild(control);
    row.appendChild(c);
    return row;
  }

  function makeSlider(
    min: number,
    max: number,
    step: number,
    value: number,
    format: (v: number) => string,
    onInput: (v: number) => void,
  ) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "10px";
    wrap.style.flex = "1 1 auto";
    wrap.style.minWidth = "220px";

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const valSpan = document.createElement("span");
    valSpan.className = "val";
    valSpan.textContent = format(value);

    input.addEventListener("input", () => {
      const v = Number(input.value);
      valSpan.textContent = format(v);
      onInput(v);
      save();
    });

    wrap.appendChild(input);
    wrap.appendChild(valSpan);
    return wrap;
  }

  function makeColor(value: string, onInput: (v: string) => void) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = value;
    input.addEventListener("input", () => {
      onInput(input.value);
      save();
    });
    return input;
  }

  function makeBindButton(target: keyof Bindings) {
    const btn = document.createElement("button");
    btn.className = "dp-bind";
    btn.type = "button";
    btn.textContent = keyLabel(settings.bindings[target]);
    btn.addEventListener("click", () => {
      if (capturing) {
        capturing.button.classList.remove("capturing");
        capturing.button.textContent = keyLabel(
          settings.bindings[capturing.target],
        );
      }
      capturing = { target, button: btn };
      btn.classList.add("capturing");
      btn.textContent = "Press any key…";
    });
    return btn;
  }

  function makeBindings() {
    const s = makeSection("Bindings");
    s.appendChild(makeRow("Move up", makeBindButton("up")));
    s.appendChild(makeRow("Move down", makeBindButton("down")));
    s.appendChild(makeRow("Move left", makeBindButton("left")));
    s.appendChild(makeRow("Move right", makeBindButton("right")));
    s.appendChild(makeRow("Walk (slow)", makeBindButton("walk")));
    s.appendChild(makeRow("Dash", makeBindButton("dash")));
    s.appendChild(makeRow("Open menu (1)", makeBindButton("menu1")));
    s.appendChild(makeRow("Open menu (2)", makeBindButton("menu2")));
    return s;
  }

  function makeRun() {
    const r = settings.run;
    const s = makeSection("Run");
    s.appendChild(
      makeRow(
        "Time limit",
        makeSlider(
          0,
          300,
          15,
          r.durationSec,
          (v) => (v === 0 ? "∞ (endless)" : `${v} s`),
          (v) => {
            r.durationSec = v;
          },
        ),
      ),
    );
    return s;
  }

  function makeBullets() {
    const b = settings.bullets;
    const s = makeSection("Bullets");
    s.appendChild(
      makeRow(
        "Spawn interval",
        makeSlider(100, 2000, 50, b.spawnIntervalMs, (v) => `${v} ms`, (v) => {
          b.spawnIntervalMs = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Speed",
        makeSlider(100, 600, 10, b.speed, (v) => `${v} px/s`, (v) => {
          b.speed = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Size",
        makeSlider(4, 20, 1, b.size, (v) => `${v} px`, (v) => {
          b.size = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Bounce chance",
        makeSlider(0, 100, 5, b.bounceChance, (v) => `${v}%`, (v) => {
          b.bounceChance = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Max on screen",
        makeSlider(5, 200, 5, b.maxBullets, (v) => `${v}`, (v) => {
          b.maxBullets = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Color",
        makeColor(b.color, (v) => {
          b.color = v;
        }),
      ),
    );
    return s;
  }

  function makePlayer() {
    const p = settings.player;
    const s = makeSection("Player");
    s.appendChild(
      makeRow(
        "Size",
        makeSlider(16, 64, 2, p.size, (v) => `${v} px`, (v) => {
          p.size = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Max speed",
        makeSlider(120, 1500, 20, p.maxSpeed, (v) => `${v} px/s`, (v) => {
          p.maxSpeed = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Idle color",
        makeColor(p.colorIdle, (v) => {
          p.colorIdle = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Walk color",
        makeColor(p.colorWalk, (v) => {
          p.colorWalk = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Dash color",
        makeColor(p.colorDash, (v) => {
          p.colorDash = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Walk speed factor",
        makeSlider(0.2, 0.8, 0.05, p.walkFactor, (v) => `${v.toFixed(2)}×`, (v) => {
          p.walkFactor = v;
        }),
      ),
    );
    return s;
  }

  function makeDash() {
    const d = settings.dash;
    const s = makeSection("Dash");
    s.appendChild(
      makeRow(
        "Distance",
        makeSlider(60, 250, 5, d.distance, (v) => `${v} px`, (v) => {
          d.distance = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Duration",
        makeSlider(60, 300, 5, d.durationMs, (v) => `${v} ms`, (v) => {
          d.durationMs = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "I-frames",
        makeSlider(0, 400, 5, d.iframesMs, (v) => `${v} ms`, (v) => {
          d.iframesMs = v;
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Cooldown",
        makeSlider(100, 1500, 25, d.cooldownMs, (v) => `${v} ms`, (v) => {
          d.cooldownMs = v;
        }),
      ),
    );
    return s;
  }

  function makePickups() {
    const p = settings.pickups;
    const s = makeSection("Pickups");
    s.appendChild(
      makeRow(
        "Drop chance",
        makeSlider(
          0,
          100,
          1,
          Math.round(p.dropChance * 100),
          (v) => `${v}%`,
          (v) => {
            p.dropChance = v / 100;
          },
        ),
      ),
    );
    s.appendChild(
      makeRow(
        "Passive drops",
        makeSlider(
          0,
          60,
          1,
          p.passiveInterval,
          (v) => (v === 0 ? "off" : `every ${v}s`),
          (v) => {
            p.passiveInterval = v;
          },
        ),
      ),
    );
    return s;
  }

  function makeAudio() {
    const a = settings.audio;
    const s = makeSection("Audio");
    const fmt = (v: number) => `${Math.round(v * 100)}%`;
    s.appendChild(
      makeRow(
        "Master",
        makeSlider(0, 1, 0.05, a.master, fmt, (v) => {
          a.master = v;
          audio.init();
          audio.setMasterVolume(v);
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "SFX",
        makeSlider(0, 1, 0.05, a.sfx, fmt, (v) => {
          a.sfx = v;
          audio.init();
          audio.setSfxVolume(v);
        }),
      ),
    );
    s.appendChild(
      makeRow(
        "Music",
        makeSlider(0, 1, 0.05, a.music, fmt, (v) => {
          a.music = v;
          audio.init();
          audio.setMusicVolume(v);
        }),
      ),
    );
    return s;
  }

  function makePresets() {
    const s = makeSection("Presets");
    const row = document.createElement("div");
    row.className = "dp-presets";
    for (const name of ["Easy", "Normal", "Hard"] as const) {
      const b = document.createElement("button");
      b.className = "dp-btn";
      b.type = "button";
      b.textContent = name;
      b.addEventListener("click", () => {
        // reset to defaults first, then overlay preset, so configId reliably
        // matches the preset (custom field carryovers would break that)
        deepAssign(settings, DEFAULT_SETTINGS);
        deepAssign(settings, PRESETS[name]);
        save();
        rebuild();
      });
      row.appendChild(b);
    }
    const restart = document.createElement("button");
    restart.className = "dp-btn";
    restart.type = "button";
    restart.textContent = "Restart run";
    restart.style.marginLeft = "auto";
    restart.addEventListener("click", () => {
      restartRun();
    });
    row.appendChild(restart);

    const reset = document.createElement("button");
    reset.className = "dp-btn danger";
    reset.type = "button";
    reset.textContent = "Reset to defaults";
    reset.addEventListener("click", () => {
      deepAssign(settings, DEFAULT_SETTINGS);
      save();
      rebuild();
    });
    row.appendChild(reset);
    s.appendChild(row);
    return s;
  }

  function setOpen(value: boolean) {
    open = value;
    root.classList.toggle("open", value);
    if (value) rebuild();
    if (!value && capturing) cancelCapture();
  }

  function toggle() {
    setOpen(!open);
  }

  function isOpen() {
    return open;
  }

  function isCapturing() {
    return capturing !== null;
  }

  function acceptCapturedKey(key: string) {
    if (!capturing) return;
    settings.bindings[capturing.target] = key;
    capturing = null;
    save();
    rebuild();
  }

  function cancelCapture() {
    if (!capturing) return;
    capturing.button.classList.remove("capturing");
    capturing.button.textContent = keyLabel(settings.bindings[capturing.target]);
    capturing = null;
  }

  rebuild();
  document.body.appendChild(root);

  return {
    root,
    isOpen,
    setOpen,
    toggle,
    isCapturing,
    acceptCapturedKey,
    cancelCapture,
  };
}
