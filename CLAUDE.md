# Dash — project notes

A score-attack bullet hell in the spirit of Just Shapes & Beats: a small
square dashes through neon bullets, racks up a Style Score, and either
survives a fixed-length run or chases a leaderboard. Two modes share one
codebase:

- **Sandbox** — endless practice / score-attack arena. Fully playable.
- **Rooms** — story / scripted-encounter mode. Currently a placeholder
  stub; the room engine and content are next.

## Stack

- TypeScript (strict, no decorators, no JSX) — `tsc --noEmit` is the
  type-check gate.
- Vite (multi-page) — three HTML entries (`index.html`, `sandbox.html`,
  `rooms.html`). Common modules tree-shake into shared chunks.
- Canvas 2D — no WebGL, no game framework, no DOM-based UI for the
  HUD/effects (settings menu and the landing page are the only DOM).
- Tone.js — procedural synthwave SFX. Synth chains are pre-built and
  reused; the `AudioContext` starts on the first user gesture.
- pnpm for package management.

No React, no frameworks, no asset pipeline beyond what Vite provides.

## Architecture

```
src/
  lib/                # shared, mode-agnostic
    palette.ts        — neon palette (single source of truth for colors)
    config.ts         — Settings types/defaults/presets/load/save,
                        STORAGE_KEY, particle-trail tuning constants
    audio.ts          — AudioEngine singleton (8 SFX synth chains, master
                        / SFX / music gain bus, volume + ducking)
    pickups.ts        — Pickup type + per-type colors/labels/shapes,
                        rollPickupType, drawPickup/drawPickupIcon
    settings-menu.ts  — Esc/Tab DOM overlay (sliders / color pickers /
                        keybind capture / presets / Reset to defaults)
    neon.ts           — drawNeon two-pass shadow helper
    grid.ts           — createGridCanvas (offscreen background + grid)
    types.ts          — Bounds, ConfigId, hitBounds util
    player.ts         — Player type, createPlayer, inputDirection,
                        dashSpeed (helpers — no state)
    bullets.ts        — Bullet type + circular trail buffer helpers
    particles.ts      — Particle / FloatingText / Ring types and
                        addRing / addFloatingText helpers
    score.ts          — DASH_BASE / NEAR_MISS_BASE / HIT_PENALTY,
                        MULT_* tunables, MULT_TIER_PORTS, multColor
  sandbox/
    main.ts           — entry; side-effect import of sandbox-game
    sandbox-game.ts   — owns the entire sandbox GameState
  rooms/
    main.ts           — entry; locates #app and calls start()
    rooms-game.ts     — campaign engine; locks behind the tutorial and
                        currently runs Room 1 (corridor) + Room 2
                        (narrow trap) + Room 3 (arena) + Room 4
                        (long phase corridor) + Room 5 (boss
                        Sentinel). Build files are room1.ts /
                        room2.ts (arena content) / room3.ts (trap
                        content) / room4.ts / room5.ts; the
                        campaign order chains room1 → room3 →
                        room2 → room4 → room5. The boss-death
                        sequence flips runState to "completed" and
                        shows the Game Complete DOM overlay.
    room1.ts / room2.ts / room3.ts / room4.ts / room5.ts
  tutorial/
    main.ts           — entry for /tutorial.html
    tutorial-game.ts  — fork of rooms-game with tutorial-specific HUD,
                        marker support in Room 0, and the "TUTORIAL
                        COMPLETE" overlay that writes the unlock flag
    room0.ts          — controls room (5 sequenced markers + a dash
                        gate)
    room1.ts / room2.ts / room3.ts
                      — single-encounter intros for Turret / Watcher /
                        Hunter (lifted from the old src/rooms/)
sandbox.html          — Sandbox page (`/src/sandbox/main.ts`)
rooms.html            — Story-mode page (`/src/rooms/main.ts`)
tutorial.html         — Tutorial page (`/src/tutorial/main.ts`)
index.html            — Landing page with the 5-card menu
vite.config.ts        — multi-page build via rollupOptions.input
```

Mode-specific GameState lives in the mode's own folder. `lib/` exports
types and pure helpers — no module-level mutable state. Rooms will get
its own `GameState` later when scripted encounters land.

## Key gameplay decisions

- **60-second runs (configurable)** — default is endless (`run.durationSec
  = 0`); the Run section in settings switches to a hard 0–300s timer.
  `TIME` in the HUD counts down when limited, counts up when endless.
- **3 HP, 1s i-frames after a hit** — a hit costs 1 HP, slams the
  multiplier back to ×1.0, plays a red corner vignette for 200 ms, and
  blinks the player for 1 s. Run ends on `hp <= 0` (KO) or timeout.
- **Style Score**:
  - **Dash-through** (any bullet's AABB enters the player's hitbox during
    the dash i-frame): base 100, doubles per bullet inside the same dash
    (100 → 200 → 400 → 800), floating text shows the base, score adds
    `base × multiplier`, multiplier bumps by +0.2.
  - **Near-miss** (bullet enters `player.size + 20` radius without an
    AABB hit, while moving > 50 px/s and not in a dash i-frame): base 50.
    Each bullet flagged once.
  - **Multiplier**: starts ×1.0, +0.2 per style event (cap ×10.0). After
    2 s of inactivity it decays at 0.5/s back to ×1.0. Hits reset it
    immediately. Tier crossings at ×3 / ×5 / ×7 / ×10 each play a unique
    cue once per run.
- **Best score per configuration** — `localStorage` key
  `dash-prototype:score:<id>` for `id ∈ Default | Easy | Normal | Hard`.
  Custom settings disable record tracking ("custom — record disabled" in
  the end overlay).
- **Pickups (4 types)** dropped only from dash-through bullets (chance
  configurable, default 18 %), plus a passive timer that drops one
  somewhere in the arena every 20 s by default:
  - **HP Heal** (green cross) — +1 HP, or +500 score if already full.
  - **Shield** (blue double ring) — 8 s, +50 % player hitbox, absorbs 2
    bullets at +200 each, ring around player cracks per absorbed hit.
  - **Score Boost** (purple diamond) — 6 s, instantly +1.0 to mult and
    freezes it; HUD `MULT` pulses purple.
  - **Bullet Breaker** (orange triangle) — 5 s; during a dash, contacted
    bullets are destroyed instead of dashed-through. Base 150, doubles
    per kill in the same dash. Broken bullets do NOT drop pickups
    (would create an infinite fountain).
- **Bullets** spawn from random points along the four edges with a ±60°
  spread inward. With 80 % probability each spawn bounces off walls; the
  rest exit and are filtered. Initial fill ramps up to `maxBullets`
  fast (40 ms / 4 per tick) until the run first hits the cap, then the
  configured spawn rate takes over.
- **Visuals** — neon double-shadow render for live entities and floating
  score, cached background grid, ambient corner vignette, particle trail
  off the player, and a partial bullet trail (5-frame circular buffer).
  All colors come from `lib/palette.ts`.
- **Player visual** — white eye-orb with a pupil tracking the nearest
  threat (closest bullet, plus enemies in rooms). Smooth pupil inertia
  via lerp, dilates and shakes on hit, closes vertically on death,
  blinks every 4–7 s. During a dash the ring + pupil go cyan and the
  pupil locks in the dash direction. Implementation in `lib/player.ts`
  (`updateEye`, `drawPlayerEye`, `findNearestThreat`); both sandbox
  and rooms call it with their own threat list.
- **Lean and bob animations during movement** — when the player is
  moving (|velocity| > 50 px/s) the eye tilts into the wind: full
  ±0.45 rad (~26°) for mostly-horizontal motion, ±0.32 rad on
  diagonals, zero on pure vertical. The lean eases via a
  frame-rate-independent lerp (≈12 / s, derived from a per-frame
  factor of 0.18). A vertical bob runs at a phase that advances
  proportional to current speed (`speed / BOB_FREQUENCY_FACTOR =
  140`) and renders as `sin(phase) * 8 px`; when the player stops,
  the phase eases to the nearest neutral so the bob ends at zero
  offset. A start-pop squash + stretch (1.25 × 0.72 × 180 ms) plays
  when speed crosses the lean threshold from below. All three skip
  while dashing. Constants live in `config.ts` (`LEAN_*`, `BOB_*`,
  `SQUASH_*`, `STRETCH_X`).
- **Anisotropic running stretch** — while moving fast (|velocity| >
  100 px/s) the eye continuously stretches along the velocity vector
  and squashes perpendicular, like a running ball. Strength is
  `((speed - threshold) / VELOCITY_FACTOR) * 0.3`, capped at
  `ANISOTROPIC_STRETCH_MAX = 0.3`, so at default `player.maxSpeed =
  440` it sits around 0.17 (≈ 17 % stretch). Applied as a
  rotate-scale-unrotate around the eye in the render path, after
  squash and before flinch. Skipped during dash.
- **Brake squeeze** — triggers when |velocity| drops faster than
  `BRAKE_VELOCITY_DROP_THRESHOLD` over `BRAKE_DROP_TIME_MS` (200 px/s
  / 100 ms ⇒ 2000 px/s² of deceleration). The squash is held at
  (0.78, 1.22) for `BRAKE_DURATION_MS = 100`, then eases back to
  (1.0, 1.0) over `BRAKE_RECOVERY_MS = 150`. Brake is mutually
  exclusive with the start-pop and is gated by its own `brakeAge`
  countdown so friction's continuous deceleration only fires once
  per release.
- **Smash on collision** — when the player crashes into an arena
  edge or room wall, `triggerPlayerSmash(player, nx, ny, impact)`
  flattens the eye along the surface normal: scale interpolates
  between (`SMASH_MIN_SQUASH = 0.85`, perpendicular `1.15`) for a
  light tap (impact = `SMASH_MIN_IMPACT_VELOCITY = 200 px/s`) and
  (`SMASH_MAX_SQUASH = 0.6`, perpendicular `1.4`) for a slam at
  500 px/s. The deformation holds for `SMASH_DURATION_MS = 120`,
  springs past 1.0 for `SMASH_OVERSHOOT_MS = 60` (peak 1.05/0.95),
  then settles over the rest of `SMASH_RECOVERY_MS = 200`. A
  `SMASH_COOLDOWN_MS = 200` gate prevents the eye from pulsing
  while resting against a wall. The audio cue is `audio.play.smash(s)`,
  a low-velocity reuse of `hitSynth` so it sits roughly −26..−30 dB
  below the normal hit. Sandbox calls it from each arena-edge
  clamp; rooms calls it from `resolvePlayerWallCollisions` and the
  closed-door clamp using `pre-velocity` captured before the
  resolve zeros the stopped axis.
- **Player micro-animations** — four "alive" tells layered on top of
  the eye, all driven from `updateEye` / `drawPlayerEye` so sandbox,
  rooms, and the landing preview share the behavior:
  - **Breathing** — uniform sin pulse (±1.2 % over a ~4 s period)
    applied as the last transform before the eye layers. Skipped
    during a dash and during a blink to keep it from fighting those.
  - **Pupil dilation** — the pupil shrinks under threat. Each frame
    counts bullets within `PUPIL_THREAT_RADIUS` (250 px), maps to
    `clamp(count/5, 0, 1)`, adds +0.3 if any live enemy is within
    `PUPIL_ENEMY_THREAT_RADIUS` (300 px), and rooms applies a
    minimum-threat floor of 0.2. Desired factor is `1.3 - threat *
    0.7` (range 0.6..1.3) and the current factor lerps toward it
    with a per-frame coefficient of 0.04. Sandbox + rooms pass
    `bullets`, `enemies`, and `mode` into `updateEye`; the landing
    preview leaves them undefined so it sits at calm ×1.3.
  - **Double blink** — when a blink starts there's a 25 % chance
    that a second, faster blink (close 50 ms / open 100 ms) follows
    after a 150 ms gap. The follow-up uses different durations so
    the double reads as a twitch rather than two identical blinks.
  - **Flinch** — when a bullet first enters the radius `player.size
    + FLINCH_RADIUS_EXTRA` (62 px at default size) the bullet's
    `flinchTriggered` flag is set; if no cooldown is active and the
    player isn't dashing or in hit i-frame, the eye recoils away
    from the bullet (ring + iris translate `FLINCH_OFFSET_PX`
    decaying over 80 ms), the pupil shrinks to 0.7× for 100 ms then
    recovers over 200 ms, and the body squeezes scaleY 0.94 for
    60 ms. A 250 ms cooldown gates re-trigger so a bullet shower
    doesn't make the eye vibrate. Constants: `BREATH_*`,
    `PUPIL_DILATION_*`, `PUPIL_*_THREAT_RADIUS`, `DOUBLE_BLINK_*`,
    `FLINCH_*` in `config.ts`.

## Gameplay parameters (current defaults)

Source: `src/lib/config.ts` and `src/lib/score.ts`.

| Knob | Default | Where |
| --- | --- | --- |
| Bullet spawn interval | 1200 ms | `bullets.spawnIntervalMs` |
| Bullet speed | 250 px/s | `bullets.speed` |
| Bullet size | 9 px | `bullets.size` |
| Max bullets on screen | 30 | `bullets.maxBullets` |
| Bounce chance | 100 % | `bullets.bounceChance` |
| Run length | 0 (endless) | `run.durationSec` |
| Pickup drop chance | 18 % | `pickups.dropChance` |
| Pickup lifetime | 5 s | `pickups.lifetime` |
| Passive pickup interval | 20 s | `pickups.passiveInterval` |
| Shield duration / charges | 8 s / 2 | `pickups.shield` |
| Shield hitbox multiplier | 1.5 | `pickups.shield.hitboxMul` |
| Score Boost duration / bonus | 6 s / +1.0 | `pickups.scoreBoost` |
| Bullet Breaker duration | 5 s | `pickups.breaker.duration` |
| Bullet Breaker base score | 150 | `pickups.breaker.scoreBase` |
| Audio master / SFX / music | 0.8 / 0.6 / 0.8 | `audio.*` |
| Dash-through base | 100 | `score.ts DASH_BASE` |
| Near-miss base | 50 | `score.ts NEAR_MISS_BASE` |
| Hit penalty | 500 | `score.ts HIT_PENALTY` |
| Multiplier grow / max / decay delay / rate | +0.2 / ×10 / 2 s / 0.5/s | `score.ts MULT_*` |
| Multiplier tiers | ×3, ×5, ×7, ×10 | `score.ts MULT_TIER_PORTS` |

Player physics and dash are global constants in `config.ts`
(`PLAYER_SIZE`, `PLAYER_MAX_SPEED`, `PLAYER_WALK_FACTOR`,
`DASH_DISTANCE`, `DASH_DURATION_MS = 140`,
`DASH_IFRAMES_MS = 220`, `DASH_COOLDOWN_MS = 800`); not exposed
in any Settings menu so they stay identical across sandbox /
rooms / tutorial. `DASH_IFRAMES_MS = DASH_DURATION_MS + 80` by
design — i-frames cover the entire dash and 80 ms after landing
as a forgiving tail buffer (Hollow Knight / Celeste style).

Storage key: `dash-proto:settings:v5` (v3 → v4 stripped the
player + dash physics; v4 → v5 lifted keybinds into their own
`dash-proto:keybinds:v1` profile so the Controls overlay on the
landing page can configure them globally — see "Keybinds
profile" below). `loadSettings` walks the chain on first boot,
migrating each older key in order before dropping it. Per-config
best-score keys: `dash-prototype:score:Default|Easy|Normal|Hard`.

## Main menu structure

`index.html` is the VECTRIX landing page — full-viewport retrofuture
arcade menu, animated bg, animated logo, eye preview, six menu
buttons, footer. Pure HTML / CSS / TS (`src/landing/main.ts` plus a
canvas helper at `src/landing/menu-bg.ts`). Fonts: `Orbitron` for
display (the logo, overlay titles) and `Space Mono` for body /
labels / buttons, loaded from Google Fonts with `Courier New` /
generic monospace fallbacks.

Vertical column layout, centered:

  LOGO → TAGLINE → EYE-PREVIEW → BUTTON STACK → FOOTER

**Animated background** (`menu-bg.ts`) — full-viewport canvas pinned
behind the menu via `position: fixed; z-index: 0`. Seven layered
effects driven by one rAF loop. All positions are stored as
normalized `[0..1]` viewport fractions so the layout re-flows on
window resize without re-seeding.

1. Solid `PALETTE.bg` fill + a soft radial gradient from center
   (~40, 60, 100, alpha 0.22 at center → transparent) for depth.
2. Faint cyan grid (80 px spacing, color `rgba(0, 229, 255, 0.06)`)
   that scrolls diagonally at ~18 / 14 px/s.
3. **Floating decorative enemies** — simplified silhouettes of the
   in-game archetypes drifting in the margins, no AI / no combat:
   - **2 turrets** (cyan `#00e5ff`, alpha 0.2, glow 7) anchored in
     the bottom corners (~13 % / 87 % x, ~75 % y). Each picks a new
     barrel-angle target every 3–5 s and lerps toward it at 0.8 /s.
     Body is two nested rings + a thick stub barrel.
   - **1 watcher** (red `#ff2d55`, alpha 0.15, glow 8) drifting on
     a slow elliptical orbit (period 30 s) around an upper-left
     anchor (~8 % / 28 %). Pupil idle-look retargets every 1.2–2.4 s.
   - **2 hunters** (orange `#fb923c`, alpha 0.2, glow 7) — one near
     the upper-right (~90 % / 18 %), one near the lower-right
     (~84 % / 88 %). Each traces a randomly-picked idle path
     (`figure8` / `oval` / `circle`) at 30 % of in-game idle speed.
     Body angle smoothly orients to the path tangent; 5 trail ghost
     copies are dropped every 12 px of travel and fade with index.
   The decorative entities are seeded once on first resize and live
   for the page's lifetime — they're not respawning content, just
   persistent atmosphere fixtures.
4. **Mutating geometric shapes** — 3–6 wireframe polygons live at
   any moment. Each shape picks a type from {triangle, square,
   hexagon, circle, line}, a random size 30–60 px, a color from the
   menu palette (cyan / red / orange / purple / white), a 3–8 s
   lifetime, and 0.0003–0.0008 rad/ms rotation velocity (random
   direction). Lifecycle:
   - Fade in over 600 ms (scale 0 → 1, alpha 0 → 0.25).
   - Hold + rotate. ~50 % of shapes pulse on a 2 s sine (±5 % size).
   - ~50 % of shapes morph mid-life: at a random point in their
     30–60 % age range, render BOTH the old and new shape blended
     by `morphProgress` over 800 ms, with a sin-dip scale dip to
     ~60 % at the halfway point, then settle on the new type.
   - Fade out over 500 ms (scale → 0, alpha → 0).
   Spawn positions reject any point within 250 px of viewport
   center (up to 8 rolls) so shapes don't sit behind the logo.
   New shapes spawn every 1.5–3 s while count is under
   `SHAPE_COUNT_MAX` (6); when count dips under `SHAPE_COUNT_MIN`
   (3) a fresh one spawns immediately.
5. 16 dust particles (1–2 px white, alpha 0.15) drifting at
   5–15 px/s in random directions, looping at edges.
6. Horizontal scanlines (4 px spacing, color `rgba(255, 255, 255,
   0.025)`) scrolling down at 30 px/s — CRT feel.
7. Glitch overlays. Micro-glitches every 8–15 s: a horizontal strip
   (20–40 px tall) is `drawImage`d onto itself with an 8–20 px
   horizontal offset + red tint (`rgba(255, 45, 85, 0.18)` via
   source-atop composite) for 80 ms — CRT tearing. Big glitches
   every 30–60 s: full-screen white flash (alpha 0.08) for 60 ms +
   the caller-provided `onBigGlitch` callback fires for an audio
   crackle cue.

A `@media (prefers-reduced-motion: reduce)` block hides the bg
canvas and zeroes out all the entrance / breathing / glitch
animations on the menu content so users with motion-sensitivity OS
settings get a static landing.

**VECTRIX logo** — `<h1 class="logo">` with one `<span class="logo-
letter" data-letter="V">…</span>` per letter. CSS handles three
animations:

- **Letter entrance** — each letter starts opacity 0 / scale 1.3 and
  runs `@keyframes letter-enter` (280 ms cubic-bezier, "pop").
  `main.ts` stamps `animation-delay` on each letter (80 ms apart)
  so they cascade in.
- **Breathing** — infinite `@keyframes logo-breathing` swells the
  text-shadow glow over 2.5 s (white core + cyan halo ±50 %).
- **RGB-split glitch** — when `main.ts` adds `.glitch` to the logo
  for 60 ms (or 200 ms for the rare longer one, ~15 % roll), the
  `::before` / `::after` pseudo-elements paint a red copy 4 px left
  and a cyan copy 4 px right (both alpha 0.55), and the whole logo
  shifts 6 px right. Triggered on a 10–25 s random interval via
  `scheduleLogoGlitch()`.

Glow recipe (also used in the breathing keyframe):
`0 0 8px rgba(255,255,255,0.9), 0 0 20px rgba(0,229,255,0.6),
0 0 40px rgba(0,229,255,0.3)`.

**Tagline** — "vector odyssey" in Space Mono 18 px / letter-spacing
6 px / `rgba(125, 211, 252, 0.7)`. Fades in 600 ms after the logo
starts (matches the cascade end).

**Eye preview** — 200 × 200 canvas (`#eye-preview-canvas`) with a
cyan circle ring (`.eye-preview-ring`, 90 px radius outline at alpha
0.2) framing it. Reuses `createPlayer` / `updateEye` / `drawPlayerEye`
from `lib/player.ts`: a `Player` is created at canvas center, the
window-level `mousemove` listener captures global cursor coords,
and each rAF tick converts them into canvas-local coords (via
`getBoundingClientRect`) for the `threat` argument to `updateEye`.
When the pointer hasn't been seen yet or is far outside the canvas
(±200 px), `threat` is `null` and the eye falls back to idle-look
behavior. Colors are read from `loadPlayerProfile()` and refreshed
on `storage` events + on Save in the Player overlay (same tab).

**Menu button stack** — `.menu-buttons` flex column, six rows. Each
`.menu-btn` is an `<a>` or `<button>` (overlay launchers are
buttons), shape: `▶  LABEL / subtitle`, 60–70 px tall. Three
visual states:

- **Idle**: bg `rgba(20, 25, 43, 0.5)`, border `rgba(255, 255, 255,
  0.1)`, label white 24 px / letter-spacing 4 px, subtitle muted
  slate 12 px.
- **Hover / focus** (`:hover:not(.locked)`): bg `rgba(0, 229, 255,
  0.1)`, border cyan, label gets a cyan text-shadow, the ▶ arrow
  translates 6 px right via CSS transition, and the whole button
  scales 1.02. All transitions 200 ms.
- **Locked** (only on PLAY ROOMS while tutorial isn't completed):
  alpha 0.4, cursor `not-allowed`, hover ignored, subtitle text
  swaps to "🔒 Complete tutorial first". When the tutorial-completed
  flag flips (this tab via the local Save path or another tab via
  `storage`), `applyTutorialState()` re-renders the button state.

Entrance: each button cascades in 100 ms apart starting at 1100 ms
(after the logo / tagline land). `main.ts` stamps the per-button
`animation-delay` inline and adds the `.entered` class to swap in
the `@keyframes btn-in` (translateY 20 → 0, opacity 0 → 1, 400 ms).

Click feedback: the `.flash` overlay inside each button gets the
`btn-flash` keyframe (cyan alpha 0.3 → 0 over 200 ms) on every
click. For anchor buttons (Tutorial / Rooms / Sandbox), `main.ts`
preventDefaults the navigation and re-schedules `window.location.href
= href` after 120 ms so the flash + click sound play before the
page swaps. Overlay buttons open the overlay immediately; the flash
animates on top.

Button list:

| id            | label       | subtitle                              | target              |
| ------------- | ----------- | ------------------------------------- | ------------------- |
| `btn-tutorial`| TUTORIAL    | "Learn the basics" / "Replay tutorial"| `/tutorial.html`    |
| `btn-rooms`   | PLAY ROOMS  | "Story mode" / "🔒 Complete tutorial first" (locked) | `/rooms.html` |
| —             | SANDBOX     | "Practice freely"                      | `/sandbox.html`     |
| —             | PLAYER      | "Customize your character"             | opens Player overlay|
| —             | CONTROLS    | "Rebind keys"                          | opens Controls ovl. |
| —             | ABOUT       | "Credits and info"                     | opens About overlay |

**UI sounds** — every non-locked button fires `audio.play.uiHover()`
on mouseenter / focus and `audio.play.uiClick()` on click. The
menu bg's `onBigGlitch` callback also fires `audio.play.uiStatic()`
so the visual flash is paired with a CRT-style noise crackle. Setup
methods live in `audio.ts` (`setupUiCues`): hover is a bit-crushed
880 Hz triangle tick (-8 dB master, 30 ms decay), click is a
bit-crushed 440 Hz triangle with a faux-chorus second voice at
+12 cents (~452 Hz, +3 ms offset), and static is a tight bandpassed
white-noise burst.

**Footer** — under the buttons: a 200 px wide `rgba(255,255,255,
0.1)` divider, then "version 0.1 — vectrix" in Space Mono 11 px,
letter-spacing 2 px, muted slate alpha 0.4. Fades in last (1500 ms
after page load).

**Overlays — same as before.** Player / Controls / About markup +
behavior unchanged from the previous design: same dark backdrop
(`rgba(10,14,26,0.92)` + backdrop-filter blur), centered frame,
`×` corner button, global Esc handler. Tab is preventDefault'd
while any overlay is open so focus doesn't leak under the modal.

Mobile layout: at `max-width: 600px` the logo shrinks
(`clamp(40px, 14vw, 80px)` + letter-spacing 6 px), tagline tightens
(14 px / spacing 4 px), eye preview drops to 150 px, and button
labels shrink to 20 px / spacing 3 px. Vertical column stays.

### Player overlay

Two columns:

- **Live preview canvas** (300 × 300, dpr-scaled). A `Player` from
  `lib/player.ts` runs through `updateEye` + `drawPlayerEye` every
  frame — same code path as in-game, so the preview is identical to
  what rooms will render. The rAF loop is started on overlay open
  and cancelled on close.
- **Color form** with three rows (OUTER RING / IRIS / PUPIL). Each
  has a label, a small description, a native `<input type="color">`,
  and a 24 × 24 swatch that mirrors the picker. Picker `input`
  events refresh the preview directly — no apply step.

`SAVE & CLOSE` writes the current pickers to `localStorage` under
`dash-proto:player-profile` and closes the overlay. `RESET` slams
the pickers back to `DEFAULT_PLAYER_PROFILE`. `×` and Esc close
without saving (the next open re-reads from localStorage so unsaved
edits are discarded).

### Controls overlay

The single, global keybind editor. Reachable from the landing
page only — once the player is in a mode, rebinds require coming
back here. Backed by `lib/keybinds.ts` and persisted under
`dash-proto:keybinds:v1`.

Layout: a 3-column table of six rows. The header reads
`ACTION / PRIMARY / SECONDARY`; each action row puts its label
on the left and two clickable keycap cells on the right.

| action       | default primary | default secondary |
| ------------ | --------------- | ----------------- |
| MOVE UP      | `KeyW`          | `ArrowUp`         |
| MOVE DOWN    | `KeyS`          | `ArrowDown`       |
| MOVE LEFT    | `KeyA`          | `ArrowLeft`       |
| MOVE RIGHT   | `KeyD`          | `ArrowRight`      |
| DASH         | `Space`         | `KeyX`            |
| WALK (SLOW)  | `ShiftLeft`     | `ShiftRight`      |

Bindings store raw `KeyboardEvent.code` values (layout-independent —
RU/EN swaps don't break the player's setup). `formatKeybindLabel`
in `lib/keybinds.ts` maps them to display strings (`KeyW` → "W",
`ArrowUp` → "↑", `ShiftLeft` → "L SHIFT", `Space` → "SPACE", etc.)
for both the cells and the tutorial Room 0 hint banners.

**Capture flow.** Click a cell → border flashes bright cyan, text
reads "press a key…". The next non-reserved keydown writes that
code into the slot and auto-saves to localStorage. Esc inside
capture cancels without changing the binding; Esc outside capture
closes the overlay. Capture-mode keydown is installed in the
capture phase so it beats the overlay-close listener on Escape.

**Reserved keys.** `Escape`, `Tab`, and `F1` are SYSTEM bindings —
the pause / settings menu and dev overlay toggles. Attempting to
capture any of them rejects with a "RESERVED KEY" toast (1.5 s).
These are hardcoded inside each game's keydown handler so the
Controls page can't accidentally clear them.

**Duplicate handling.** Binding a code already in another slot
evicts the loser: if it was a *secondary* slot, that slot clears
to `null` ("—"). If it was a *primary*, the rebind is rejected
with a toast — primaries can never be empty (the action would
have no key). Within the same action, setting a slot to the value
of the other slot in that action acts as a "clear" for secondary
(it goes to `null`); primary always overwrites.

**RESET TO DEFAULTS** slams the profile back to `DEFAULT_KEYBINDS`
and saves immediately. `CLOSE` / `×` / Esc just close — auto-save
makes a separate "save" button unnecessary.

Live propagation: each game's `start()` calls `loadKeybinds()` once
and subscribes to the `storage` event. A rebind in another tab
updates the profile in the running game without a reload.

### About overlay

A monospace text block built fresh on every open. Lists the play
modes, the current keybind cheat-sheet (pulled dynamically from
`loadKeybinds()` via `formatKeybindLabel`), and the reserved
system keys. Static layout — no animation, no live preview.

### Player profile and where it applies

The Player overlay on the landing page is the **only** place to
customise the player's colours. Sandbox Settings used to mirror
some of these (idle / walk / dash colour pickers) — those rows
have been removed; Settings now keeps just sandbox-tunable
mechanics (size, max speed, walk-speed factor). The corresponding
`PlayerSettings.colorIdle / colorWalk / colorDash` fields are
gone too.

```ts
type PlayerProfile = {
  outerRing: string;     // default #ffffff
  iris: string;          // default #ffffff
  pupil: string;         // default #ffffff
  dashParticles: string; // default #9ca3af — neutral grey trail
};
```

Helpers in `lib/player.ts`:

- `loadPlayerProfile()` — reads the localStorage key with shape
  guards; falls back to defaults on any partial / corrupt save.
- `savePlayerProfile(profile)` — writes the JSON, swallows quota /
  privacy errors.

`drawPlayerEye` accepts an optional `profile` in its opts. When
set, profile values override `ringColor` / `pupilColor` /
`irisColor` **only outside of a dash**. While the player is
dashing (or in the post-dash i-frame), the ring + pupil + glow +
ghost trail stay on `PALETTE.playerDash` — the dash beat is
design-locked so it always reads as the same cyan flash
regardless of customisation.

All three modes (sandbox, tutorial, rooms) load the profile at
`start()` and forward it to `drawPlayerEye` on every render, so
the same Player-overlay pick lights up identically across modes.
Trail particles also pull from the profile: dash sparks use
`profile.dashParticles`, idle / walk trails follow
`profile.outerRing` so a single colour pick drives the whole
"your colour" feel.

`PALETTE` itself is `as const` — never mutated. Defaults live
there; profile is the cross-mode override layer.

## Rooms mode

Story / scripted-encounter mode. First playable iteration: one real
room with a single turret, a locked door that opens on clear, and a
placeholder "Room 2 — coming soon" beyond it.

### Layout

- Logical room is **1200 × 800** in `src/rooms/room1.ts`.
- The screen letterboxes onto the room: `scale = min(viewW/1200,
  viewH/800)`, centered, dark bars where the window is wider/taller
  than the room aspect.
- Outer walls are 30 px thick (`PALETTE.bgGrid` fill, faint
  `PALETTE.player` outline). Bullets in rooms **do not bounce** — they
  expire on wall contact (different from sandbox by design, simpler
  threat reading for the first encounter).

### `Room` shape (`src/rooms/room.ts`)

```ts
type Room = {
  id: string;
  walls: Wall[];      // AABB rectangles
  enemies: Enemy[];   // implements lib/enemies/types.ts
  door: Door | null;  // optional exit
  nextRoomId: string | null;
  spawnX: number;
  spawnY: number;
  message?: string;   // overlay text (used by Room 2 placeholder)
};
```

Each room is rebuilt fresh by its `buildRoomN()` factory on
`restartRun`, so enemies/door state always reset cleanly.

## Tutorial mode (separate page)

`tutorial.html` is its own entry, served by `src/tutorial/main.ts` →
`src/tutorial/tutorial-game.ts` (a fork of `rooms-game.ts` with
campaign-specific bits swapped for tutorial behavior). Four rooms
in order: **Room 0** (controls), **Room 1** (Turret), **Room 2**
(Watcher), **Room 3** (Hunter). HUD label flips to
`TUTORIAL — ROOM N / 4`. The single-pellet enemy intros are
the same encounters that previously lived under `src/rooms/`;
they were moved here so the campaign in `rooms.html` can hold
its own larger encounters.

Completion is sticky — when the player walks through the open
door of Room 3 (its `nextRoomId` is `null`),
`completeTutorial()` writes
`localStorage["dash-proto:tutorial-completed"] = "true"`, plays
`audio.play.multUp(8)` as a victory sting, and shows a
**DOM overlay** with three CTAs:

  ▶  PROCEED TO STORY   → /rooms.html
  ↺  REPLAY TUTORIAL    → restartRun() (back to Room 0 phase 1)
  ←  BACK TO MAIN MENU  → /

The overlay is built on demand in `showTutorialCompleteOverlay()`
(injects styles + DOM into `document.body`). Buttons are real
`<a>` / `<button>` elements so they're clickable / focusable.
Keystrokes are absorbed in the keydown handler while
`runState === "completed"` so Esc / Enter / WASD don't toggle
the pause menu or restart input — completion is mouse-driven
choice only.

The landing menu reflects the unlocked state live:
`applyTutorialState()` re-runs on `focus`, `pageshow`, and
`storage` events, so coming back from the tutorial via in-page
nav, bfcache restore, or another tab updates the ROOMS card
without a manual reload.

### Tutorial Room 0 — Controls

1200 × 800, no camera. The room runs a three-phase machine
driven by `tutorial-game.ts` — markers, walls, and the training
dummy are spliced in / out of `currentRoom` as phases advance:

  movement → dash → combat → complete

- **Phase 1 — movement.** Four `Marker`s walked in strict 1 → 2
  → 3 → 4 order: (600, 400) center → (200, 200) upper-left →
  (1000, 200) upper-right → (300, 600) lower-left. Only the
  active marker (`markers[markerIndex]`) reacts to overlap and
  pulses with its label; future markers render as α 0.25
  silhouettes so the path is visible without distracting from
  the next-up. The route ends at lower-left so Phase 2 starts
  with the player on the LEFT side of the dash wall. HUD top
  shows `MARKERS X / 4`. Hint banner reads
  `USE [W][A][S][D] TO MOVE` **using the player's current
  primary bindings** — labels are generated dynamically via
  `formatKeybindLabel(keybinds.moveUp.primary)` etc., so a
  player who rebound WASD to QWES sees `USE [Q][W][E][S] TO
  MOVE` instead of being lied to.
- **Phase 2 — dash.** Markers cleared, replaced with a single
  goal at (900, 400) and a vertical 30 × 800 wall obstacle at
  x = 585 spanning the entire arena height — the player
  literally cannot walk around it. The wall is permeable while
  the player is in dash i-frames — the engine filters
  `room0DashWall` out of the wall list passed to
  `resolveEntityWallCollisions` when `dashIframeTime > 0`.
  Hint reads `PRESS [SPACE] TO DASH` (or whatever the player's
  current `keybinds.dash.primary` is). On phase transition the wall
  vaporises with a 12-particle dispersion (PALETTE.bgGrid) and
  a faint white expansion ring at the wall midpoint.
- **Phase 3 — combat.** Wall and marker cleared, a
  `TrainingDummy` (`lib/enemies/training-dummy.ts`) spawns at
  (600, 400). It's a 50 px grey-fill / white-outline disc
  with HP 3, no shooting, no AI, `detectionRadius = 0` so the
  awareness ring stays idle. Dash-through hits use the same
  impact path as live enemies — knockback / flash / kill
  burst. HUD reverts to `ENEMIES 1`. Hint reads
  `DASH THROUGH THE TARGET 3 TIMES TO DESTROY IT`.
- **Phase 4 — complete.** Door opens, the room is added to
  `clearedRoomIds`, and the hint flips to `WELL DONE —
  PROCEED →`. Stepping into the door fires the standard
  transition to Tutorial Room 1.

The hint banner sits bottom-center in screen space (`y =
viewH - 80`). Text is parsed for `[…]` patterns (any non-bracket
sequence) which render as white keycap rectangles whose width is
measured per-token, so multi-char labels like `[SPACE]` or
`[L SHIFT]` render correctly when the player has rebound keys.
Show / hide animations slide 8 px and fade over 300 / 200 ms. Visual is intentionally restrained —
text colour `#d4af0a` (dimmer than the canonical
`PALETTE.player`), `shadowBlur 6`, denser backplate
`rgba(10, 14, 26, 0.85)`. No idle pulse — the hint is meant to
be a calm prompt the player can read while still focusing on
the world. `tickHint(dt)` runs every frame;
`drawTutorialHint()` draws after the HUD so it sits above
everything. `syncTutorialStateForRoom()` resets phase, hint,
and prop state on transitions / restarts so a re-entry to
Room 0 starts fresh.

### Tutorial Rooms 1–3

Identical to the original Rooms 1–3 in mechanics (one Turret /
Watcher / Hunter encounter respectively, same right-wall
door pattern). Lift-and-shifted into `src/tutorial/room1.ts`,
`room2.ts`, `room3.ts`; only Room 3's `nextRoomId` changed —
it's now `null` so the door triggers `completeTutorial()`
instead of advancing.

## Campaign rooms (`rooms.html`)

The campaign now runs **Room 1 → Room 2 → Room 3 → Room 4 →
Room 5 (boss)**. HUD shows `ROOM N / 5`; the boss room's label
flips to `5 / 5 — BOSS` in red. The Game Complete DOM overlay
appears after the boss-death sequence; there's no further room
to step into. On launch the engine checks
`localStorage["dash-proto:tutorial-completed"]` — if absent,
it renders a "STORY MODE LOCKED" full-page overlay with a CTA
that links straight to `/tutorial.html`, and never starts the
game loop.

### Room 1 — corridor

Long horizontal corridor — first room that needs the follow camera.

- World is 3600×600 (3× viewport width, taller than tall enough
  to make camera scroll the only practical view). `useCamera =
  true`, `width / height` set so `roomBounds()` returns the right
  clamp. Camera is centered on the player; vertical clamp folds
  the 600-tall world into the 800-tall canonical viewport with
  100 px of letterbox-internal padding above and below.
- Player spawns at (200, 300). Three **Turret**s at (900, 300),
  (1900, 300), (2900, 300) and one **Watcher** at (3300, 300).
  Three short pillar walls (60×120) at (1100, 280), (1900, 100),
  (2700, 360) force weaving / dashing through. The Watcher slides
  along walls and pillars via `resolveEntityWallCollisions` (it's
  no longer the clip-through eye it used to be).
- The third turret has `dropsKey = true` — its kill spawns a Key
  at the kill site. Door at (3570, 300) is `requiresKey: true`;
  it opens the moment the player picks up the key, regardless of
  whether the surviving turrets / Watcher are still alive (the
  carrier kill is the gate, stragglers don't block the exit).
  On unlock: door switches to "open" arrow, +5 mult-up sting,
  → Room 2 (the trap, file `room3.ts`).

### Room 2 — narrow trap

Built in `room3.ts` (file id `"room3"`) but scheduled second in
the campaign for difficulty pacing. 1200×800 with a Hunter that's
hostile from the first frame and two crossfire turrets. The
encounter teaches constant motion: the turret pair on (600, 150)
/ (600, 650) carves the central horizontal so standing on the
door's y-line catches both streams, and the Hunter's inertia
punishes idle holds.

- **Turret #1** at (600, 150), **Turret #2** at (600, 650) —
  vanilla Turrets (HP 2). Their bullets cross at the spawn line
  (y = 400) so the player has to weave instead of strafing
  along the centre.
- **Hunter** at (900, 400) constructed with `{ startsAggressive:
  true }`. The flag is a Hunter-ctor option that initialises
  `awarenessState = "aggro"` and `prevAwarenessState = "aggro"`,
  skipping the idle / alerting telegraph entirely so the chase
  starts on entry. Hunter carries the key (`dropsKey = true`,
  HP 1).
- Door at (1185, 400) is `requiresKey: true`. Per the global
  rule, it opens on the key alone — so a clean dash through
  the Hunter (kill, pickup, exit) finishes the room without
  ever firing on the turrets. Slower play kills turrets first
  to open the centre, then deals with the Hunter.
- `useCamera = true`, spawn at (150, 400). `nextRoomId =
  "room2"` (the arena file).

### Room 3 — arena with circular defence

Built in `room2.ts` (file id `"room2"`) but scheduled third in
the campaign — last real encounter before the Room 4 placeholder.
1400×900 fully open arena. No internal cover; the player has to
manage distance and angles instead of peeking around a column.

- Four **Turret**s in the corners at (250, 250), (1150, 250),
  (250, 650), (1150, 650). One **Watcher** in the centre at
  (700, 450) with `dropsKey = true`. All enemies wake on their
  own detection radii; the player can sneak up on individual
  turrets if they take a wide path.
- Bullets and the Watcher's laser still clip on perimeter walls
  via the existing `bulletInsideWall` filter and the
  `raycastWalls` AABB raycast — but with no interior obstacles
  there's nothing in the room interior to clip on. Friendly fire
  on the laser keeps working unchanged: any enemy on the beam's
  segment takes a hit, including for-free turret kills when the
  player lines the Watcher up with a corner.
- The Watcher carries the key — its kill spawns a Key in the
  centre. Door at (1385, 450) is `requiresKey: true` and opens
  on the key alone (the corner turrets can stay alive — the
  Watcher kill is the gate). `useCamera = true` (1400×900 ≥
  1200×800 viewport letterbox). Spawn at (200, 450). `nextRoomId
  = "room4"` (long phase corridor).
- If the open layout reads as too punishing later, dropping one
  or two 50×200 columns back near the centre is the cheapest
  next step; the bullet/laser clipping was tested with columns
  in place and works regardless.

### Room 4 — long phase corridor

8000×700 corridor split into 6 sections (~1300 px each) by 30 px
**dashable** dividers. Lazy spawns drop one phase-through Hunter
into each section as the player crosses in, and the key is
pre-placed on the floor in section 4 instead of dropping from a
kill.

- **Section dividers** sit at x = 1300, 2600, 3900, 5200, 6500
  (full ROOM_H tall, `dashable: true`). The new
  `Wall.dashable` flag is filtered out of the player's wall list
  while `dashIframeTime > 0` (rooms-game's `wallsForPlayer`),
  and `drawWalls` paints dashable walls with a cyan dashed
  outline so the dash colour reads as "phase through" without
  copy. Bullets, lasers, and non-phasing enemies still treat
  dashable walls as solid — the filter is player-only.
- **Pending hunters** live in `Room.pendingEnemies`, a new
  field on the Room type. Each entry is `{ triggerX, spawned,
  spawn() }`; rooms-game ticks the list every frame after the
  awareness pass and pushes a fresh enemy into
  `currentRoom.enemies` the moment `player.x ≥ triggerX`.
  Room 4's six entries fire at triggers 0 / 1340 / 2640 / 3940 /
  5240 / 6540 with hunters spawning at the section's far end
  (1100 / 2400 / 3700 / 5000 / 6300 / 7700, all y = 350). Each
  Hunter is constructed with `{ startsAggressive: true,
  ignoresWalls: true }` — the new `ignoresWalls` opt skips both
  `resolveEntityWallCollisions` calls in Hunter.update so a
  phase-through hunter from section 1 can converge on the
  player at the far end of the corridor.
- **Static key** uses the new `Room.initialKey: { x, y }` field.
  rooms-game's `applyInitialKey()` seeds `currentKey =
  createKey(...)` on initial mount, restart, and every transition
  into a room that carries one. Room 4 places the key at
  (4500, 350) — middle of section 4, on the door's y-line.
- Door at (7985, 350) is `requiresKey: true` and opens on the
  key alone (per the global rule); leftover hunters don't block
  the exit. `useCamera = true`, spawn at (200, 350),
  `nextRoomId = "room5"`.

### Room 5 — Sentinel (boss)

1600×1200 open arena. Single enemy: a `Sentinel` at (800, 600).
Door at (1585, 600) opens on Sentinel kill via the standard "all
enemies dead" rule — the Game Complete overlay runs ~3 s after
the kill, so the door rarely matters in practice. `useCamera =
true`, spawn at (200, 600), `nextRoomId = null`.

The Sentinel owns its own state machine —
`SentinelState = "intro" | "idle" | "attacking" | "dying" |
"defeated"`. rooms-game just queries `sentinel.state`,
`sentinel.timeScale`, and `sentinel.shouldFreezeWorld()`,
delegates the screen-overlay draw, and reacts to state
transitions for score + Game Complete.

- **intro** (3300 ms, all timings in ms relative to state entry):
  runs the moment Room 5 is entered. `shouldFreezeWorld()` is
  true, so rooms-game suppresses player input + skips combat
  sim; the boss is invulnerable.
  - 0–800 ms: black fade overlay 0 → 0.7, boss invisible.
  - 800–1600 ms: body materializes via `easeOutBack` scale
    `0 → 1`. At 800 ms the boss spawns one 16-particle radial
    burst (200–350 px/s, 800 ms life). Fade overlay drops
    0.7 → 0.3.
  - 1600–1700 ms: 12 px screen shake (requested via
    `pendingShakePx/Sec` and drained by rooms-game's
    `consumeSentinelEffects`); fade overlay finishes at 0.
  - 1700–3300 ms: red 60 px "SENTINEL" title fades in
    (1700–1900) / holds (1900–3000) / fades out (3000–3300).
  At 3300 ms the boss flips to `"idle"` and the HP bar appears.
- **idle / attacking**: figure-8 path around arena center (12 s
  period), independent of player position; amplitudes inset by
  hitbox + 60 px so the lemniscate can't kiss the walls, and a
  hard `[hitbox, arena − hitbox]` clamp backs it up. Movement
  only ticks in these two combat states (intro and dying both
  hold the boss still).

  **HP & damage.** `SENTINEL_HP_MAX = 60`. **Body is invulnerable
  in every phase except RB-`vulnerable`** — outside the open-eye
  window dash-through deals zero damage (used to be 1 HP). The
  only damage path is dashing the eye in vulnerable for 3 HP
  (`RB_EYE_HIT_DAMAGE`), so a kill needs ~10–20 successful eye
  hits, with one or two landing per RB cycle ⇒ a clean 2–4 minute
  fight. A grey "whiff" effect (small ring + four particles)
  spawns on dash-through-body outside vulnerable so the player
  reads the invulnerability as intentional, not a glitch — fires
  once per dash via `dashIdAlreadyWhiffed`, deferred through
  `pendingBodyWhiff` so the FX have ctxRoom. Body **contact
  damage** to the player still applies as normal (1 HP, gated by
  i-frames) — that's punishment for collision, not a damage
  path.

  **Phases.** `bossPhase` (1 / 2 / 3) tracks the active "act" of
  the fight. Boundaries: phase 1 covers HP 60→40, phase 2 covers
  HP 40→20, phase 3 covers HP 20→0 (boundaries
  `SENTINEL_PHASE_HP_BOUNDARY_1_TO_2` /
  `SENTINEL_PHASE_HP_BOUNDARY_2_TO_3` exported so rooms-game
  draws the HP-bar phase markers from them). `PHASE_CADENCE`
  (1.0 / 0.80 / 0.65) multiplies every attack cooldown so phase 2
  fires ~25 % faster, phase 3 ~54 % faster — internal telegraph
  / fire / recovery beats stay readable, only the gaps shrink.
  Each phase
  also shifts the body / outer-ring / hex-stroke accent
  (`#ff3344` → `#ff5511` → `#ff2266`) and the mid-ring colour
  (`#ff5577` → `#ff7733` → `#ff5588`). The eye keeps `#ffaa22`
  in every phase — it's the "opportunity" cue, untouched.

  **Phase transition** (2 s, invulnerable, frozen). Triggers when
  HP crosses a boundary AND every attack sub-machine is idle (so
  in-flight attacks finish first). Cinematic beats:
  - 0–300 ms hitstop: timeScale 1 → 0.15, 6 px shake, white body
    flash.
  - 300–1200 ms build: timeScale eases 0.15 → 0.4, accent-coloured
    rings emit every 100 ms (r 30 → 200), shake ramps 2 → 8 px.
  - 1200–1500 ms climax: timeScale 0.4 → 1, 12 px shake,
    32-particle radial spray (16 white + 16 new accent),
    `bossPhase` increments here, HP-bar marker for the crossed
    threshold flashes for 300 ms, audio fires `hitHeavy + alert`.
  - 1500–2000 ms settle: accent + mid-ring colour lerp from old
    palette to new over 500 ms via `lerpHex`.
  At 2000 ms `phaseTransition === null`; combat resumes with the
  new phase's cadence. `takeDamage` rejects all input while
  `phaseTransition !== null` so the boss is invulnerable through
  the cinematic.

  The boss runs **three parallel attack sub-machines** in phase
  1, **four in phase 2** (sweep laser joins). **Mutual exclusion**:
  only one attack sub-state machine can be in a non-idle phase at
  any moment. While any attack is active, all other cooldown
  timers are paused (so a long-running attack never lets others
  pile up readiness mid-flight, which would fire the next attack
  instantly on recovery end). Tie-break priority on simultaneous
  cooldown expiry: **ring burst > sweep > aimed > radial** — RB
  is the defining mechanic; sweep is the phase-2+ signature;
  aimed is point threat; radial is filler.
  **Mine field** runs as a *parallel* timer (phase 3 only) —
  spawns and detonations are NOT subject to mutual exclusion;
  the timer ticks in parallel with whatever attack the boss is
  running.
  - **Radial Burst** — 1.4 s total cycle: 0.4 s telegraph +
    single firing frame (12 bullets fanned at 350 px/s) +
    0.3 s recovery + 0.65 s idle gap. Spawns from the live
    boss position.
  - **Aimed Shot Trio** — 4.35 s total cycle. The telegraph line
    **tracks the live player position** through its 0.6 s window
    at a max angular velocity of `AIMED_MAX_ANGULAR_VEL = 3 rad/s`
    (`shortestAngleDiff` keeps the chase short around the ±π
    seam). Normal walking is tracked easily; a sideways dash late
    in the telegraph breaks the lock — that's the skill
    expression. The angle is captured at the telegraph → firing
    transition and held through the 0.45 s firing window
    (3 bullets fired 150 ms apart at 450 px/s) + 0.3 s recovery
    + 3.0 s cooldown. The telegraph draws a dashed line from the
    boss to the arena edge (10/8 dash pattern crawling at
    60 px/s, line glow 12) plus a 14 × 14 px diamond pulsing
    0.8 ↔ 1.2 at the player's distance projected along the
    tracked angle (the diamond literally chases the player). At
    the lock moment a 80 ms solid-line snap-flash confirms "angle
    locked, bullets coming." Each fired bullet pops an 8-particle
    muzzle flash at the boss centre.
  - **Sweep Laser** — phase 2+ only. **Double-pass cycle** —
    forward sweep then return — so the player has to dodge twice
    per attack. Sub-phases: **0.8 s telegraph** (full-arena
    sector preview at 0.10 ↔ 0.20 alpha pulse + dashed start-line
    + small direction triangle marking CW vs CCW; the return arc
    is intentionally NOT telegraphed — it's surprised through
    the mid-pause), **0.9 s firing-1** (fast 180° sweep from the
    captured start angle in the chosen direction), **0.8 s
    mid-pause**, **1.2 s firing-2** (slower 180° back to start
    angle, core white shifts to `#aaeeff` light cyan + streaming
    particles flip cyan as a subtle "this is the return pass"
    tell), **0.5 s recovery** (200 ms beam fade + 300 ms tail).
    Cooldown `SWEEP_LASER_BASE_COOLDOWN_SEC = 5 s × PHASE_CADENCE`
    from recovery end. Total damaging window = firing-1 +
    mid-pause + firing-2 = 2.9 s, all sharing the same ±0.04 rad
    collision band — including mid-pause, so the end-angle isn't
    a free safe-zone. Dash i-frames pass through any of the
    three. Beam emits one short particle every 50 ms travelling
    outward at 600 px/s so the energy reads as streaming.
    Mid-pause runs longer than the player dash cooldown
    (~640 ms after the ×1.6 boost), so the player can guarantee
    a second dash for the return pass. Return slower than
    forward by design — asymmetry creates a distinct read.
    Mid-pause visuals: ±0.05 rad render-only wiggle (sin period
    200 ms; doesn't affect collision) keeps the beam alive,
    core line-width breathes 6 → 14 → 6 on `easeInOutSine`,
    outer-glow alpha 0.15 → 0.45 → 0.15 in lockstep, white
    reverse-direction arrow at 80 px from boss fades in over
    100 ms then pulses 0.8 ↔ 1.4 scale on a 250 ms period. Final
    100 ms layer a countdown: arrow scales to ×1.6 with a fast
    1 → 0.4 → 1 alpha strobe and a chirp fires on the threshold
    crossing, so firing-2 entry is impossible to miss.
    **Light trail.** During firing-1 / mid-pause / firing-2 the
    beam leaves a fading pink arc (max age 400 ms; outer / mid /
    inner stroke stack in `#ff5577` / `#ff5577` / `#ffaaaa`).
    Trail capture uses the unwiggled `currentSweepBeamAngle()`,
    so mid-pause pushes pile at the static end-angle as
    "concentrated residue." When firing-2 starts, both arcs are
    on screen at once — the fading forward trail and the forming
    return trail — which is the highlight visual moment of the
    attack. Trail is render-only (no collision) and skipped in
    telegraph.
    **Recovery fade.** The beam doesn't snap off — staged opacity
    decay across glow layers: core fades by 250 ms (easeOutQuad,
    `1 - u²`), mid-glow by 400 ms (easeOutCubic, `1 - u³`), outer
    bloom by 500 ms (easeOutQuart, `1 - u⁴`). Trail entries keep
    aging through recovery and dissolve naturally inside the
    400 ms window. A pink release ring (`#ff5577`, r 24 → 180,
    lw 6 → 0.5, lifetime 500 ms) blooms at the boss centre at
    recovery start as visual punctuation. (Audio-side: the boss
    audio pass should later add an exponential drone-gain ramp
    to 0 over the 500 ms recovery; no continuous drone synth
    exists yet to fade.)
    (Conflict resolution with the other three attacks runs
    through the universal mutual-exclusion gate; sub-phases
    here don't count as a new attack — `isAnyAttackActive()`
    stays true across the whole cycle.)
  - **Mine field** — phase 3 only. Parallel timer (no mutex
    against the attack rotation). Once every `MINE_SPAWN_INTERVAL_SEC = 2.0 s`
    the boss drops a mine in a random arena point chosen to
    keep at least 200 px from the player and 150 px from the
    boss center; up to `MINE_SPAWN_MAX_ATTEMPTS = 8` rolls per
    cadence tick before giving up and trying again next frame.
    Cap of `MINE_MAX_ACTIVE = 5` simultaneous mines so the
    floor doesn't fill up. The cadence timer only resets on a
    successful spawn — a crowded arena keeps trying every frame
    once one detonates. Each mine telegraphs as a pulsing 30 px
    pointy-top hex outline for `MINE_TELEGRAPH_SEC = 1.5 s`
    (alpha grows from 0.4 to ~0.9 with a slow sin shimmer);
    the last 200 ms (`MINE_STROBE_SEC`) reads as a fast strobe
    so the detonation moment is unmissable. Detonation: 6
    bullets radial from the mine center (hex theme — vertex 0
    at top via `HEX_TOP_OFFSET_RAD`), speed 280 px/s; one
    accent shockwave (`#ff5577`, r 10 → 80, lw 6 → 0.5,
    400 ms); 8 particles 200–350 px/s; audio `hitHeavy`
    placeholder. The mine itself never deals contact damage —
    the player can stand inside the hex during telegraph
    safely. The threat is the bullets after detonation. Mines
    are reset to empty in `enterDying` so the death cinematic
    isn't interrupted by a late explosion (bullets already in
    flight from earlier detonations keep going; rooms-game
    owns them). The mine's hex outline echoes the boss
    silhouette to read as "the boss seeded these."
  - **Ring Burst** — phase 1's defining mechanic. The three
    shells detach + expand, the body goes ghosted, and the eye
    becomes the only damage path. Sub-state machine
    `idle / telegraph / detach / vulnerable / reassemble /
    recovery`. **Boss is stationary during all Ring Burst
    phases** (figure-8 movement gated on
    `ringBurstPhase === "idle"`; figurePhase keeps advancing in
    the background). On `recovery → idle` the boss snapshots
    its frozen position into `movementTransition` and over
    `MOVEMENT_TRANSITION_SEC = 1.5 s` blends the lemniscate
    target from that snapshot to the live curve point with
    `easeInOutCubic` — without this the ~7.6 s of accumulated
    figurePhase drift would teleport the boss back onto the
    curve the instant movement re-enables.
    Timings: telegraph 0.5 s (body jitter ±3 px, glow ramp
    ×1.6), detach 0.8 s (`easeInOutCubic` — slow start AND slow
    finish — rings ease from 110 / 85 / 60 → 180 / 130 / 95,
    body opacity 1 → 0.25, white 18-particle radial spray + r 60
    → 200 shockwave), vulnerable 5 s (eye hitbox r 20 active,
    body intangible, rings carry 1 HP contact damage in their
    thin band), reassemble 0.8 s (`easeInOutCubic`, radii ease
    back, body opacity 0.25 → 1, eye hitbox closes, rings still
    damage), recovery 0.5 s (no damage either direction), 6 s
    cooldown from recovery end to next telegraph. First RB has
    a 6 s grace from fight start. Reads as "slow inhale → long
    hold → slow exhale" instead of the bumpy easeOut/easeIn snap
    of the first draft.
    **Damage table during RB:**
    | Phase | Body dash | Eye dash | Body contact | Outer ring contact |
    | --- | --- | --- | --- | --- |
    | idle / telegraph / recovery | 1 HP boss | — | 1 HP player | — |
    | detach / reassemble | 0 (ghosted) | — | 0 | 1 HP player |
    | vulnerable | 0 (ghosted) | **3 HP boss** + heavy feedback | 0 | 1 HP player |
    Inside the outer ring (`r < 180` during vulnerable / reassemble)
    the player is safe — mid and inner rings are visual only.
    Reassemble still scrubs the outer ring back through anyone
    lingering in the 110..180 band, so a clean exit means either
    sit deep inside (then climb out before recovery solidifies the
    body) or dash out before the outer reaches you.
    The eye-hit reward layers a 8 px / 200 ms screen shake, an
    inner white + outer gold double ring, 24 alternating
    white / `#ffaa22` particles, and a hitstop —
    `sentinel.timeScale = 0.15` for 80 ms — so the world freezes
    a beat around each successful eye dash. Audio reuses
    `hitHeavy` + `alert` for layered shimmer.

    **Visual hierarchy during vulnerable / reassemble:**
    **Visual budget**: max 2 stacked strokes per element (glow +
    main). No `shadowBlur` on the per-frame body, ring, or eye
    paths. Internal hex circuitry, corner rivets, the eight iris
    radial spokes, and the third "shadow" depth-ring stroke were
    dropped after profiling — they were cosmetic, didn't carry
    gameplay information, and accounted for ~30 % of per-frame
    stroke operations on the boss. Particle counts on the same
    pass: RB detach 18 → 12, eye-hit halves 12 → 8, phase
    transition climax 32 → 20, radial-burst streamers
    24 → 12. The radial-burst's second (delayed) shockwave was
    also dropped — it overlapped with the first too much to
    earn its keep.
    - **Eye** is the brightest element. Compressed from 8 layers
      + 8 radial spokes to 4 layers (amber rim + dark base, red
      iris fill + outline, soft pupil halo, pupil core).
      Vulnerable adds a wide `#ffaa22` halo on top (r 44, lw 12)
      pulsing alpha 0.18 ↔ 0.40 synced to the breath, brightens
      the rim to `#ffbb33`, switches the pupil to neutral white,
      and runs an asymmetric breath cycle 0.90 ↔ 1.18 (mid 1.04).
      On detach → vulnerable a one-shot golden attention pulse
      expands r 24 → 110 over 600 ms.
    - **Outer ring** switches its render mode across Ring Burst.
      In `idle` / `attacking` / `telegraph` / `recovery` it's the
      "danger here" red shell: solid `#ff4455` bright lw 4 + a
      glow pass at lw 10 alpha 0.20, plus a slow bright-stroke
      alpha sub-pulse (period 1.1 s, range 0.85 ↔ 1.0). In
      `detach` / `vulnerable` / `reassemble` the same ring flips
      to **cyan dashed** — `#7dd3fc` bright lw 4 with a `[12, 8]`
      dash pattern + animated `lineDashOffset` at ~30 px/s, and
      a wider glow at lw 14 alpha 0.18 (cyan reads softer on the
      dark background, so the glow is bumped). Color crossfades
      over 300 ms at the telegraph → detach edge (red → cyan)
      and the reassemble → recovery edge (cyan → red, ticked
      across recovery's `rbTimer`). The dash pattern itself
      flips on/off discretely on those same edges — interpolating
      a dash pattern looks glitchy. The two `#ffffff` lw 5
      rotation markers (30° arcs at top + bottom) persist
      through both modes; on the red ring they read as notches,
      on the cyan ring they read as rotation indicators. The
      visual language matches the cyan dashed walls in the
      tutorial and Room 4 — "pass through with a dash, costs HP
      without i-frames" — collapsed into the same shell that
      already reads as the danger boundary.
      Implementation: `computeOuterRingDepth()` builds the
      `RingDepth` per-frame instead of picking from a static
      const; `RingDepth` gained a `brightDashOffset` field so
      the marching dash effect is config-driven.
    - **Mid + inner** desaturate to `#8a2030` / `#5a1020` at
      0.40 / 0.30 alpha so they read as background decoration.
      The mid ring keeps two short dim markers; the inner ring
      drops markers entirely and uses a dotted main stroke
      (`[2, 6]` dash pattern) so the rotation still reads
      without an extra pass. The cross-fade is driven by
      `dimRamp` 0..1 on `easeInOutCubic` across detach +
      reassemble — bright depth + dim depth are rendered with
      complementary alphas so the transition is smooth.
    - **Body** opacity drops to 0.12 in vulnerable (lerps to /
      from across detach + reassemble). Almost-ghost silhouette
      stays just visible enough for orientation.
    - **Reticle**: four N/E/S/W triangles around the eye centre.
      Idle params (red, alpha 0.4, base size) outside the burst;
      vulnerable bumps them to gold (`#ffaa22`), full alpha,
      ×1.4 scale — reads as "target acquired" brackets.
  **Contact damage** outside RB: touching the boss body (radius
  110, the outer shell) deals 1 HP, gated by player i-frames
  and dash i-frames — Sentinel.update sets a `requestPlayerHit`
  flag each frame the player overlaps and rooms-game's
  `consumeSentinelEffects` drains it into the standard `takeHit`
  pipeline. The same flag is reused by RB ring contact during
  detach / vulnerable / reassemble. The HP bar is pinned to the
  bottom of the viewport (`viewH - BOSS_HP_BAR_BOTTOM_PADDING_PX
  - barH`, label sitting `BOSS_HP_LABEL_GAP_PX` above the bar) so
  the player's eye stays on the arena instead of the corner; the
  HUD block at the top owns the ROOM/HP/SCORE row without
  competing for vertical space. The bar carries two thin vertical
  ticks at HP 40 and HP 20 — phase boundaries — that flash from
  alpha 0.4 → 1.0 → 0.4 over 300 ms when the matching transition
  fires. Sentinel exposes `phaseMarkerFlashTimer1to2` and
  `phaseMarkerFlashTimer2to3` for rooms-game to read.
- **dying** (6050 ms): triggered by `takeDamage` driving HP to
  0. `shouldFreezeWorld()` is true again — the death cinematic
  is the focus, but rooms-game keeps coasting the player (dash
  completion, friction, perimeter clamp, eye animation) so the
  body doesn't freeze mid-pose when the cinematic kicks in.
  `Sentinel.timeScale` ramps `1.0 → 0.3` over the first 200 ms,
  holds at 0.3 until 1000 ms, then eases back to 1.0 across the
  weakpoint window. Six fragments per ring spawn at 1000 / 1500
  / 2000 ms (line segments 20×4 px, 250 px/s outward, ±4 rad/s
  spin, 1500 ms life with a 500 ms fade-out). The central
  weakpoint scales 1 → 4 + glow 22 → 60 across 2500–3000 ms.
  Cinematic shake schedule: 4 px constant through the slow-mo
  hold (0–1000 ms), 3 → 12 px ramp through the buildup window
  (2200–3000 ms), 16 px / 250 ms one-shot at the detonation
  moment, then 1 px ambient settling tremor through the
  VICTORY hold (3500–6050 ms). During the buildup window the
  boss inhales — every 50 ms an absorption particle spawns on
  a r 140 ring around the death position and flies inward at
  250–400 px/s, so the detonation feels earned. At 3000 ms the
  detonation fires once: 32 radial particles split accent /
  white at 350–550 px/s, three concentric shockwaves stacked
  on the death position (accent r 20→200 lw 5→0.5 / 400 ms,
  white r 40→320 lw 7→0.5 / 600 ms, green r 60→520 lw 4→0.5 /
  900 ms — accent crashes out first, white follows, green
  drifts as the visual hand-off into VICTORY). The flash
  itself peaks at 0.95 alpha (was 0.7) at 3050 ms and fades to
  0 by 3300 ms. Audio: layered `hitHeavy` placeholder on the
  detonation. From 3500 ms to 5500 ms a sequence of five
  post-detonation **force waves** keeps pulsing outward across
  the arena under the VICTORY title — single thin rings
  (`POST_WAVE_LW_START 4 → POST_WAVE_LW_END 0.5`) with long
  lifetimes (1.0–1.3 s) and large end radii (600–850 px) so
  each wave actually sweeps the field. Colour cycle accent →
  white → green → accent → green hands the eye off to the
  green VICTORY palette. Each wave fires a 4 px / 120 ms
  percussive shake that wins against the 1 px ambient tremor
  via `triggerShake`'s max-amplitude rule. A green "VICTORY"
  title fades in over 3050–3350 ms with an `easeOutBack`-style
  scale pulse (0.85 → 1.05 → 1.0 over the same window) so the
  text lands with weight. The cinematic timer runs on
  `unscaledDt` so the slow-mo doesn't recursively slow the
  cinematic itself.
- **defeated**: terminal. `isDead()` flips to true. rooms-game's
  `reconcileSentinelTransitions` catches the transition and
  pops the Game Complete DOM overlay; runState flips to
  `"completed"`.

Score (`+15000`) is credited on the `idle/attacking → dying`
transition with a floating "+15000" tag at the boss centre. The
standard `emitEnemyKill` / `destroyEnemy` ring + particle FX is
skipped for the Sentinel because the dying state owns its own
visuals — `tryDashDamage` only lands during idle/attacking, so
the kill block in rooms-game never sees `isDead() === true` for
the Sentinel.

Restart and transitionToRoom both reset
`state.prevSentinelState`; a fresh Sentinel instance always
constructs in `"intro"`, so re-entering Room 5 plays the
intro from scratch.

#### Visual polish

- **Eye stack** — eight concentric layers (ext glow → amber rim →
  wine fill → red iris → inner ring → two hot-core whites → warm
  pupil) drawn outermost-first so the bright inner cores paint on
  top. Eight 0.8 px radial spokes in `#ff5577` between r 11 and
  r 18 sell the "alive iris." A 1400 ms breath cycle scales the
  whole stack 0.94 ↔ 1.06 and ramps the ext-glow alpha 0.10 ↔ 0.25
  in lockstep.
- **Hex shells** — the body silhouette is three nested **pointy-top
  hexagons**, not concentric circles. The hex path is built from
  six vertices on `radius * (cos a, sin a)` with vertex 0 at
  `-π/2` (top) and the rest spread on `π/3` increments; same
  helper (`traceHexPath`) is used for the optional outer-glow
  pass and the bright main stroke so the stroked shape stays
  consistent. Each shell renders as up to two stacked strokes
  (glow + main) — `RingDepth` configs in sentinel.ts pin the
  colours per shell. Each shell carries an independent rotation
  state (`angle / angularVel / targetAngularVel /
  nextChangeAtMs`) that lerps angularVel toward a fresh ±max-vel
  target every 2–5 s (max-vel: outer 0.8, mid 1.2, inner 1.6
  rad/s; lerp coefficient 0.02 per frame). Because the silhouette
  is now hex, that rotation is visible: the corners sweep instead
  of a flat circle pretending to spin. Rotation markers are small
  filled diamond rivets pinned to vertices (count = 2 by default
  → top + bottom; the helper distributes other counts evenly via
  `floor(i * 6 / count)`). Diamond side ≈ markerLineWidth × 1.8.
  The eye stack is intentionally still circular — the eye should
  read as an eye, not as a hex pupil.
- **Body breath** — 2200 ms sin scales the whole shell stack 0.98 ↔
  1.02 and ramps the outer-ring glow alpha 0.20 ↔ 0.35 on its own
  phase (independent of the eye), so the silhouette pulses out of
  sync with itself.
- **Energy burst** — fired on the radial-burst telegraph → firing
  transition. Two shockwaves push into rooms-game's shared
  `rings` list (shockwave 1 immediately, shockwave 2 after a 50 ms
  internal delay timer); a 80 ms additive white "boss flash"
  overlay paints on top of the shell stack; 24 alternating
  white / pink line streamers fly out radially at 400–550 px/s
  with a 250 ms life and a 100 ms fade-out tail. Streamers are
  kept on the boss instance (not the shared Particle list)
  because they're line segments oriented along velocity, which the
  Particle pipeline can't represent. `enterDying()` clears any
  in-flight burst remnants so the death cinematic is uncluttered.

## Enemy awareness system (`lib/enemies/awareness.ts`)

Every enemy starts in `idle` and won't fight back until the player
crosses its `detectionRadius`. The state machine has three steps:

  idle      — sleeping. Combat update is gated, so Turret only
              drifts its barrel to a random angle every ~3 s,
              Watcher just sits and lets its pupil bob, Hunter
              parks its velocity. Detection radius pulses faintly
              under the player's feet as a slate-blue dashed ring.
  alerting  — player just entered the radius. ALERT_DURATION_MS
              (500 ms) of pure visual telegraph. On the transition
              one ring-burst fan-outs from the enemy (start radius
              `hitboxRadius + 5` → end `hitboxRadius * 2 + 50`,
              line width 4 → 1, glow 18, lifetime 400 ms) + 6
              fast particles (200–350 px/s, 300 ms) + a single
              triangle-synth ping (`audio.play.alert()`). For the
              full 500 ms window the entire body **jitters** —
              `applyAwarenessJitter` adds a per-frame
              `ctx.translate(jx, jy)` whose amplitude ramps 1 →
              `ALERT_JITTER_INTENSITY_PEAK` (4 px) at
              `ALERT_JITTER_PEAK_TIME` (60 % of the window) then
              eases to `ALERT_JITTER_END_INTENSITY` (0.5 px) by
              the end. Detection ring stays steady through the
              jitter (it lives outside the enemy's transform).
  aggro     — combat behavior runs. For enemies whose
              `canDeaggro` is true (Turret + Watcher), the player
              leaving `detectionRadius * ENEMY_DEAGGRO_RADIUS_
              MULTIPLIER` (1.3) ticks `deAggroCooldownTimer`; once
              the timer hits `ENEMY_DEAGGRO_COOLDOWN_MS` (2000) the
              enemy returns to `idle` (alertTimer + cooldown timer
              both reset, Watcher re-anchors `idleHomeX/Y` to its
              current position so the next drift starts cleanly
              instead of snapping to a stale home). Re-entering the
              radius drops the cooldown back to zero. **Hunter
              leaves `canDeaggro` unset and stays aggro forever
              once seen** — that's the whole point of the chase
              archetype.

`updateEnemyAwareness` ticks the state machine each frame in the
rooms loop (before `enemy.update`, so combat sees the freshest
state) and accepts an optional `AwarenessTriggerCtx` (rings +
particles) so the burst on idle → alerting can drop straight
into the room's lists. `drawEnemyDetection` paints the dashed
detection ring with `(detectionRadius * 1.3 - dist) /
(detectionRadius * 0.5)` clamped visibility, capped at α 0.3,
and dims the ring by `DEAGGRO_RING_DIM_FACTOR` (0.7×) while a
de-aggro cooldown is ticking — quiet "losing interest" tell
without yelling at the player. Color shifts slate → orange →
enemy.color across the three states. `applyAwarenessJitter` is
called from each enemy's `draw` so the body shake stays sealed
inside the enemy's own transform stack.

Detection radii live in `config.ts` and are **fixed per archetype**
across the whole game — `ENEMY_TURRET_DETECTION = 600`,
`ENEMY_WATCHER_DETECTION = 700`, `ENEMY_HUNTER_DETECTION = 350`.
No per-instance override mechanism on purpose: the player learns
the wake distance once and it carries across every room.
Resets implicitly on `restartRun` because rooms are rebuilt with
fresh enemy instances; on room transitions the next room's
enemies arrive in `idle` for the same reason.

The HUD top-center renders **DETECTED** (red) if any enemy is
aggro, **ALERT** (orange) if any is alerting, otherwise nothing.
Text pulses via `sin(now)` so it draws the eye without being
loud.

## Camera system (`lib/camera.ts`)

Always-centred follow camera. `Camera` holds `{ x, y, targetX,
targetY }`; `updateCamera(camera, targetX, targetY, viewportW,
viewportH, bounds, lerp = 0.08)` lerps the camera toward
`target − viewport/2` so the player sits exactly in the centre of
the canonical viewport. The `bounds` argument is accepted for
backwards compatibility but is **not** used to clamp — there's no
edge stick. On rooms smaller than the viewport (Room 2, tutorial)
this means parts of the arena scroll off-screen when the player
moves; the player stays centred regardless. `snapCamera` forces
the camera to its current target — used at room transitions so
the entry frame doesn't whip-pan from the previous room.

Both rooms-game and tutorial-game wrap the world-drawing block in
`ctx.save() → ctx.translate(-camera.x, -camera.y) → ... →
ctx.restore()` unconditionally. HUD and full-screen overlays stay
in screen space (drawn after `ctx.restore()`). The `Room.useCamera`
flag still exists on the `Room` type for legacy data but no longer
gates any behaviour — every room now scrolls.

The background-energy and background-text passes use
`computeArenaBounds()` (in each game file) to derive the visible
arena rect in screen space; that rect now scrolls with the camera,
which means in small rooms the energy/text margins appear on
whichever side of the arena is currently off-centre.

## Keys system (`lib/keys.ts`)

Per-room key pickup that owns the unlock condition for its room
on its own — the carrier kill is the gate, and surviving
stragglers don't block the exit. `Key` is `{ x, y, collected,
age }`; `createKey` spawns at the kill site, `updateKey` advances
spawn pop + bob, `drawKey` renders a golden diamond + stem +
teeth with a neon glow, `checkKeyPickup(key, px, py)` is a 28 px
radius proximity check, and `drawKeyHudIcon(ctx, x, y, collected)`
paints the HUD slot (silhouette outline when not held, filled
gold when held).

Game flow: when an `Enemy.dropsKey` flagged enemy dies via
`emitEnemyKill`, rooms-game stamps `currentKey = createKey(e.x,
e.y)`. The frame loop ticks the key + checks pickup; on pickup
`keyHeld = true`, an "KEY ACQUIRED" floating text rises from
the player, and `audio.play.pickupGrab("hp")` plays as a
placeholder cue. `checkRoomCleared` has two unlock branches:
`door.requiresKey` opens on `keyHeld` alone, ignoring alive
enemies; non-key doors require every enemy in the room to be
dead (and every marker reached, in tutorial Room 0). `Door`
carries a `requiresKey` flag (default false); when true and
closed the door visual swaps the red X for a golden lock with
a keyhole. The HUD key indicator shows `0 / 1` (dim silhouette)
until pickup, then flips to `1 / 1` (filled gold).

### Watcher (`lib/enemies/watcher.ts`)

Slow chasing eye that telegraphs a laser shot on a long beat.
Fragile (HP 2) but dangerous at distance.

- 60 px diameter — outer white ring + translucent red iris
  (PALETTE.bullet @ 0.85α) + dark pupil + tiny highlight. Pupil
  tracks the player smoothly during idle / cooldown and snaps to
  the captured target during aiming / firing.
- Movement: chases the player at 220 px/s (≈0.5× default
  player.maxSpeed). Stops once within
  WATCHER_RADIUS + playerHalf + 20 so it doesn't shove the player.
  No wall collision yet — it can clip into walls (TODO).
- State machine: idle 1.5 s → aiming 1.2 s → firing 0.25 s →
  cooldown 0.8 s → idle. Audio cue (`audio.play.bulletBreak()`)
  plays on aiming → firing.
- Laser is spawned into the room's shared `lasers` array on
  idle → aiming with `endX/endY` captured at that instant; the
  beam doesn't follow the player. The laser self-expires after
  chargingDuration + firingDuration.
- **Idle behavior** — while `awarenessState === "idle"` the body
  drifts in a slow figure-eight around `idleHomeX/Y` (sin
  amplitudes 30 px X / 8 px Y, Y phase × 0.7 so the axes desync,
  drift period ≈ 7.8 s) and the pupil runs an idle-look pass:
  every 1–2 s pick a new offset (60 % near, 30 % mid, 10 % far,
  with a 15 % chance of dead-center "looking forward") and lerp
  toward it at `WATCHER_IDLE_PUPIL_LERP = 0.08`. On the
  idle → alerting transition the current position is latched as
  the new home so a future de-aggro returns to the alert spot,
  not the spawn. During alerting the body freezes and the pupil
  snaps to the player so the "I see you" read aligns with the
  "!" telegraph. Drift respects walls via
  `resolveEntityWallCollisions` (constants live in `config.ts`
  under `WATCHER_IDLE_*`).
- HP 2; only damage path is dash-through during the dash i-frame
  (one damage per dash session via `dashIdAlreadyDamaged`). Outside
  the dash i-frame, contact deals normal player damage.
- Death: +800 score, double ring (red outer + white inner), 12
  particles split between PALETTE.bullet and white,
  `bulletBreak` cue. `console.log("Watcher destroyed")` for tracing.
- **Friendly fire** — every Watcher beam carries a unique `Laser.id`
  and the room loop checks each living non-owner enemy against the
  beam segment during the firing window. A hit (within
  `enemy.hitboxRadius + 8 px`) is deduped per laser via the
  enemy's `hitByLaserId` so a single firing only credits one hit
  per target. On a non-fatal hit the standard MEDIUM impact runs
  (white flash, knockback along the beam, ring + particles +
  shake + `audio.play.hitMedium()`). On a fatal hit the kill burst
  fires (`emitEnemyKill` + score from `destroyEnemy`) and the
  player gets a flat `FRIENDLY_FIRE_BONUS = 200` on top with a
  "FRIENDLY FIRE" floating text — luring an enemy onto the beam
  is intentional play, not a glitch.

### Wall collisions for moving enemies

`lib/walls.ts` exposes `resolveEntityWallCollisions(entity, walls,
halfSize)` — generic AABB resolve (entity needs `{ x, y, vx, vy }`)
that pushes the entity out of any wall along the smallest
penetration axis and zeroes the matching velocity component so
it slides along the wall instead of locking. The previous
`resolvePlayerWallCollisions` is now a thin alias. Watcher and
Hunter call this after their move integration in `update()`,
using their hitbox radius (Watcher 30, Hunter 14). Walls are
exposed on `EnemyContext.walls` so each enemy can consume the
current room's walls without rooms-game routing.

### Hunter (`lib/enemies/hunter.ts`)

Inertial chaser — fast, fragile, can't turn instantly.

- Body is a 4-vertex arrow polygon (`(-22,-12), (22,0), (-22,12),
  (-10,0)` in local space) painted with a translucent fill +
  neon outer stroke; rotated by `atan2(vy, vx)` so it always
  points along its motion.
- Physics: accelerates toward the player at 1500 px/s², capped at
  `1.2 × player.maxSpeed` (≈528 at default settings). No wall
  collision — Hunter clips through walls (TODO, same as Watcher).
- Visual reactions to speed: when |v| > 250 the body stretches
  1.15 × 0.9 along motion (bullet shape); 2 short speed lines
  trail behind below 200 px/s, 4 lines of varied length above.
  Outer-stroke glow blur ramps from 12 (idle) to 20 (max speed).
- Damage: HP 1, dies on a single dash-through (`+600 score`).
  Contact outside i-frames deals 1 damage to the player and the
  Hunter bounces (`vx,vy *= -0.5`) with a 100 ms perpendicular
  squeeze so it doesn't camp on the player while i-frames tick
  down. The bounce wires through `Enemy.onContactDamage()` —
  optional method on the Enemy interface that rooms-game calls
  right after `takeHit()` in the contact loop.
- Death: orange ring, 16 orange particles 300–450 px/s,
  `bulletBreak` cue, `console.log("Hunter destroyed")`.
- **Idle behavior** — while `awarenessState === "idle"` the
  Hunter swims a slow parametric curve around a latched
  `idleHomeX/Y`. Each Hunter picks one of three path types at
  construction (`figure8` Lissajous lemniscate, `oval` 1.0:0.55
  ellipse, plain `circle`), a random size in 50–90 px, and a
  random rotation 0..2π — so a roomful reads as a flock of fish
  in distinct curves rather than identical orbits. Phase advances
  at `HUNTER_IDLE_PATH_SPEED = 0.4 rad/s` (full loop ≈ 15 s);
  the body lerps toward the curve point with
  `HUNTER_IDLE_LERP_FACTOR = 0.08`, giving a slight trailing drag
  that reads as natural inertia. Body angle smooths toward the
  trajectory tangent via `HUNTER_IDLE_ANGLE_LERP = 0.15`. Trail
  is intentionally KEPT visible in idle but tuned softer
  (`HUNTER_IDLE_TRAIL_INTERVAL_MS = 50`, max α 0.4, glow blur 6)
  so it reads as a hypnotic motion ghost; aggro keeps the
  punchier defaults (25 ms / α 0.6 / glow 8) via the same
  `emitTrailSample` helper. Speed lines are visible in idle as
  the same 2-line layout used at low aggro speeds, dimmed to α
  0.4. Outer-stroke glow drops to `HUNTER_IDLE_GLOW_BLUR = 10`
  to keep the chase visually louder than the patrol.
  `idleHome` re-anchors on idle → alerting transition so a
  future de-aggro returns to wherever it was alerted, not the
  spawn. Constants live in `config.ts` under `HUNTER_IDLE_*`.

### Lasers (`lib/enemies/types.ts`)

Beam entities owned by the room, not by individual enemies, so any
future enemy can stamp a laser. Self-expire by total age:

```ts
type Laser = {
  ownerType: "turret" | "watcher";
  startX, startY: number; // captured at spawn
  endX, endY: number;     // captured at spawn
  chargingDuration: number;
  firingDuration: number;
  age: number;
  dodgedByDashId?: number;
};
```

Render: charging draws a thin red line whose alpha + width grow
with age and flicker via `sin(age * 15) * 0.1`; firing draws a
12 px outer beam with a 4 px white-hot core and brighter glow.
Collision is a point-to-segment distance check against the player
center; only the firing window deals damage.

- Player hit while not in any i-frame: `takeHit()` plus a 200 ms
  4 px screen shake (room transform only, HUD is unaffected).
- Player crosses laser during dash i-frame: no damage, +50 score
  credited once per (laser × dash) pair via `dodgedByDashId`.

### Enemy interface (`src/lib/enemies/types.ts`)

```ts
interface Enemy {
  x: number;
  y: number;
  hp: number;
  isDead(): boolean;
  takeDamage(amount: number): void;
  update(ctx: EnemyContext): void;       // sees dt, player, bullets, FX lists
  draw(ctx: CanvasRenderingContext2D): void;
  overlapsPlayer(px, py, half): boolean; // contact damage check
  tryDashDamage(dashId, px, py, half): boolean; // dedupes per dash
}
```

`Turret` is the first implementation. Future enemies (sweeper,
ring-burst, aimed-shot, etc.) plug into the same interface.

### Run state (rooms-game.ts)

- HP starts at 3, +1 second i-frames after a hit, 200 ms red corner
  vignette. No multiplier and no near-miss / dash-through scoring in
  rooms — score is intentionally rare here.
- Score events: turret kill = `+500` (constant in
  `rooms-game.ts:TURRET_KILL_SCORE`).
- Run ends only on `hp <= 0` (no timer). End overlay shows score,
  best-this-mode, and a `TRY AGAIN ↵` button. Best is stored under
  `dash-proto:rooms-best` (separate from sandbox per-config bests).
- Esc / Tab opens the rooms-only **pause menu** (see below).
  Settings live in the sandbox build only — rooms doesn't expose
  the settings overlay.

### Pause menu (rooms only)

`src/rooms/pause-menu.ts` — DOM overlay independent of the sandbox
settings overlay. Triggered by Esc / Tab via the existing menu1 /
menu2 bindings. Three buttons:

- `RESUME` — closes the overlay, resets `lastTime` to
  `performance.now()` so the deltaTime doesn't jump after a long
  pause.
- `RESTART` — closes the overlay, calls `restartRun()`, also resets
  `lastTime`.
- `QUIT TO MENU` — `window.location.href = "/"` back to the
  landing page.

While the overlay is open the rooms frame loop short-circuits — no
sim updates, no enemy fire, no bullet movement, audio events stop
firing on their own (no `Tone.Transport`-style pause is needed).
Footer text: "Settings only available in Sandbox mode" so the
absence is explicit. Sandbox is untouched and keeps the full
settings overlay on Esc / Tab.

### What's done

- Room 1 with one turret, closed door, clear → open → transition.
- Room 2 placeholder.
- Walls (`lib/walls.ts`), Door (`lib/door.ts`), Enemy interface +
  Turret (`lib/enemies/`).
- Bullet trail + neon player rendering reused from the sandbox path.
- Hit / dash / dash-through audio cues reused; placeholder
  room-cleared sting via `audio.play.multUp(5)`.
- Failed-run overlay + Try Again, best score persisted.

### TODO (rooms direction)

- **Sentinel boss** — Phases 1 + 2 + 3 ship. Phase 1 has three
  attacks (radial / aimed / Ring Burst); phase 2 adds Sweep
  Laser; phase 3 adds **Mine field**. Cadence multiplier ramp +
  the 2 s phase-transition cinematic are wired across both
  boundaries.
  **Mechanic engagement is mandatory**: HP_MAX 60 with the body
  invulnerable outside RB-`vulnerable`, so the eye in Ring Burst
  is the *only* damage path. Boss audio for sweep laser / phase
  transition / Ring Burst telegraph / mine detonation still
  reuses `alert` / `hitHeavy` placeholders — proper layered
  synths (drone for sweep, dedicated mine pop) are the next
  iteration.
- **Key icon visual polish** — the `drawKey` glyph is a diamond
  + stem; readable but a bit primitive. A more iconic key shape
  (or a proper sprite) would improve the HUD slot too.
- **Laser sound** — Watcher reuses `audio.play.bulletBreak` for
  the firing cue; needs its own dedicated synth (saw sweep + noise
  burst would read cleanly).
- **More rooms.** Authoring pattern: one `buildRoomN()` factory per
  room, registered in `rooms-game.ts`. Eventually a small data file
  describing pattern timelines.
- **Pattern primitives** as Enemy variants or shared helpers: wave,
  ring burst, sweep, aimed shot. Compose into "encounters" that the
  turret-style entity replays.
- **More enemy types**: sweeper (linear path), spinner (rotates and
  fires from multiple barrels), boss with phase changes.
- **Real room-cleared sting** — not the multiplier-up cue.
- **Room intros / outros** — short pre-fight beat instead of "fight
  starts when the door slides shut".
- **HUD polish**: reads as a sandbox-style block right now; rooms
  could use a slimmer one (no MULT, no TIME).
- **Sandbox + rooms shared particle helpers**: rooms-game has its own
  inline trail / FX update + render; once both are stable, lift the
  shared parts into `lib/particles.ts`.

### TODO (sandbox direction)

- Audio: real music channel + adaptive layering on multiplier tier.
- HUD pass once the visuals settle (currently deliberately untouched
  through the neon work).
- Replays / score export so a run can be shared.
- Wider settings menu coverage for the new tunables (run duration is
  surfaced; some breaker / shield internals aren't yet).
- Performance: spatial hash if `maxBullets` regularly exceeds ~150.

## Impact feedback system

Three intensity tiers for "successful hit" cues, plumbed through
`src/lib/impacts.ts`. Each emit function takes an `ImpactContext`
holding live references to the room/run's particle and ring lists
plus two callbacks (`triggerShake`, `triggerScreenFlash`) — the
caller wires those to whatever shake/flash state it owns.

- **LIGHT (`emitBulletHit`)** — dash-through pellet. White flash
  ring (16 px lifetime 80 ms) + 6 bullet-color particles + a
  bit-crushed `audio.play.hitLight()` "tic". No screen shake or
  global flash. Sandbox calls this from `awardDashThrough` so
  rapid pellet hits stay pleasant.
- **MEDIUM (`emitEnemyDamage`)** — dash-through landed but the
  enemy is still alive. Sets the enemy's `hitFlashTime` (white
  silhouette overlay) and a render-only knockback offset for
  200 ms in the direction (enemy − player). Spawns an enemy-color
  ring (30 → 70 px) + 8 enemy-color particles, triggers a 4 px
  100 ms shake, and plays `audio.play.hitMedium()` (lowpass +
  distorted membrane "thwak").
- **HEAVY (`emitEnemyKill`)** — kill blow. Stamps a final 100 ms
  hit flash on the dying enemy so its silhouette flashes white
  one frame, then spawns concentric rings (white inner 40 →
  100 px / enemy-color outer 30 → 160 px), 16 enemy + 8 white
  particles, a 7 px 180 ms shake, and a global 60 ms 0.15-alpha
  white overlay. Audio is a layered membrane + bandpassed noise
  burst (`audio.play.hitHeavy()`).

Enemies expose four impact-related fields that the system reads /
mutates (`color`, `hitFlashTime`, knockback peak/time/duration).
Per-frame the room loop ticks `hitFlashTime` and `knockbackTime`
even on destroyed enemies so the post-kill flash silhouette can
fade naturally; the silhouette renders as a pure white
`globalCompositeOperation: "lighter"` fill of each enemy's body
shape (helpers in `src/lib/enemies/fx.ts`). Knockback is
render-only — `applyEnemyKnockback` just emits a
`ctx.translate(offX, offY)` at the start of each enemy's draw,
fading to 0 across `knockbackDuration`. Shake and screen flash in
rooms live on `state.screenShake* / screenFlash*` triplets
(remaining + initial + amount/opacity); render reads them and
draws a translate / overlay rect respectively. Tunables are all
in `config.ts` under `IMPACT_*`.

### TODO (project)

- Main menu / mode select polish (currently a static landing).
- Migrate the rooms inline particle/render helpers into `lib/` once
  sandbox is willing to use them too.

## Background energy (`lib/background-energy.ts`)

Animated atmosphere that lives BEHIND the playfield, visible only
in the canvas margins where the world doesn't render. Shared
across rooms / tutorial / sandbox; a single `EnergyBackground`
instance is created at `start()` and persists for the whole
session (no reset on room transitions, so the streams keep
flowing).

Three layers, all in screen space:

- **Drifting lines** — 10 thin neon segments (length 80–150 px,
  thickness 1.0–1.5 px, glow blur 4, mix of cyan `#00e5ff` /
  purple `#7a5fff`) drift at random angles at 20–40 px/s, each
  pulsing its alpha 0.05 ↔ 0.18 on a 3–5 s sine. When a line
  walks off the canvas it respawns just outside a random edge.
- **Rising particles** — 25 small 1–2 px dots (cyan with the
  occasional white, alpha 0.10–0.25, glow blur 3) rising at
  30–60 px/s. Horizontal position oscillates ±8–15 px around an
  anchor on a 2–4 s sine so they read as drifting in a current.
  When a particle leaves the top edge it respawns just below the
  bottom at a fresh random x.
- **Lightning** — every 10–20 s a 200 ms horizontal streak
  (2 px thick, alpha 0.4, glow blur 10, white or bright cyan)
  flashes across a random y line. One at a time; the cycle is
  free-running independent of player input.

Rendering takes `ArenaScreenBounds` (rect in screen-space CSS
pixels where the visible arena renders). The function builds a
two-rect even-odd clip (full viewport minus arena) so all three
passes draw only in the margin. If the arena rect covers the
entire viewport the function short-circuits early.

`ArenaScreenBounds` is computed per-frame in each game's render:

- Non-camera rooms (canonical 1200×800): the arena fills the
  letterbox, so `arenaBounds = { offsetX, offsetY, 1200*scale,
  800*scale }` — only window letterbox bars show energy.
- Camera rooms (Room 1 corridor 3600×600, Room 4 corridor
  8000×700, Room 5 boss arena 1600×1200): when world width or
  height is smaller than canonical, `updateCamera` centers and
  leaves a band visible at top/bottom. The visible-world
  rectangle in canonical space is `[max(0, -camera.x),
  max(0, -camera.y)]` to `[min(1200, worldW - camera.x),
  min(800, worldH - camera.y)]`; that converts to screen via
  the same letterbox transform. The remaining canonical space
  (top + bottom bands in Room 1, all four sides in Room 5 if
  the window aspect is wide) lights up with energy.
- Sandbox runs full-screen with no letterbox or camera, so the
  arena bounds always cover the entire viewport and the module
  short-circuits. Kept integrated for parity — if a future
  playfield rect lands, the margins light up automatically
  without a code change in the sandbox loop.

Constants live in the module file. The render path uses
`ctx.shadowBlur` once per pass (lines, particles, lightning),
not per entity, so the per-frame cost is three configured passes
of simple `stroke` / `fillRect` calls.

## Background text (`lib/background-text.ts`)

Cyberpunk-terminal phrases that type themselves out in the same
margins as the energy background. Shared across rooms / tutorial /
sandbox; one `BackgroundTextState` per session.

Pool of ~60 short phrases mixing system messages
(`SYSTEM.BOOT_OK`, `0xFF2D55 // FALLBACK`, `PING 47ms`),
lore-suggestive lines (`witness protocol active`, `sentinel
approaches`, `walls do not hold them`) and cryptic strings
(`i see you i see you`, `the geometry forgets`, `glass cascade`).
Each spawn picks one uniformly.

Cadence and tuning live in `lib/config.ts` as `FLOATING_TEXT_*`
constants (spawn interval 3–7 s, max 4 concurrent, typing 50 ms
per char, stable 3–5 s, fadeout 800 ms, font size 11–16 px,
cursor blink 400 ms, spawn retry limit 5).

Per-word state machine:

- **typing** — characters are revealed at the configured speed,
  trailing cursor (`_`) blinks 50/50 at the configured period.
  Color is picked at spawn with weights 70 % cyan (`#00e5ff`
  α 0.35), 15 % red (`#ff2d55` α 0.30), 15 % white (α 0.25). Glow
  blur 4 in the text color.
- **stable** — full text held for 3–5 s, cursor keeps blinking.
- **fadeout** — alpha linearly drops from `maxAlpha` to 0 across
  800 ms (cursor hidden), then the word is removed.

Spawn placement: tries up to `FLOATING_TEXT_SPAWN_RETRY_LIMIT`
random positions whose pre-measured bbox doesn't intersect the
arena rect. If no placement fits (e.g. sandbox where the arena
covers the entire viewport) the spawn is skipped and the timer is
clamped to a short retry interval so the loop keeps trying.

The draw path applies the same even-odd clip the energy
background uses, so even if a word survives a window resize
that shrinks the margins, the text stays masked to the visible
margin area.

`ctx.letterSpacing = "2px"` is set per draw — supported in all
modern Chromium / Safari / Firefox builds; older browsers ignore
the property silently, the visual spacing is slightly tighter
but alignment stays correct.

## Working rules

- **Commit before large changes.** Always tag a checkpoint (`git tag` or
  `git commit --allow-empty -m`) before a feature that touches multiple
  modules so we can `git reset --hard` cleanly. We've been disciplined
  about this — keep doing it.
- **Stage explicitly, not `git add .`** unless the working tree is
  clean and you've verified there's nothing surprising. Build artifacts
  (`dist/`) and editor files should not be staged.
- **Type-check before commit**: `pnpm build` runs `tsc && vite build`,
  which is the canonical gate. `npx tsc --noEmit` is the fast loop.
- **Pickups drop only from dash-through bullets**, not from broken
  bullets (`awardBulletBreak`). Adding a drop roll there would create a
  self-sustaining fountain — verified during the Bullet Breaker design.
- **Settings is the single source of truth** for the tunables it
  exposes. Don't hard-code tunables in sandbox-game when there's a
  Settings field; read at point of use so the menu controls
  everything live. **Player and dash physics are intentionally NOT
  in Settings** — they're file-level constants in `lib/config.ts`
  (`PLAYER_*`, `DASH_*`) so all modes share the same hero. **Keybinds
  are also out of sandbox Settings** — they live in a separate
  global profile in `dash-proto:keybinds:v1`, configured via the
  Controls overlay on the landing page, and apply to all modes.
  Sandbox Settings now holds only sandbox-tunable mechanics
  (bullets, run length, pickups, audio).
- **Live tweaking via the menu is sacred.** Sliders / color pickers
  must propagate without restart. Keybinds propagate via the
  `storage` event each game subscribes to, so a rebind on the
  landing page applies live (across tabs too). If you add a new
  setting, also add the slider — or note explicitly why it's
  deferred.
- **`PALETTE` in `lib/palette.ts` is the only place colors live.** New
  colors go there; existing inline colors should migrate when touched.
- **Audio init must be lazy.** Tone.js requires a user gesture, so
  `audio.init()` is called from keydown / click / menu interactions.
  Never call from module load.
- **No DOM for game-world UI.** HUD, floating scores, end overlay, hit
  vignette — all canvas. Settings menu and the landing page are the
  agreed exceptions.
- **`localStorage` keys are stable.** `dash-proto:settings:v5`,
  `dash-proto:keybinds:v1`, `dash-proto:player-profile`, and
  `dash-prototype:score:*` should not change without a migration
  in `lib/config.ts` `migrate()` (or the equivalent in the
  relevant module). The v3 → v4 → v5 chain is the live example:
  v3 → v4 stripped the player + dash physics; v4 → v5 lifted the
  `bindings` field into its own profile module so the Controls
  overlay can configure it globally. Migration writes the new
  shape and deletes the old key on first boot.
- **Don't break sandbox while building rooms.** Rooms gets its own
  `GameState`; lib helpers stay pure. Anything that becomes
  cross-mode lives in `lib/`.
- **Keep `pnpm dev` running** during work; HMR catches broken imports
  and TS issues immediately, faster than running tsc on every save.

## Dev tools

`F1` in `rooms.html` and `tutorial.html` opens the dev menu — a DOM
overlay (`src/lib/dev-menu.ts`) with two sections:

- **GOD MODE** — toggle button reads / writes the same flag the
  damage paths gate on (`isGodMode()` / `setGodMode()` in
  `src/lib/god-mode.ts`). Toggle reflects live in the HUD via
  `drawGodModeBadge`.
- **TELEPORT** — one button per mode-specific room. Routes through
  the existing `transitionToRoom()` so all the side effects
  (camera snap, room rebuild, Sentinel intro, etc.) match a normal
  door crossing. The button for the current room is highlighted +
  disabled. While `runState !== "playing"` (failed / completed
  overlays up) every teleport button is disabled so the dev tool
  can't sneak past run state.

Sandbox does not get the dev menu — no rooms to teleport to and
god mode there is wired the old way (`installGodModeToggle()`,
direct F1 listener in `src/lib/god-mode.ts`).

Neither the menu's open-state nor the god-mode flag is persisted
to `localStorage`. Every reload starts with the menu closed and
god mode off, so dev tweaks can't leak into a built session.

The frame loop short-circuits while the dev menu is open
(`if (menu.isOpen() || devMenu.isOpen()) { render(); return; }`)
so the world freezes behind the overlay.
