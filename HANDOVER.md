# Vectrix — handover for next session

Read this FIRST. The previous session burned 6+ messages doing the wrong
thing because I (Claude) skipped these rules. The user is impatient and
correct to be impatient. Don't repeat the failure modes.

---

## What this project is

**Vectrix** — score-attack 2D bullet hell, "Just Shapes & Beats" energy.
TypeScript strict, Vite multi-page, Canvas 2D (NO WebGL — we tried Phaser
and rolled back, the visual didn't survive). Tone.js for procedural SFX.

- Web URL: <https://caliskel.github.io/vectrix/>
- Local dev: `pnpm dev` → <http://localhost:5173/vectrix/>
- Tested in **Chrome** primarily. Safari runs slower but is no longer
  the optimisation target.
- Build gate: `npx tsc --noEmit` for fast loop; `pnpm build` for full
  prod build verification before commits.

## Where we are right now

`perf-pass-stable` tag points at the current HEAD. The game runs at
60 fps in Chrome through every room including the boss. The codebase
has been through a full performance pass:

1. **Object pools** for bullets, particles, rings, floating texts.
   `acquireBullet` / `pushParticle` / `pushRing` / `pushFloatingText`
   plus `compactBullets` / `compactParticles` / `compactRings` /
   `compactFloatingTexts` — all in `lib/bullets.ts` and
   `lib/particles.ts`. Every hot allocation site uses them.
2. **Sprite caches** for everything with a heavy `shadowBlur` glow:
   bullets, walls, turret bodies, hunter bodies, watcher bodies,
   player ring, **watcher laser beam + impact**, **key**, **pickups**.
   See the "Sprite caches" table in CLAUDE.md.
3. **Ring fake glow** — two-stroke layered pattern replaces
   `shadowBlur` on impact rings in rooms-game + tutorial-game.
4. **Off-screen culling** for bullets and particles in rooms-game.
   Camera-relative cull rect; entities outside skip render.
5. **F2 perf overlay** (`lib/perf-meter.ts`) — toggles a per-section
   ms breakdown in rooms-game. Always profile before optimising.

CLAUDE.md → "Performance architecture" section has the full reference.
Don't reinvent any of this — extend it.

## How to work without burning user patience

These are the failure modes from the previous session. Don't repeat them.

### 1. MEASURE before optimising

The watcher-laser sprite-cache fix shipped without actually helping the
laggy room because I never enabled F2 to confirm the laser was the
bottleneck. The user had to test, come back, and explain it didn't help.

**Always first:** ask the user to press F2 during the laggy moment and
report which section is red. Or do it yourself if you can drive a browser
session. If you can't measure, say so out loud rather than guess.

### 2. Don't re-create existing pool / sprite helpers

If you're typing `list.push({...})` or `list = list.filter(...)` in a hot
path, STOP. Use the pool. If you're typing `ctx.shadowBlur = N` inside a
per-entity loop, STOP. Build or use a sprite cache. The patterns are
already documented in CLAUDE.md → "Performance architecture".

### 3. "Literally copy X" means literally copy X

`LESSONS.md` rule #1 — when the user asks you to "literally copy" a
render path from one screen into another, OPEN the source function,
enumerate EVERY call, mirror them all. The boss-epilogue room scene
took 6 iterations because each pass I ported 2-3 modules and rebuilt
the rest by hand. Trigger phrases: `буквально`, `скопируй`, `1-в-1`,
`literally copy`, `все модули которые юзает`.

### 4. Don't suggest big migrations without a checkpoint tag first

The Phaser 4 pilot consumed 4+ sessions before we rolled back to
`pre-phaser-pilot`. If you're about to suggest a similar "let's rebuild
on X", tag the current state FIRST and tell the user the rollback
command up front. The user will trust the experiment more if rollback
is one git command.

### 5. Don't overstate timelines

The user asked "how long" for the Phaser rewrite and I gave a 5-7 week
estimate, which factored badly with the fact that I (Claude) can only
work during a session and the user has to test every iteration.
Realistic estimates need to acknowledge:
- Session-bounded work, not continuous.
- User testing time + iteration cycles.
- My own iteration mistakes (we did 6 on the epilogue room).
Be honest about this when sizing.

### 6. Confirm "saved" + "pushed" explicitly

The user asks "save everything" / "загрузи в гитхаб" frequently. Always
respond with `git status` + `git log origin/main..HEAD --oneline` +
`git ls-remote origin main` so they can see the actual state, not a
verbal claim. If the working tree is clean and remote matches HEAD,
say so directly.

## What's likely NOT done

These are open ideas that didn't ship in the perf pass. Don't start them
unless the user asks — they're diminishing returns.

- **Spatial hash for bullet collisions.** Only matters at 100+ bullets;
  current peak is ~50 in boss phase 3 and it runs fine.
- **Bullet trail sprite cache.** Five `fillRect` per bullet currently;
  one `drawImage` per bullet would save calls. Real win on bullet
  storms only.
- **Cache player eye static layers.** Modest win; the ring is already
  cached, the iris / pupil / highlight draw live.
- **drawArenaBg parallax dots batching.** Many small `fillRect`s; could
  collapse into a single Path2D. Tiny win unless dot count grows.

## What the user likely wants next

When they come back, possible directions:

- **More content** — more enemies, more rooms, more boss phases. Game is
  performant enough now to take on more entities.
- **Native Mac/Windows .app via Tauri.** Discussed — Tauri uses WebKit
  on macOS so the Safari-style perf applies inside the .app. Either go
  Electron (Chromium, fast, +200 MB) or accept the Tauri WebKit cost.
- **Score / leaderboard polish.** Sandbox has per-config bests in
  localStorage; rooms has a separate best. No remote leaderboard yet.
- **Audio polish.** Boss SFX are placeholder; sweep laser drone synth
  was sketched in `LESSONS.md`-adjacent code but never built.

Don't pre-decide — ask the user which direction.

## Quick command cheatsheet

```sh
# Verify state
git status
git log --oneline -5
git ls-remote origin main

# Type-check + build
npx tsc --noEmit
pnpm build

# Dev server (HMR — keep running while iterating)
pnpm dev

# Rollback the perf pass if you regress something
git reset --hard perf-pass-stable

# Rollback the entire perf + post-Safari work
git reset --hard pre-safari-perf-pass

# Tag a new checkpoint before a risky change
git tag <name> && git push origin <name>
```

## Tone the user prefers

- Russian, terse, direct.
- They notice when I'm being verbose / explaining things they already
  know. Cut the preamble.
- When uncertain, ASK (one short question) rather than guess.
- When making a multi-step change, ship one concrete piece per turn
  rather than batching 4 large unconfirmed refactors.
- They will say "загрузи в гитхаб" / "запушь" frequently — that's
  always `git add -A && git commit -m "..." && git push origin main`,
  with a meaningful message.
