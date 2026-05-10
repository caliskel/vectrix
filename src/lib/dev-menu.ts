// Dev overlay — F1 toggles a small floating menu with two tools:
// a god-mode switch and a "teleport to room" list. Used by rooms
// and tutorial only; sandbox keeps its old direct-F1 godmode bind
// (no rooms to teleport to). Frame loop short-circuits while the
// menu is open via the same gate as the pause overlay.
//
// Layered DOM (not canvas) so toggles are clickable. State is in
// memory only — no localStorage write — so dev tweaks can't leak
// into a built/shipped session.

const STYLE_ID = "dash-dev-menu-style";
const STYLE = `
.dm-overlay {
  position: fixed; inset: 0;
  background: rgba(10, 14, 26, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: none;
  z-index: 200;
  align-items: center;
  justify-content: center;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #ffffff;
}
.dm-overlay.open { display: flex; }
.dm-frame {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 480px;
  max-width: 560px;
  padding: 28px 32px 32px;
  border: 2px solid #ffd60a;
  border-radius: 6px;
  background: rgba(20, 25, 43, 0.85);
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.55);
}
.dm-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: #ffd60a;
  text-shadow: 0 0 12px rgba(255, 214, 10, 0.45);
  margin: 0;
}
.dm-subtitle {
  font-size: 12px;
  color: #7dd3fc;
  letter-spacing: 0.1em;
  margin: -12px 0 0;
}
.dm-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dm-section + .dm-section {
  border-top: 1px solid rgba(255, 214, 10, 0.2);
  padding-top: 18px;
}
.dm-section-title {
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #7dd3fc;
  font-weight: 600;
  margin: 0 0 4px;
}
.dm-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.16em;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: #ffffff;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  text-align: left;
}
.dm-toggle:hover, .dm-toggle:focus-visible {
  border-color: rgba(255, 214, 10, 0.6);
  outline: none;
}
.dm-toggle.on {
  background: #ffd60a;
  color: #0a0e1a;
  border-color: #ffd60a;
}
.dm-room-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-family: inherit;
  font-size: 13px;
  letter-spacing: 0.08em;
  background: transparent;
  border: none;
  border-left: 3px solid transparent;
  border-radius: 0;
  color: #ffffff;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  text-align: left;
}
.dm-room-btn:hover, .dm-room-btn:focus-visible {
  background: rgba(255, 255, 255, 0.05);
  outline: none;
}
.dm-room-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dm-room-btn.current {
  background: rgba(255, 214, 10, 0.15);
  border-left-color: #ffd60a;
}
.dm-room-current-badge {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: #ffd60a;
  font-weight: 700;
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

export type DevMenuRoom = { id: string; label: string };

export type DevMenuConfig = {
  getGodMode: () => boolean;
  setGodMode: (v: boolean) => void;
  getCurrentRoomId: () => string;
  /** True when the run is in a state that disables teleport (e.g.
   *  failed overlay up, mid-transition). The menu greys + disables
   *  room buttons accordingly. */
  isTeleportLocked: () => boolean;
  teleportToRoom: (id: string) => void;
  rooms: DevMenuRoom[];
};

export type DevMenu = {
  toggle: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
};

export function createDevMenu(cfg: DevMenuConfig): DevMenu {
  injectStyle();

  const root = document.createElement("div");
  root.className = "dm-overlay";

  const frame = document.createElement("div");
  frame.className = "dm-frame";

  const title = document.createElement("h2");
  title.className = "dm-title";
  title.textContent = "DEV MENU";
  frame.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "dm-subtitle";
  subtitle.textContent = "F1 toggle • Esc close";
  frame.appendChild(subtitle);

  // Section 1 — God mode
  const godSection = document.createElement("div");
  godSection.className = "dm-section";
  const godTitle = document.createElement("h3");
  godTitle.className = "dm-section-title";
  godTitle.textContent = "God mode";
  godSection.appendChild(godTitle);

  const godToggle = document.createElement("button");
  godToggle.type = "button";
  godToggle.className = "dm-toggle";
  godSection.appendChild(godToggle);
  frame.appendChild(godSection);

  function syncGodToggle() {
    const on = cfg.getGodMode();
    godToggle.classList.toggle("on", on);
    godToggle.textContent = on ? "GOD MODE: ON" : "GOD MODE: OFF";
  }
  syncGodToggle();
  godToggle.addEventListener("click", () => {
    cfg.setGodMode(!cfg.getGodMode());
    syncGodToggle();
  });

  // Section 2 — Teleport
  const tpSection = document.createElement("div");
  tpSection.className = "dm-section";
  const tpTitle = document.createElement("h3");
  tpTitle.className = "dm-section-title";
  tpTitle.textContent = "Teleport";
  tpSection.appendChild(tpTitle);

  const roomButtons: HTMLButtonElement[] = [];
  for (const room of cfg.rooms) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dm-room-btn";
    btn.dataset.roomId = room.id;
    const label = document.createElement("span");
    label.textContent = room.label;
    btn.appendChild(label);
    const badge = document.createElement("span");
    badge.className = "dm-room-current-badge";
    badge.textContent = "CURRENT";
    btn.appendChild(badge);
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (cfg.getCurrentRoomId() === room.id) return;
      setOpen(false);
      cfg.teleportToRoom(room.id);
    });
    roomButtons.push(btn);
    tpSection.appendChild(btn);
  }
  frame.appendChild(tpSection);

  function syncRoomButtons() {
    const current = cfg.getCurrentRoomId();
    const locked = cfg.isTeleportLocked();
    for (const btn of roomButtons) {
      const isCurrent = btn.dataset.roomId === current;
      btn.classList.toggle("current", isCurrent);
      const badge = btn.querySelector<HTMLElement>(
        ".dm-room-current-badge",
      );
      if (badge) badge.style.display = isCurrent ? "" : "none";
      btn.disabled = locked || isCurrent;
    }
  }
  syncRoomButtons();

  root.appendChild(frame);
  document.body.appendChild(root);

  let open = false;
  function setOpen(value: boolean) {
    open = value;
    root.classList.toggle("open", value);
    if (value) {
      // Freshen state every open — current room may have changed,
      // godmode may have been set externally.
      syncGodToggle();
      syncRoomButtons();
      godToggle.focus();
    }
  }

  // Window-level shortcuts. Always listening: F1 toggles open/close,
  // Esc only fires close while open. Each preventDefault'd so the
  // browser default ("F1 = help" in some shells) doesn't interfere.
  function onKey(e: KeyboardEvent) {
    if (e.code === "F1") {
      e.preventDefault();
      setOpen(!open);
      return;
    }
    if (e.code === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }
  window.addEventListener("keydown", onKey);

  return {
    toggle() {
      setOpen(!open);
    },
    close() {
      if (open) setOpen(false);
    },
    isOpen() {
      return open;
    },
    destroy() {
      window.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}
