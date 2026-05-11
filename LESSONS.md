# Lessons (paid in iterations)

Hard rules distilled from sessions where the user had to repeat themselves.
Each entry names the failure mode, the trigger to watch for, and the
correct behaviour. If you're reading this in a future session: do NOT
treat these as "nice to follow" — they exist because the user already
spent time correcting the opposite behaviour.

---

## 1. "Literally copy X" means literally copy X

**Trigger phrases (user):** `буквально`, `скопируй`, `1-в-1`,
`все модули которые юзает`, `literally copy`, `copy verbatim`,
or any "make it look like X" / "use the same Y" comparison.

**Failure mode (don't do this):**

- Grep for individual modules referenced by X.
- Pick a "minimum viable" subset of those modules.
- Hand-roll the rest from scratch ("close enough" backgrounds, simpler
  walls, my own grid drawing).
- Add my own creative choices on top — different hero size, decorative
  glyphs, repositioned UI, new colour, etc.
- Ship that and hope the user accepts it.

**Correct behaviour:**

1. Open the reference function in the actual source — for rendering,
   that's the `render()` or `draw()` entry in the file the user pointed
   at (`tutorial-game.ts → render()`, `rooms-game.ts → render()`, etc.).
2. Enumerate every call in order. Every. Single. One.
3. Bring **all** of them into the new scene, including the ones I
   don't think are visually important (camera updates, `BackgroundFx`,
   `EnergyBackground`, `BackgroundText`, `wallFx`, `scanlines`, the
   per-frame `updateArenaBg` tick — these were the modules I missed
   multiple times on the boss epilogue).
4. No design substitutions. Use the same constants the reference uses
   (`PLAYER_SIZE`, not "60 because I think it's crisper"). Use the
   same colours. Use the same positions. The user will say if they
   want changes.
5. If a call in the reference genuinely can't be ported, **say so out
   loud** in the response. Don't silently drop it.

**Origin:** Six iterations on the boss-epilogue room scene before this
landed. Each pass ported 2–3 of the tutorial's nine render modules
and rebuilt the rest by hand. The user said "literally copy" four
separate times. The full pipeline that should have been ported on
iteration one:

```
PALETTE.bg screen fill
→ bgFx.drawBack
→ drawEnergyBackground (with arenaBounds clip)
→ drawBackgroundTexts (with arenaBounds clip)
→ ctx.setTransform → camera transform (-camera.x, -camera.y)
→ drawArenaBg (with updateArenaBg ticked every frame)
→ drawRoomGrid (with updateGridNodes ticked every frame)
→ drawWalls
→ drawWallOverlay (with updateWallFx ticked every frame)
→ entities / hero
→ ctx.restore → screen-space
→ drawScanlines (with tickScanlines)
→ HUD / footer
```

If any of those calls is absent from a new "tutorial-style" scene
without a stated reason, the work is incomplete.

---

## 2. Use `pnpm dev` for visual feedback, not `pnpm build`

When the user says "I changed code but the page hasn't updated", send
them to `pnpm dev` (HMR) — not `pnpm build && pnpm preview`. Build/
preview locks the bundle and hides live changes. `pnpm dev` reloads
on save.

---

## How to add a new lesson

Each lesson here is paid for. If the user has to correct the same
behaviour twice in one session, write the third occurrence into this
file before ending the session. Keep the structure: trigger / failure
mode / correct behaviour / origin.
