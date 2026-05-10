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
                        (arena) + Room 3 placeholder
    room1.ts / room2.ts / room3.ts
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
| Player size | 32 px | `player.size` |
| Player max speed | 440 px/s | `player.maxSpeed` |
| Walk-speed factor (Shift) | 0.4 | `player.walkFactor` |
| Dash distance | 120 px | `dash.distance` |
| Dash duration | 120 ms | `dash.durationMs` |
| Dash i-frames | 150 ms | `dash.iframesMs` |
| Dash cooldown | 400 ms | `dash.cooldownMs` |
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

Storage key: `dash-proto:settings:v3`. Per-config best-score keys:
`dash-prototype:score:Default|Easy|Normal|Hard`.

## Main menu structure

`index.html` is the landing page that picks between the modes and a
couple of side panels. Same neon palette as the rest of the game,
zero framework — pure HTML / CSS / a small TS module
(`src/landing/main.ts`).

Layout: a 2×2 grid of cards under the DASH title.

| card     | accent             | action                                             |
| -------- | ------------------ | -------------------------------------------------- |
| SANDBOX  | purple `--player`  | `<a href="/sandbox.html">`                         |
| ROOMS    | cyan `--player-dash` | `<a href="/rooms.html">`                         |
| PLAYER   | yellow `#ffd60a`   | opens the Player overlay                           |
| ABOUT    | neutral `--text`   | opens the About overlay                            |

Both overlays share the same dark backdrop (`rgba(10,14,26,0.92)` +
backdrop-filter blur), a centered frame, an `×` corner button that
closes without saving, and an Esc handler. Tab is preventDefault'd
while an overlay is open so focus doesn't leak under the modal.

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

### About overlay

A monospace text block with the controls cheat sheet and a CLOSE
button. Static — no animation, no state.

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
  `USE [W][A][S][D] TO MOVE`.
- **Phase 2 — dash.** Markers cleared, replaced with a single
  goal at (900, 400) and a vertical 30 × 800 wall obstacle at
  x = 585 spanning the entire arena height — the player
  literally cannot walk around it. The wall is permeable while
  the player is in dash i-frames — the engine filters
  `room0DashWall` out of the wall list passed to
  `resolveEntityWallCollisions` when `dashIframeTime > 0`.
  Hint reads `PRESS [X] TO DASH`. On phase transition the wall
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
viewH - 80`). Text is parsed for `[X]` patterns which render as
white keycap rectangles. Show / hide animations slide 8 px and
fade over 300 / 200 ms. Visual is intentionally restrained —
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

The campaign now starts at **Room 1 (corridor)**, displayed in
the HUD as `ROOM 1 / 2`. Room 2 is the arena. Room 3 is the
next-up placeholder past the campaign ("coming soon" message);
the HUD counter holds at `2 / 2` once the player steps into it.
On launch the engine checks
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
  it stays closed until both every enemy is dead AND the player
  picked up the key. On clear: door switches to "open" arrow,
  +5 mult-up sting, → Room 2.

### Room 2 — arena with circular defence

1400×900 open arena teaching tactical positioning + the friendly-
fire mechanic on the Watcher's beam.

- Four **Turret**s in the corners at (250, 250), (1150, 250),
  (250, 650), (1150, 650). One **Watcher** in the centre at
  (700, 450) with `dropsKey = true`. All enemies wake on their
  own detection radii; the player can sneak up on individual
  turrets if they take a wide path.
- Four **column** walls (50×200) at (500, 350), (850, 350),
  (500, 550), (850, 550). They're plain `Wall` entries so the
  existing bullet-vs-wall filter and the laser raycast both clip
  on them — pellets disappear on contact, the Watcher's beam
  shortens to whichever column it crosses first.
- The friendly-fire teaching: the `refreshLaserEndpoints` raycast
  in `rooms-game.ts` already iterates every wall and picks the
  nearest hit, and the friendly-fire scan uses
  `pointSegmentDistanceSq` against the *clipped* segment — so a
  turret behind a column relative to the Watcher is safe, but
  positioning the player so the Watcher fires through an open
  lane to a turret kills the turret for free.
- The Watcher carries the key — its kill spawns a Key in the
  centre. Door at (1385, 450) is `requiresKey: true` and stays
  closed until the key is collected AND every enemy is dead.
  `useCamera = true` (1400×900 ≥ 1200×800 viewport letterbox).
  Spawn at (200, 450). On clear → Room 3 placeholder.

### Room 3 (placeholder)

- 1200×800 closed border, no enemies, no door,
  `message: "Room 3 — coming soon"`. Confirms the Room 2 → Room
  3 transition while real Room 3 content is in flight.

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
  aggro     — combat behavior runs as before. Sticky — once aggro,
              the enemy stays aggro for the rest of the run; a
              `radius * 1.5` regress was considered and skipped to
              keep the code small.

`updateEnemyAwareness` ticks the state machine each frame in the
rooms loop (before `enemy.update`, so combat sees the freshest
state) and accepts an optional `AwarenessTriggerCtx` (rings +
particles) so the burst on idle → alerting can drop straight
into the room's lists. `drawEnemyDetection` paints the dashed
detection ring with `(detectionRadius * 1.3 - dist) /
(detectionRadius * 0.5)` clamped visibility, capped at α 0.3.
Color shifts slate → orange → enemy.color across the three
states. `applyAwarenessJitter` is called from each enemy's
`draw` so the body shake stays sealed inside the enemy's own
transform stack.

Detection radii live in `config.ts` and are **fixed per archetype**
across the whole game — `ENEMY_TURRET_DETECTION = 400`,
`ENEMY_WATCHER_DETECTION = 500`, `ENEMY_HUNTER_DETECTION = 350`.
No per-instance override mechanism on purpose: the player learns
the wake distance once and it carries across every room. Values
are tuned against the longest-range room (the Room 1 corridor)
so corner enemies still wake before the player is on top of
them. Resets implicitly on `restartRun` because rooms are
rebuilt with fresh enemy instances; on room transitions the
next room's enemies arrive in `idle` for the same reason.

The HUD top-center renders **DETECTED** (red) if any enemy is
aggro, **ALERT** (orange) if any is alerting, otherwise nothing.
Text pulses via `sin(now)` so it draws the eye without being
loud.

## Camera system (`lib/camera.ts`)

Follow camera with viewport clamping. `Camera` holds `{ x, y,
targetX, targetY }`; `updateCamera(camera, targetX, targetY,
viewportW, viewportH, bounds, lerp = 0.08)` lerps toward
`target − viewport/2` clamped to `[bounds.minX, bounds.maxX −
viewportW]` (same for Y). When `maxX < minX` (world smaller than
viewport) the helper centers instead of oscillating. `snapCamera`
forces the camera to its current target — used at room
transitions so the entry frame doesn't whip-pan from the previous
room's camera position.

rooms-game opts into the camera per-room via `Room.useCamera`. In
the render loop the world drawing block is wrapped in
`ctx.save() → ctx.translate(-camera.x, -camera.y) → ... →
ctx.restore()` so HUD and full-screen overlays stay in screen
space. Non-camera rooms (1, 2, 3, 5 placeholder) skip the wrap
entirely and treat world coords as canvas coords 1:1.

## Keys system (`lib/keys.ts`)

Per-room key pickup that gates the exit door alongside "all
enemies dead". `Key` is `{ x, y, collected, age }`; `createKey`
spawns at the kill site, `updateKey` advances spawn pop + bob,
`drawKey` renders a golden diamond + stem + teeth with a neon
glow, `checkKeyPickup(key, px, py)` is a 28 px radius proximity
check, and `drawKeyHudIcon(ctx, x, y, collected)` paints the
HUD slot (silhouette outline when not held, filled gold when
held).

Game flow: when an `Enemy.dropsKey` flagged enemy dies via
`emitEnemyKill`, rooms-game stamps `currentKey = createKey(e.x,
e.y)`. The frame loop ticks the key + checks pickup; on pickup
`keyHeld = true`, an "KEY ACQUIRED" floating text rises from
the player, and `audio.play.pickupGrab("hp")` plays as a
placeholder cue. `checkRoomCleared` skips the open transition
while `door.requiresKey && !keyHeld`, even if all enemies are
dead — so the player must collect before exiting. `Door` gained
a `requiresKey` flag (default false); when true and closed the
door visual swaps the red X for a golden lock with a keyhole.

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

- **Room 3** — currently a "coming soon" placeholder past the
  arena; needs real content (likely the next mechanic
  introduction or a multi-encounter sequence).
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
- **Settings is the single source of truth.** Don't hard-code tunables
  in sandbox-game when there's a Settings field; read at point of use so
  the menu controls everything live.
- **Live tweaking via the menu is sacred.** Sliders / color pickers /
  keybinds must propagate without restart. If you add a new setting,
  also add the slider — or note explicitly why it's deferred.
- **`PALETTE` in `lib/palette.ts` is the only place colors live.** New
  colors go there; existing inline colors should migrate when touched.
- **Audio init must be lazy.** Tone.js requires a user gesture, so
  `audio.init()` is called from keydown / click / menu interactions.
  Never call from module load.
- **No DOM for game-world UI.** HUD, floating scores, end overlay, hit
  vignette — all canvas. Settings menu and the landing page are the
  agreed exceptions.
- **`localStorage` keys are stable.** `dash-proto:settings:v3` and
  `dash-prototype:score:*` should not change without a migration in
  `lib/config.ts` `migrate()`.
- **Don't break sandbox while building rooms.** Rooms gets its own
  `GameState`; lib helpers stay pure. Anything that becomes
  cross-mode lives in `lib/`.
- **Keep `pnpm dev` running** during work; HMR catches broken imports
  and TS issues immediately, faster than running tsc on every save.
