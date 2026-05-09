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
    sandbox-game.ts   — owns the entire sandbox GameState (HP, score,
                        multiplier, bullets, pickups, particles,
                        rings, floating texts, end snapshot, …),
                        rAF loop, input, render, end overlay, HUD
  rooms/
    main.ts           — entry; locates #app and calls start()
    rooms-game.ts     — placeholder loop that draws "ROOMS / coming soon"
                        in the same neon palette
sandbox.html          — Sandbox page (`/src/sandbox/main.ts`)
rooms.html            — Rooms page (`/src/rooms/main.ts`)
index.html            — Landing page with neon DASH title and two buttons
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

## TODO

Near-term (Rooms direction):

- **First room** — define the Room data shape (intro, scripted bullet
  patterns, exit conditions). Probably JSON-ish authored in TS.
- **Pattern primitives** — wave, ring burst, sweep, aimed shot. Each
  parametric, composable on a timeline.
- **Turret entity** — stationary spawner that fires patterns; first
  hostile that's more than a wall.
- **Main menu / room select** — replace the placeholder rooms stub with
  a chooser; keep the global landing for switching between sandbox /
  rooms (and later a settings page).

Polish backlog (sandbox):

- Audio: real music channel + adaptive layering on multiplier tier.
- HUD pass once the visuals settle (currently deliberately untouched
  through the neon work).
- Replays / score export so a run can be shared.
- Wider settings menu coverage for the new tunables (run duration is
  surfaced; some breaker / shield internals aren't yet).
- Performance: spatial hash if `maxBullets` regularly exceeds ~150.

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
