// Rooms-mode pause overlay. Replaces the settings menu in rooms (settings
// stay in the sandbox build). The frame freezes while it's open, and the
// player picks resume / restart / quit-to-menu from three buttons.

const STYLE_ID = "rooms-pause-style";
const STYLE = `
.rp-overlay {
  position: fixed; inset: 0;
  background: rgba(10,14,26,0.85);
  display: none;
  z-index: 100;
  align-items: center;
  justify-content: center;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #cbd5e1;
}
.rp-overlay.open { display: flex; }
.rp-frame {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  padding: 36px 48px 32px;
  border-radius: 14px;
  background: rgba(20, 25, 43, 0.85);
  border: 1px solid rgba(168, 85, 247, 0.22);
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.55);
  min-width: 280px;
}
.rp-title {
  font-size: 56px;
  font-weight: 700;
  letter-spacing: 0.28em;
  margin: 0;
  color: #a855f7;
  text-shadow:
    0 0 8px #a855f7,
    0 0 24px rgba(168, 85, 247, 0.55),
    0 0 56px rgba(168, 85, 247, 0.35);
  user-select: none;
}
.rp-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.rp-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.16em;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(216, 180, 254, 0.22);
  border-radius: 8px;
  color: #cbd5e1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  text-align: left;
}
.rp-btn:hover, .rp-btn:focus-visible {
  background: rgba(216, 180, 254, 0.14);
  color: #d8b4fe;
  border-color: rgba(216, 180, 254, 0.55);
  outline: none;
}
.rp-btn .glyph {
  display: inline-block;
  width: 18px;
  font-size: 16px;
  text-align: center;
  color: #a855f7;
}
.rp-btn:hover .glyph, .rp-btn:focus-visible .glyph { color: #d8b4fe; }
.rp-footer {
  font-size: 11px;
  color: #7d8590;
  letter-spacing: 0.08em;
  opacity: 0.75;
  text-align: center;
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

export type PauseMenuHandle = {
  isOpen(): boolean;
  setOpen(value: boolean): void;
  toggle(): void;
};

export function createPauseMenu(opts: {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}): PauseMenuHandle {
  injectStyle();

  const root = document.createElement("div");
  root.className = "rp-overlay";
  root.innerHTML = `
    <div class="rp-frame">
      <div class="rp-title">PAUSED</div>
      <div class="rp-buttons">
        <button type="button" class="rp-btn" data-action="resume"><span class="glyph">▶</span>RESUME</button>
        <button type="button" class="rp-btn" data-action="restart"><span class="glyph">↺</span>RESTART</button>
        <button type="button" class="rp-btn" data-action="quit"><span class="glyph">✕</span>QUIT TO MENU</button>
      </div>
      <div class="rp-footer">Settings only available in Sandbox mode</div>
    </div>
  `;

  let open = false;

  function setOpen(value: boolean) {
    open = value;
    root.classList.toggle("open", value);
    if (value) {
      // focus the first action so Enter / arrow nav works without a click
      const first = root.querySelector<HTMLElement>('[data-action="resume"]');
      first?.focus();
    }
  }

  root.querySelector<HTMLElement>('[data-action="resume"]')?.addEventListener(
    "click",
    () => {
      setOpen(false);
      opts.onResume();
    },
  );
  root.querySelector<HTMLElement>('[data-action="restart"]')?.addEventListener(
    "click",
    () => {
      setOpen(false);
      opts.onRestart();
    },
  );
  root.querySelector<HTMLElement>('[data-action="quit"]')?.addEventListener(
    "click",
    () => {
      opts.onQuit();
    },
  );

  document.body.appendChild(root);

  return {
    isOpen() {
      return open;
    },
    setOpen,
    toggle() {
      setOpen(!open);
    },
  };
}
