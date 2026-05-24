import { audio } from "./audio";
import {
  DEFAULT_SETTINGS,
  PRESETS,
  deepAssign,
  type Settings,
} from "./config";

// Keybinds used to live in this overlay (sandbox-only). They moved
// to the global Controls overlay on the landing page (`index.html`
// + `src/landing/main.ts`) in v5 so a rebind applies to sandbox,
// rooms, and the tutorial at once.

const STYLE = `
.dp-menu-root {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.85);
  display: none;
  z-index: 250;
  overflow: auto;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #fff;
}
.dp-menu-root.open { display: flex; align-items: flex-start; justify-content: center; padding: 36px 16px; }
.dp-panel {
  position: relative;
  width: 100%; max-width: 640px;
  background: rgba(20,20,22,0.94);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 12px;
  padding: 22px 26px 26px;
  box-shadow: 0 30px 60px rgba(0,0,0,0.55);
}
.dp-close {
  position: absolute;
  top: 10px; right: 14px;
  background: transparent; border: none;
  color: #94a3b8; font-size: 22px; line-height: 1;
  cursor: pointer; padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}
.dp-close:hover, .dp-close:focus-visible {
  background: rgba(255,255,255,0.08);
  color: #00e5ff;
  outline: none;
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
};

export type CreateMenuOpts = {
  /** Optional close callback. Fires after the X button or Esc closes
   *  the overlay. Sandbox uses this to restore the pause-menu layer
   *  underneath; the landing-page entry leaves it undefined. */
  onClose?: () => void;
};

export function createMenu(
  settings: Settings,
  save: () => void,
  restartRun?: () => void,
  opts: CreateMenuOpts = {},
): MenuHandle {
  injectStyle();

  const root = document.createElement("div");
  root.className = "dp-menu-root";

  let open = false;

  function rebuild() {
    root.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "dp-panel";
    const closeBtn = document.createElement("button");
    closeBtn.className = "dp-close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "close");
    closeBtn.addEventListener("click", () => {
      setOpen(false);
      opts.onClose?.();
    });
    panel.appendChild(closeBtn);
    panel.appendChild(makeHeader());
    panel.appendChild(makeRun());
    panel.appendChild(makeBullets());
    // Player + dash physics live as constants in lib/config.ts so
    // they stay identical across sandbox / rooms / tutorial. Keybinds
    // moved to the landing-page Controls overlay (v5) so the rebind
    // applies globally. Both used to live in this menu.
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
    h.textContent =
      "Esc or Tab closes the menu · changes apply live · " +
      "rebind keys on the main-menu Controls page";
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
        // Only reset the sections the preset actually specifies (today:
        // bullets). Audio, run length, pickups, etc. stay as the player
        // tuned them so a difficulty change doesn't yank their volume
        // back to default.
        const preset = PRESETS[name];
        for (const key of Object.keys(preset) as (keyof Settings)[]) {
          const def = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
          (settings as Record<string, unknown>)[key] = JSON.parse(
            JSON.stringify(def),
          );
          deepAssign(
            (settings as Record<string, unknown>)[key],
            (preset as Record<string, unknown>)[key],
          );
        }
        save();
        rebuild();
        // Re-apply audio in case some other knob the preset touched
        // indirectly affected playback (defensive — no current preset
        // does, but cheap).
        audio.setMasterVolume(settings.audio.master);
        audio.setSfxVolume(settings.audio.sfx);
        audio.setMusicVolume(settings.audio.music);
      });
      row.appendChild(b);
    }
    if (restartRun) {
      const restart = document.createElement("button");
      restart.className = "dp-btn";
      restart.type = "button";
      restart.textContent = "Restart run";
      restart.style.marginLeft = "auto";
      restart.addEventListener("click", () => {
        restartRun();
      });
      row.appendChild(restart);
    }

    const reset = document.createElement("button");
    reset.className = "dp-btn danger";
    reset.type = "button";
    reset.textContent = "Reset to defaults";
    reset.addEventListener("click", () => {
      deepAssign(settings, DEFAULT_SETTINGS);
      audio.setMasterVolume(settings.audio.master);
      audio.setSfxVolume(settings.audio.sfx);
      audio.setMusicVolume(settings.audio.music);
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
  }

  function toggle() {
    setOpen(!open);
  }

  function isOpen() {
    return open;
  }

  rebuild();
  document.body.appendChild(root);

  return {
    root,
    isOpen,
    setOpen,
    toggle,
  };
}
