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

### Room 1

- Player spawns at (150, 400), facing right.
- One **Turret** at (600, 400). 50 px diameter neon-cyan body with a
  rotating barrel that aims at the player (lerp rate 10/s,
  frame-rate independent).
- Turret fires every 1.4 s — the last 0.3 s before a shot brightens
  the barrel as a telegraph. Bullet uses sandbox-shared
  `lib/bullets.ts` (size/speed/color from `settings.bullets`,
  `bounces=false`).
- Turret HP = 3. Player damages it only when their AABB overlaps the
  turret body **during a dash i-frame**. Each dash session can deal
  at most one damage (`dashIdAlreadyDamaged` per turret).
- Outside dash, the turret hits the player on contact (same as a
  bullet hit).
- Right wall has a 80 × 120 gap at (1200, 400). The wall is split
  around the gap; the gap is occupied by a `Door` entity.
- Door starts **closed** — drawn as a wall-tinted rect with a neon
  red `×`, blocks the player like any wall and aborts a dash on
  contact. When the last enemy in the room dies:
  - The door switches to **open** (pulsing neon arrow `→`).
  - A 0.2 s green flash plays over the screen at 0.15 alpha.
  - `audio.play.multUp(5)` rings as a placeholder room-cleared sting
    (will get its own cue later).
- Stepping into the open door triggers `transitionToRoom(nextRoomId)`,
  which rebuilds bullets/rings/floating texts and respawns the player
  at the next room's spawn point.

### Room 2 (placeholder)

- Closed border, no enemies, no door, `message: "Room 2 — coming
  soon"` rendered as a centered neon string. Used to verify
  transitions work end-to-end before real Room 2 content lands.

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
- Esc / Tab opens the shared settings menu; "Restart run" in the menu
  also routes to `restartRun()` for rooms.

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
