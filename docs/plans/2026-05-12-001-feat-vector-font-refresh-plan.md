---
date: 2026-05-12
topic: vector-font-refresh
type: feat
depth: deep
status: active
origin: docs/brainstorms/vector-font-refresh-requirements.md
---

# feat: Vector Font Refresh

## Summary

Replace Orbitron + Space Mono with a single custom stroke-vector typeface, authored as ordered segment data per glyph. Canvas renders directly from segment data; DOM uses a TTF/WOFF2 baked at build time from the same data through a Vite plugin (`opentype.js` + `js-angusj-clipper` + `wawoff2`). Per-segment animations (draw-in, scramble, dissolve) are first-class; existing character-level scramble migrates in-place. Eight implementation units sequenced so each is an atomic, bisectable PR — the rollout is gradual by design.

---

## Problem Frame

The current type stack (Orbitron display + Space Mono body) is competent but generic — every other synthwave web project ships with the same pairing. The game's identity — its name VECTRIX, the tagline "vector odyssey", the stroke-rendered eye, the hex Sentinel, the vector-arcade silhouettes — leans into a vector aesthetic that the typography doesn't echo. Repo research surfaced a second cost: canvas text in `rooms.html` / `sandbox.html` / `tutorial.html` already silently falls back to `ui-monospace` because those pages don't load the Google Fonts — meaning today's HUD isn't even using Space Mono. The refresh both unifies the typographic voice across all 136 text call-sites *and* fixes the silent-fallback asymmetry.

The recent INFECTED ZONE scramble hints at what a more integrated type system could look like, but it operates at character level on a web font and can't be pushed further. The cost of staying with two third-party web fonts is opportunity: the game can't develop a distinctive typographic voice as long as it borrows one.

(see origin: docs/brainstorms/vector-font-refresh-requirements.md)

---

## Requirements Traceability

| Origin | Where addressed |
|---|---|
| R1 (stroke-segment master) | U1, U2, U4 |
| R2 (modernized stroke character) | U2 |
| R3 (display open / body closed from one master) | U2 (uppercase / digits), U4 (lowercase) |
| R4 (single weight, rendered via stroke width) | U1, U3, U6 |
| R5 (glyph coverage) | U2 (uppercase + digits + ASCII punct + HUD symbols), U4 (lowercase) |
| R6 (canvas reads segments directly) | U1, U3, U4 |
| R7 (DOM via baked TTF/WOFF) | U5, U6 |
| R8 (bake at build time, ship as static asset) | U5 |
| R9 (draw-in / scramble-in / dissolve-out as first-class) | U7 |
| R10 (INFECTED ZONE scramble migrates to segment-level) | U7 |
| R11 (animations opt-in at call site) | U1, U7 |
| R12 (display replacements: logo, overlay titles) | U3 (canvas overlays), U6 (DOM overlay titles), U8 (logo) |
| R13 (body replacements: HUD, floating, bg-text, menus, tagline, settings, controls table, pause menu) | U3 (canvas HUD + floating), U4 (bg-text + cinematic + hint + markers), U6 (DOM menus + tagline) |
| R14 (logo rendered through canvas with per-segment effects) | U8 |
| R15 (body 12px readability validated side-by-side) | U6 |
| R16 (per-context Space Mono fallback when 12px fails) | U6 |
| AE1 (Controls table at 12px readable) | U6 verification |
| AE2 (INFECTED ZONE segment-level scramble visible) | U7 verification |
| AE3 (logo + menu buttons same family on first paint) | U6, U8 verification |
| AE4 (display E vs body E on same screen, family resemblance) | U2, U3 verification |

---

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

```
                       Glyph master (TS data)
                       src/lib/font/glyphs.ts
                                 |
              +------------------+------------------+
              |                                     |
              v                                     v
       Canvas runtime                       Build-time bake
       (direct stroke)                      (Vite plugin)
              |                                     |
   drawText / FontRenderer                          v
              |                          js-angusj-clipper
              |                       (polylines -> filled
              |                        polygons via offset)
              |                                     |
              |                                     v
              |                              opentype.js
              |                              (filled paths
              |                               -> TTF buffer)
              |                                     |
              |                                     v
              |                                wawoff2
              |                          (TTF -> WOFF2 buffer)
              |                                     |
              |                                     v
              |                          public/fonts/vectrix.woff2
              |                                     |
              v                                     v
       ctx.stroke / sprite-cache         @font-face url('...')
       (HUD, floating, overlays,         (settings menu, pause
        scramble, cinematic typewriter,   menu, controls table,
        bg-text, markers, hint banner)    about, tagline,
                                          TUTORIAL COMPLETE)
```

```
                        Per-segment animation pipeline
                         (drawIn / scrambleIn / dissolveOut)

              segments[]            +    Animation{kind, age, duration}
                  |                                  |
                  +----------------+-----------------+
                                   v
                       resolveAnimatedSegments()
                         (returns rendered segments
                          with per-segment offset /
                          alpha / displacement)
                                   |
                                   v
                            ctx.stroke()
```

Key design beats:
- **One master, two consumers.** Stroke segments live in code; canvas consumes them as-is; the bake step thickens them to filled polygons for TTF. The "single source of truth" rule from the brainstorm holds — the thickening is a derivation, not a parallel authoring step.
- **Stroke → fill is real work, not a flag flip.** TTF can only store filled outlines; Clipper2's `ClipperOffset` with `EndType.OpenButt` and `JoinType.Miter` is the established way to thicken open polylines into closed polygons.
- **Renderer is stateless and pure.** `FontRenderer` holds only its glyph map + sprite cache. `drawText(ctx, font, text, x, y, opts)` is the entire public API. Matches the project's existing `EnergyBackground` / `BackgroundTextState` shape.
- **Per-segment animations layer on the renderer**, not the consumer. `drawText` accepts an optional `Animation` parameter; callers pass `{ kind: "scrambleIn", age, duration, settledCount }` and the renderer handles the rest.

---

## Output Structure

```
src/lib/font/                     (new module)
├── types.ts                      Glyph, Segment, FontRenderer, Animation types
├── font.ts                       createFontRenderer, drawText, measureText
├── glyphs.ts                     master glyph data (uppercase + digits in U2,
│                                 lowercase added in U4)
├── glyph-sprite.ts               Map-keyed sprite cache (per char/size/color/mode)
└── animations.ts                 draw-in / scramble-in / dissolve-out evaluators
                                  (added in U7)

scripts/bake-font.ts              (new, U5) — bake logic, Node-runnable
scripts/vite-plugin-vectrix-font.ts  (new, U5) — Vite plugin with addWatchFile + HMR

src/landing/logo-canvas.ts        (new, U8) — VECTRIX logo canvas renderer

public/fonts/vectrix.woff2        (generated by U5, emitted to dist/)
```

The structure shows expected output; per-unit **Files:** sections are authoritative.

---

## Implementation Units

### U1. Foundation: glyph data types + font renderer skeleton

**Goal:** Establish the data types, the stateless render API, and the keyed sprite cache. No live use yet — verified via a sandboxed dev preview.

**Requirements:** R1, R4, R6, R11

**Dependencies:** none

**Files:**
- `src/lib/font/types.ts` (new) — `Segment`, `Glyph`, `FontRenderer`, `TextDrawOpts`, `Animation` types
- `src/lib/font/font.ts` (new) — `createFontRenderer()`, `drawText(ctx, font, text, x, y, opts)`, `measureText(font, text, size, weight)`
- `src/lib/font/glyph-sprite.ts` (new) — `Map<string, HTMLCanvasElement>` keyed cache, lazy build, padding for shadowBlur headroom, key rounding for continuous sizes
- A throwaway dev preview wired into `sandbox.html` (gated behind a query param like `?fontpreview`) that renders a small placeholder glyph set at sizes 12 / 14 / 18 / 24 / 60 in display + body mode

**Approach:**
- `Glyph = { advance: number; displaySegments: Segment[]; bodySegments?: Segment[] }`. When `bodySegments` is absent, body mode falls back to `displaySegments`.
- `Segment = { type: "line"; x1, y1, x2, y2 } | { type: "quad"; x1, y1, cpx, cpy, x2, y2 }`. Coordinates in unitsPerEm = 1000 space, with the cap-height baseline at y = 700 and descender at y = -200.
- `TextDrawOpts = { size: number; color: string; weight?: "display" | "body"; align?: "left" | "center" | "right"; baseline?: "top" | "middle" | "alphabetic"; spacing?: number; animation?: Animation }`. `weight` defaults to `"body"`.
- `drawText` walks `text` codepoint by codepoint, looks up each glyph, applies sprite-cache for stable params or strokes directly when `animation` is present (animation breaks cache invariants).
- `measureText` sums `glyph.advance * (size / 1000)` per char + `(text.length - 1) * (spacing ?? 0)`.
- `glyph-sprite` follows the pattern in `src/lib/bullet-sprite.ts`: module-level `cache = new Map()`, lazy `getGlyphSprite(char, size, color, mode)` that builds on miss. Padding constant covers stroke + any glow shadowBlur headroom. Key string is `${char}|${px}|${color}|${mode}`; sizes round to integer pixels to bound cache growth.

**Patterns to follow:**
- `src/lib/bullet-sprite.ts` for keyed lazy sprite cache shape
- `src/lib/background-energy.ts` for the `createX(...)` + `drawX(...)` stateless factory pattern
- `src/lib/scramble-text.ts` for stateless time-driven render style

**Test scenarios** (visual verification — the project has no automated test framework):
- Render the placeholder glyph set ("ABC012", a known display char like "E" with the open form, and a known body char like "e" with closed form) at 12, 14, 18, 24, 60px on the dev preview. Both modes are present and the family resemblance is visible at all sizes.
- Empty string renders nothing without throwing.
- A char missing from the glyph map renders a `.notdef` tofu box (small empty rectangle), not blank space and not a crash.
- `measureText("ABC")` returns a width consistent with three glyph advances at the given size.
- Render the same string 100 times per frame in the dev preview: the F2 perf overlay shows no per-call stroke spike on the second pass (sprite cache hit). Covers AE4 framing at the renderer level.

**Verification:** `tsc --noEmit` passes; dev preview at `sandbox.html?fontpreview` renders the placeholder set cleanly across sizes.

**Execution note:** Before starting this unit, tag `pre-font-refresh` per the CLAUDE.md "commit before large changes" rule:
```
git tag pre-font-refresh
```
This is the explicit rollback point if the rollout regresses.

---

### U2. Glyph master — uppercase, digits, ASCII punctuation, HUD symbols

**Goal:** Author the first wave of glyph data: enough to render all HUD, overlay titles, and uppercase-only text in the game.

**Requirements:** R1, R2, R3, R5

**Dependencies:** U1

**Files:**
- `src/lib/font/glyphs.ts` (new) — `GLYPHS: Record<string, Glyph>` mapping char → Glyph
- Update the dev preview from U1 to render the full set as a gallery

**Approach:**
- Grid: `unitsPerEm = 1000`, 100-unit step. Letter body uses a 7×9 design grid (700 wide × 900 tall) anchored with cap-height = 700 above the baseline, descender = -200 below. Stroke width = 100 units (rendered weight scales via `lineWidth` in canvas).
- Em-aligned coordinates per the external research: every stroke vertex lands on a 100-unit grid line so unhinted rendering quantizes cleanly at body sizes 12-18px.
- **Display variants** use open forms:
  - `E`: top horizontal + bottom horizontal + left vertical, no middle bar
  - `R`: top loop + right open leg (no inner counter)
  - `A`: two diagonals + no crossbar
  - `F`, `G`, `Q`, `B` etc. — apply the same open-form spirit where the character allows
- **Body variants** are closed forms (`E` with middle bar, `R` with closed inner triangle, `A` with crossbar, etc.). Same skeleton vertices, additional segments where needed.
- Coverage in this unit:
  - 26 uppercase (A–Z)
  - 10 digits (0–9)
  - ASCII punctuation in use: `, . : ; / - _ ! ? + = % ( ) [ ] < > # @ $ * ' " | \ &` (~25 glyphs)
  - HUD symbols: `↑ ↓ ← → ▶ ↺ × ✕` (8 glyphs)
- Total ~70 glyphs in this unit.

**Patterns to follow:**
- `src/lib/palette.ts` for `as const` data-only modules
- Express each glyph as inline `{ advance, displaySegments: [...], bodySegments: [...] }` so PR diff reviews changes per-glyph cleanly

**Test scenarios:**
- Every char from the coverage list renders in both display and body modes at 14px and 60px.
- `measureText("HELLO WORLD")` returns a sensible monospace-ish width (spaces use a documented advance — default 500 units).
- Side-by-side display "E" vs body "E" at 60px and 14px on the dev preview. Family resemblance is clear; display form has no middle bar; body form has the middle bar. Covers AE4.
- Body 12px legibility sniff test: render `HELLO 123` at 12px alongside Space Mono at the same size. If the test fails outright (illegible), record which glyphs are worst (likely `B`, `R`, `8`) for follow-up tweaks before U3 lands.

**Verification:** Dev preview gallery renders the full set cleanly; visual review confirms family resemblance and metric consistency.

---

### U3. Migrate canvas HUD, floating text, and overlay titles

**Goal:** Replace every fillText site that uses uppercase + digits + HUD symbols with the new font. First user-visible change.

**Requirements:** R6, R12 (canvas overlay titles), R13 (HUD + floating text)

**Dependencies:** U1, U2

**Files (modify):**
- `src/lib/particles.ts` — `drawFloatingTexts()` (lines 58–94)
- `src/rooms/rooms-game.ts` — HUD block (~lines 2760–2920), score / room counter / hearts / key indicator / TRY AGAIN overlay
- `src/sandbox/sandbox-game.ts` — HUD block (~lines 1685–1883) — TIME / HP / SCORE / MULT row, hearts, effect labels, fail overlay buttons
- `src/tutorial/tutorial-game.ts` — HUD block (~lines 2802–2933). The "who was that?" boot-thought scramble at ~line 2583 is NOT in U3 — it stays on the current `drawScrambleText` rendering until U7 rewrites that function on the new renderer.
- `src/lib/enemies/sentinel.ts` — `drawIntroOverlay()` ("SENTINEL", ~line 4606), `drawDyingOverlay()` ("VICTORY", ~line 4678)
- `src/lib/death-fx.ts` — "ELIMINATED" title (~line 400)
- `src/lib/god-mode.ts` — "GOD MODE" badge (~lines 51–59)
- `src/lib/perf-meter.ts` — F2 overlay text; also add `"text"` to the `SECTIONS as const` array (~lines 19–42)
- `src/lib/fps-meter.ts` — F3 overlay text (~lines 76–91)
- `src/lib/markers.ts` — tutorial Room 0 marker numbers + label (~lines 86–125)

**Approach:**
- Each game's `start()` constructs a single `FontRenderer` via `createFontRenderer()` and threads it into render calls (parameter on the existing draw helpers, alongside `ctx`).
- Each `ctx.font = "..."; ctx.fillText(text, x, y)` becomes `drawText(ctx, font, text, x, y, { size, color, weight, align, baseline })`.
- For stable strings (e.g. `"ROOM 1 / 5"`, `"SCORE"`, the heart row's `♥`) the sprite cache is hit on every frame; no shadowBlur per-call needed.
- For dynamic strings (live SCORE value, MULT, TIME, floating "+15000") cache hits per-glyph at the digit level — `"15234"` becomes 5 cached glyph blits, not a stroke-build.
- Wrap each game's HUD block with `perfBegin("hud") ... perfEnd("hud")` (the section is declared in perf-meter but not yet timed) and wrap the floating-text loop with `perfBegin("text") ... perfEnd("text")` after adding `"text"` to perf-meter's sections array.
- Sentinel intro `easeOutBack` scale interpolation on the "SENTINEL" title still works — `drawText`'s scale comes from `opts.size` per frame, which the existing intro code already varies.

**Patterns to follow:**
- The existing thread-by-parameter shape used by `drawWalls`, `drawEnemyDetection`, `drawLaser`, etc. — `ctx` first, then state, then params. `FontRenderer` is just another state object.

**Test scenarios:**
- `/sandbox.html` → start a run → SCORE increments, MULT pulses, TIME counts, hearts deplete on hit. All numbers render in the new font without visual jank.
- `/rooms.html` → ROOM 1 / 5 HUD label is correct; SCORE, HP icons, key indicator (0 / 1 → 1 / 1) all on the new font.
- `/rooms.html` → kill an enemy → "+800" floating text renders on the new font, animates upward, fades out — matching the prior cadence (no double-render, no broken alpha).
- Boss room (`/rooms.html` → room 5): SENTINEL intro title fades in and scales via easeOutBack, then fades out. VICTORY title on Sentinel death fades in green. "ROOM 5 / 5 — BOSS" suffix renders correctly.
- `/sandbox.html` → trigger god mode (F1 in sandbox is wired the old way) → "GOD MODE" badge top-center shows in new font.
- **AE4 explicit same-screen test:** during a Sentinel run in `/rooms.html`, look at the screen during the boss intro window when both the 60px display "SENTINEL" title and the 14px body "ROOM 5 / 5 — BOSS" HUD label are visible simultaneously. The display "E" in SENTINEL is open-form (no middle bar); the body "E" in ROOM is closed-form (with middle bar); family resemblance is visible at a glance.
- F2 perf overlay reads in the new font; new `"text"` section appears in the section list and shows non-zero ms during combat.
- Run sandbox at maxBullets=30, dash through 4 bullets in one i-frame, watch 4 floating texts spawn simultaneously — F2 `"text"` section stays under 2ms.
- Tutorial Room 0 marker numbers render: 1 → 2 → 3 → 4 in the new font; "DASH" label too.

**Verification:** `pnpm dev` → traverse sandbox + rooms + tutorial paths. Visual: every HUD element on the new font. Perf: F2 overlay shows `hud` + `text` sections within budget. Covers AE4 (display E in overlay title vs body E in HUD label).

**Execution note:** Resist scope creep — Sentinel HP bar label "SENTINEL" is in this unit, but the HP bar rendering itself stays unchanged. Layout shifts from font metric changes are acceptable; rewrites of HUD layouts are out of scope.

**Scramble call sites are NOT in U3.** All 5 `drawScrambleText` call sites (intro "who am i?", tutorial "who was that?", rooms "how do i do this?", INFECTED ZONE, epilogue "TO BE CONTINUED") continue to use the existing character-level scramble until U7 rewrites the function. Touching scramble in U3 would force a partial migration that breaks U7's "API unchanged, in-place rewrite" model.

---

### U4. Lowercase glyphs + cinematic typewriter + background-text + remaining canvas sites

**Goal:** Complete the canvas-side migration. Lowercase glyphs land; cinematic intro/epilogue typewriters, background-text, tutorial hint banner, archive-fx, and room placeholder messages all move to the new font.

**Requirements:** R1, R5 (lowercase), R13 (remaining body contexts)

**Dependencies:** U1, U2, U3

**Files (modify unless noted):**
- `src/lib/font/glyphs.ts` — add 26 lowercase (a–z) + the few remaining ASCII chars not in U2 if any surface
- `src/intro/intro-cinematic.ts` — typewriter text-card (~line 962). The `▍` cursor glyph is added to the glyph set if not already there.
- `src/intro/main.ts` — "PRESS ANY KEY TO SKIP" skip prompt (~line 116)
- `src/epilogue/epilogue-cinematic.ts` — typewriter cards (~lines 607–684) using the same shape as intro
- `src/lib/background-text.ts` — `trySpawnWord()` measure (~line 199), `drawBackgroundTexts()` paint (~lines 292–298). Project's only `ctx.letterSpacing` consumer — port to the renderer's `spacing` parameter.
- `src/lib/archive-fx.ts` — ghost archive text (~lines 282–285)
- `src/tutorial/tutorial-game.ts` — `drawTutorialHint()` keycap-format banner (~lines 757–822). Banner mixes plain text and `[KEY]` keycap rectangles measured with `measureText` per token — port the measurement through `measureText` from the new renderer.
- `src/rooms/rooms-game.ts` — room placeholder `message` render (~line 2627), STORY MODE LOCKED canvas-side helper text where present

**Approach:**
- Lowercase glyphs share the skeleton of their uppercase siblings where natural (`o`, `c`, `s`) but use x-height 500 + descenders for `g`, `j`, `p`, `q`, `y`. Most lowercase has only `displaySegments` (the display/body distinction is uppercase-led).
- `ctx.letterSpacing` users get a `spacing` parameter on `drawText` (units = display pixels added between glyphs). Background-text passes `spacing: 2`.
- The tutorial hint's `[KEY]` keycap rendering keeps its current logic (measure each token, paint a rectangle, then text inside) — token measurement just routes through the new `measureText`.
- **Layout shifts on measurement-driven geometry are expected.** The new `measureText` returns integer-quantized widths derived from `glyph.advance * (size/1000) + spacing`, while the current `ctx.measureText` returns subpixel float widths. Two affected geometric paths: (a) tutorial hint keycap rectangles can shift fit, (b) background-text spawn placement uses pre-measured bboxes for an arena-rect-intersection test (`FLOATING_TEXT_SPAWN_RETRY_LIMIT = 5`). Plan to refit keycap widths once after the migration (a one-line padding adjustment if needed) and watch background-text retry rate during U4 verification — if retry failures spike, bump the retry limit or relax the placement margin rather than reverting the font.
- Intro/epilogue typewriter: keep the current per-frame character-reveal logic (it doesn't need segment-level reveal — segment-level reveal is a U7 feature for callers that opt in). The cursor `▍` glyph is added as a new entry in the glyph map.

**Test scenarios:**
- `/index.html` → tagline "vector odyssey" renders in lowercase on the new font.
- `/tutorial.html` → Room 0 → hint banner reads `USE [W][A][S][D] TO MOVE` with keycap rectangles and the player's actual bindings interpolated. Switch one binding via the Controls overlay; hint updates without restart.
- `/intro.html` → typewriter card reveals char-by-char on the new font; cursor `▍` blinks correctly; "PRESS ANY KEY TO SKIP" prompt at the bottom renders in the new font.
- `/epilogue.html` (if reachable post-Sentinel kill) → typewriter cards render; TBC line readies for U7's segment-level scramble (still character-level until U7 lands — fine).
- `/rooms.html` → background-text words spawn, type out, hold, fade — same cadence as before (configured by `FLOATING_TEXT_*` constants in `config.ts`). Words now render on the new font.
- `/rooms.html` → enter Room 2 placeholder → placeholder `message` renders on the new font.
- `/tutorial.html` → archive-fx ghost text (where used in cinematic moments) renders correctly.

**Verification:** Walk through landing → tutorial Room 0 → intro flow → rooms run → epilogue. Every canvas-side text site renders on the new font. No layout regressions.

---

### U5. Build-time bake pipeline (opentype.js + js-angusj-clipper + wawoff2 via Vite plugin)

**Goal:** A TTF/WOFF2 of the new typeface is emitted at build time from the same glyph data. Dev mode serves it with HMR re-bakes on glyph edits.

**Requirements:** R7, R8

**Dependencies:** U2 (uppercase glyphs), U4 (lowercase included — bake all-or-nothing into the TTF)

**Files:**
- `scripts/bake-font.ts` (new) — `bakeFont(glyphs): Promise<{ ttf: Uint8Array; woff2: Uint8Array }>`. Importable from the Vite plugin or runnable standalone via `tsx scripts/bake-font.ts`.
- `scripts/vite-plugin-vectrix-font.ts` (new — lives in `scripts/` not repo root, so it shares the `scripts/` tsconfig coverage added with `bake-font.ts`) — `vectrixFont(opts): Plugin` factory exporting `name`, `buildStart`, `configureServer` (dev middleware), `handleHotUpdate`, `generateBundle`
- `vite.config.ts` (modify) — register the plugin in `plugins: [vectrixFont({ glyphDataPath: "src/lib/font/glyphs.ts" })]`
- `package.json` (modify) — add devDependencies: `opentype.js@1.3.4`, `js-angusj-clipper` (latest stable), `wawoff2` (latest stable). If opentype.js 1.3.4 has a blocking bug, fall back to `github:opentypejs/opentype.js#master` and document it in the Key Decisions section.
- `index.html`, `intro.html`, `epilogue.html`, `rooms.html`, `sandbox.html`, `tutorial.html` (modify) — add (a) `<link rel="preload" as="font" type="font/woff2" href="./fonts/vectrix.woff2" crossorigin>` in `<head>` so the font is in flight before first paint, and (b) `@font-face { font-family: "Vectrix"; src: url("./fonts/vectrix.woff2") format("woff2"); font-display: block; }` inside each `<style>` block. Base-relative URL (`./fonts/...`) avoids hard-coupling to the current `base: "/vectrix/"` Vite config. `font-display: block` over `swap` because AE3 requires "first paint shows menu buttons in Vectrix" — `swap` paints the fallback first and would fail the test on cold cache.
- `public/fonts/.gitignore` (new) — ignore the generated `vectrix.woff2` so it's not committed; the bake is reproducible from glyph data

**Approach:**
- Bake pipeline:
  0. `await loadNativeClipperLibInstanceAsync()` once at plugin start; cache the Clipper instance and the `wawoff2` init across glyphs and across re-bakes (HMR re-bake must reuse, not re-init — WASM init is the bulk of cold-start cost)
  1. Import glyph data (either via dynamic `import()` for HMR-safety or by reading + evaluating the TS file through `tsx` / Vite's SSR pipeline; pick whichever is simpler in plugin context)
  2. For each glyph: convert `Segment[]` to a polyline-per-stroke and feed Clipper2:
     - `clipper.offsetToPaths(polyline, { delta: 50, jointType: JoinType.Miter, endType: EndType.OpenButt, miterLimit: 2.5 })` — delta = strokeWidth/2 = 50 units at default; miter limit clamps spikes on acute joins (V/W/M/Y/X/K/A) so they don't exceed glyph bbox
     - Quad segments are sampled into 8–12 line segments before offsetting (curve fidelity at 1000 unitsPerEm doesn't need more)
  3. **Union pass:** after per-stroke offsetting, run `clipper.clipToPaths({ subject: allOffsetPaths, clipType: ClipType.Union, fillType: PolyFillType.NonZero })` to merge overlapping rectangles from intersecting strokes (A, X, &, $, %, @, *, 4, +, K, W, Y) into a single closed contour. Skipping this step ships overlapping subpaths with conflicting fill orientation — TTF rasterizers produce holes or visual artifacts.
  4. Resulting closed polygons → `opentype.Path` with `moveTo` / `lineTo` / `closePath`. Outer contours CCW, inner holes CW.
  5. `new opentype.Glyph({ name, unicode, advanceWidth: glyph.advance, path })` per char + a `.notdef` glyph
  6. `new opentype.Font({ familyName: "Vectrix", styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs })`
  7. `font.toArrayBuffer()` → TTF buffer
  8. `await woff2Compress(ttf)` → WOFF2 buffer
- Vite plugin lifecycle:
  - `buildStart` runs the bake, stores TTF + WOFF2 in plugin-local closure
  - `addWatchFile(opts.glyphDataPath)` (also watch `src/lib/font/types.ts` for safety)
  - `handleHotUpdate({ file, server })`: when `file === glyphDataPath`, re-bake and `server.ws.send({ type: "full-reload" })` (HMR can't meaningfully diff a font)
  - `configureServer(server)`: middleware mounted at `/fonts/vectrix.woff2` (Vite strips the `base` prefix before middleware sees the URL). Serve with `content-type: font/woff2` and a no-cache header in dev. The `@font-face` URL is `./fonts/vectrix.woff2` (base-relative) so the same source works in both dev and prod regardless of what `base` is configured as.
  - `generateBundle()`: `this.emitFile({ type: "asset", fileName: "fonts/vectrix.woff2", source: woff2 })` — `fileName` is relative to `outDir`; Vite's asset pipeline serves it under `base` automatically.
- Stable URL: `vectrix.woff2` with no content hash so the `@font-face` URL stays put across deploys.

**Patterns to follow:**
- Vite plugin shape from the external research report (`buildStart` + `configureServer` + `handleHotUpdate` + `generateBundle`)
- `tsconfig.json` is strict; the new `scripts/` directory needs to be added to `include` or have its own `tsconfig.scripts.json` — pick the lighter option

**Test scenarios:**
- `pnpm dev` after this unit: visit `/vectrix/fonts/vectrix.woff2` directly in browser → file downloads successfully, content-type is `font/woff2`
- Open DevTools → Network tab → reload `/sandbox.html` → `vectrix.woff2` request returns 200 with the expected size (~10-30KB)
- Open DevTools → Console → `getComputedStyle(document.body).fontFamily` includes "Vectrix" (after U6 wires it in, but the asset must exist now)
- Edit `src/lib/font/glyphs.ts` (e.g. shift the "A" glyph's middle stroke by 50 units) and save → dev server re-bakes and triggers a full reload; the updated font lands within ~2s
- `pnpm build` → `dist/fonts/vectrix.woff2` exists; build completes without errors
- Manual: load the generated TTF in macOS Font Book or similar → glyphs preview correctly (sanity check for the stroke→fill thickening)
- `tsc --noEmit` passes with the new script + plugin code

**Verification:** Generated WOFF2 loads in the browser; HMR loop works; production build emits the asset.

**Execution note:** The stroke→fill conversion via Clipper2 is the highest-risk part of this unit. **Prototype on a known-hard glyph first** — `X` (two strokes crossing at the center) or `A` (two diagonals meeting at a sharp acute angle) — not `L` (two non-crossing strokes), which doesn't exercise the Union pass or miter clamp. If `js-angusj-clipper` produces self-intersecting polygons even after the Union step, the fallback is `JoinType.Round` with a small mitered cap. As a last resort for a specific glyph that won't bake cleanly, add a `bakeOutlineOverride?: opentype.Path` field on the `Glyph` type and hand-author the filled outline for that single glyph — the canvas path stays stroke-driven, only the TTF bake uses the override.

---

### U6. DOM migration + Google Fonts cleanup

**Goal:** Every DOM text element uses Vectrix. Orbitron + Space Mono Google Fonts links removed. Body 12px readability validated per-context with fallback.

**Requirements:** R12 (DOM display contexts), R13 (DOM body contexts), R15, R16; covers AE1, AE3

**Dependencies:** U5

**Files (modify):**
- `index.html` — update CSS `--font-display` and `--font-mono` variables to `"Vectrix"`; remove the inline `font-family` references on `.logo` (U8 owns the logo migration). **Google Fonts `<link>` removal is conditional** — see the readability-decision rule below.
- `intro.html` — swap CSS `font-family` references to `"Vectrix", ui-monospace, monospace`. **Orbitron `<link>` removal is conditional** (only the canvas typewriter migrates here in U4; if any DOM body element on this page falls back to Space Mono per R16, retain Space Mono's `<link>` too).
- `epilogue.html` — same as `intro.html`
- `src/lib/settings-menu.ts` — body font swap in inline cssText (~lines 21, 34–62)
- `src/lib/pause-menu.ts` — body font swap (~lines 17–130); special attention to the stat-row `ui-monospace` override at ~line 119
- `src/lib/dev-menu.ts` — body font swap (~lines 22–126)
- `src/tutorial/tutorial-game.ts` — TUTORIAL COMPLETE overlay inline cssText (~lines 2716–2734)
- `src/rooms/rooms-game.ts` — STORY MODE LOCKED overlay CSS (~lines 3008–3014) + GO TO TUTORIAL CTA (~line 3030)

**Approach:**
- Single `@font-face` per HTML page (added in U5); CSS body chain: `font-family: "Vectrix", ui-monospace, monospace`
- The landing page CSS `--font-display: "Vectrix"`, `--font-mono: "Vectrix"`. Body labels stay at `font-weight: 400`. For display contexts that currently rely on Orbitron 500/700/900, browsers synthesize bold from a single-weight TTF via outline-offset duplication, which can read as uneven or blurry — **verify each Orbitron `font-weight: 700+` consumer during U6 sweep**: landing buttons `.label`, overlay titles in Player/Controls/About, TUTORIAL COMPLETE title (clamp(40px,7vw,64px) bold), STORY MODE LOCKED title. If synthesized bold reads worse than current Orbitron Black at the same size, two fallbacks: (a) drop to `font-weight: 400` and let Vectrix stand on its own visual weight (likely fine since the typeface is already display-shaped), or (b) defer a second bake of a thicker stroke variant (delta=75 instead of 50) to follow-up work — single-rollout scope shouldn't fork the bake pipeline mid-flight.
- **R15 side-by-side procedure (operationalized).** For each context below, in `pnpm dev`, temporarily render the target element twice on the page — once with `font-family: "Vectrix"` and once with `font-family: "Space Mono"` at the same size — and visually compare at 100% zoom on the project's primary target (1080p Retina). Verdict per context: pass (Vectrix is readable without leaning in or squinting), marginal (readable with extra attention — counts as pass for v1), fail (illegible or visibly slower to scan than Space Mono). Only fails go onto the fallback list.
- Contexts to validate at 12-13px:
  - Controls overlay table (the 3-column action / primary / secondary list) — KEY ACCEPTANCE EXAMPLE (AE1)
  - About overlay body
  - Settings menu slider labels
  - Menu button subtitles ("Story mode" / "Practice freely" / "🔒 Complete tutorial first")
  - Pause menu stat row (currently uses `ui-monospace` per `pause-menu.ts:119`)
- **Per-rule override targets.** The `--font-mono` variable swap flows through `.controls-cell`, `.about-body`, `.tagline`, `.menu-btn .label`, `.menu-btn .desc`, plus the pause menu inline cssText. When a context fails, the fallback override is applied at the rule level for that specific selector — not by changing the variable.
- If a context fails the test → revert that specific selector to `font-family: "Space Mono", ui-monospace, monospace` for 12-13px only. Vectrix stays in use at 14px+. Document each fallback inline with a comment naming the reason (e.g. `/* Vectrix illegible at 12px in this dense table — falling back to Space Mono. See R15. */`).
- The fallback decision is per-context, not global. Failing in Controls table does NOT pull Vectrix from button subtitles.
- **Google Fonts conditional cleanup.** After the readability sweep, if zero contexts fall back, remove the Space Mono Google Fonts `<link>` from `index.html` / `intro.html` / `epilogue.html`. If any context fell back, **retain** the Space Mono `<link>` on the affected page(s) — otherwise the `font-family: "Space Mono"` declaration is inert (browsers fall through silently to `ui-monospace` and R16 isn't actually delivered). Orbitron `<link>` is removed unconditionally because U8 migrates the only Orbitron consumer on each page.

**Test scenarios:**
- AE1 covered: visit `/index.html` → click CONTROLS → table renders at 12px. Without leaning in, a reader can identify their DASH binding ("SPACE", "X", or whatever they've bound). If readable: leave on Vectrix. If not: fall back to Space Mono in that context with the documented comment.
- AE3 covered: fresh `Cmd+Shift+R` reload of `/index.html` → first paint shows VECTRIX logo (still Orbitron — U8 migrates), menu buttons in Vectrix, tagline "vector odyssey" in Vectrix. The logo and the buttons feel like the same family (insofar as Vectrix matches the Orbitron-derived design of U2).
- Every overlay (Player / Controls / About) opens cleanly; no characters missing; no layout shifts vs prior.
- Pause menu (Esc in `/rooms.html`) renders all four sections (title / stats / RESUME button / RESTART button / QUIT) on Vectrix.
- TUTORIAL COMPLETE overlay (clear `/tutorial.html`) renders title + subtitle + 3 CTA buttons on Vectrix.
- STORY MODE LOCKED state — clear localStorage `dash-proto:tutorial-completed`, visit `/rooms.html` → locked overlay renders on Vectrix.

**Verification:** Walk every DOM surface; verify font visibly changed. Run the 12px readability test on the five contexts above. Document any per-context fallbacks.

**Execution note:** This unit is where the brainstorm's largest risk (body 12px readability) actually lands. If the renderer's open-form lowercase reads worse than expected, the R16 fallback is the safety net — don't override it by lowering body sizes elsewhere in the UI.

---

### U7. Per-segment animation system + scramble migration

**Goal:** First-class draw-in, scramble-in, dissolve-out animations at the segment level. The existing character-level scramble in `scramble-text.ts` rewritten on top of the new system; all 5 callers automatically pick up segment-level behavior through the unchanged public API.

**Requirements:** R9, R10, R11; covers AE2

**Dependencies:** U1 (renderer), U2 (uppercase glyphs), U4 (lowercase glyphs — INFECTED ZONE is uppercase but other scramble callers mix case)

**Files:**
- `src/lib/font/animations.ts` (new) — `Animation` types + `resolveAnimatedSegments(glyph, animation, time)` returning the modified segment list + per-segment alpha/offset for the renderer
- `src/lib/font/font.ts` (modify) — `drawText` accepts optional `animation: Animation` on `TextDrawOpts`; when present, sprite cache is bypassed and segments are evaluated per-frame
- `src/lib/scramble-text.ts` (modify) — `drawScrambleText` rewritten to use the new animation system. **Public API (function signature + `makeScrambleSchedule`) stays identical** so all 5 callers don't change.
- `KEY ACQUIRED` in `src/rooms/rooms-game.ts` gets a `drawIn` animation — proves the system isn't just for scramble
- Enemy-kill score "+N" gets a `dissolveOut` animation as the closing beat — demonstrates the third primitive. Wire as opt-in per call site (a flag on the floating-text spawn, not a default on every kill float), so combat-cascade perf stays within the U3 budget — see Risk Analysis row "Per-segment animation perf during kill cascades"

**Approach:**
- `Animation = { kind: "drawIn"; age, duration } | { kind: "scrambleIn"; age, duration; settledCount; glitchOutDuration? } | { kind: "dissolveOut"; age, duration }`
- `drawIn`: segments revealed sequentially. Per-glyph segments order matters — author each glyph's segments in stroke order (left-to-right, top-to-bottom for letters). `numSegmentsRendered = floor(progress * totalSegments)`.
- `scrambleIn`: segments at index >= `floor(text.length * progress)` are rendered with a per-segment random offset (`±jitterPx` along normal) and replaced with a noise-glyph's segments. As progress advances, more segments "settle" into the real glyph. The `flickerStep` mechanic from the existing implementation carries over for frame-stable noise.
- `dissolveOut`: each segment gets a per-segment phase offset; segments accelerate outward + fade. Per-segment displacement increases with `(age - phase) / falloff`.
- `drawScrambleText` rewritten: internally constructs a `scrambleIn` animation per call from the existing `ScrambleSchedule` data and passes it to `drawText`. Callers don't change.
- `drawText` with `animation`: bypasses sprite cache, walks segments and calls `resolveAnimatedSegments`, strokes the returned list.

**Patterns to follow:**
- `src/lib/scramble-text.ts` algorithm for time-driven settled-count growth + dying glitch
- **Do NOT widen the shared `FloatingText` type** in `src/lib/particles.ts`. Two demonstration call sites don't justify adding an `animation` field to a pool-managed type consumed by 30+ existing callers. Instead, `src/rooms/rooms-game.ts` keeps a small parallel list (e.g. `animatedTexts: { text, x, y, age, lifetime, animation, color, size }[]`) for the animated cases, drawn in its own pass after `drawFloatingTexts`. Pool semantics stay simple; a future broader rollout can re-evaluate the type after it's earned its keep.

**Test scenarios:**
- INFECTED ZONE label re-enters Room 1 viewport → scramble plays: segments shuffle and snap into place, not whole characters cycling through a glyph pool. **Covers AE2.**
- "TO BE CONTINUED" in epilogue → scramble enters; on glitch-out (`glitchOutDuration: 0.8`), settled count walks back from full to 0 with segments fragmenting before the text disappears.
- Intro "who am i?" scramble in `/intro.html` → enters cleanly, holds, fades.
- Tutorial "who was that?" boot thought → enters after intro cinematic, holds, fades; verify with a fresh tutorial run.
- Rooms "how do i do this?" boot thought on first Rooms arrival (`rooms-game.ts:2602`, world-space anchored to player.y + 80, only fires when `arrivedFromTutorial && currentRoom.id === "room1"`) → enters, holds, fades cleanly during a fresh tutorial → rooms transition. This is the 5th scramble call site; verify timing/jitter/glyph coverage match the others.
- Pick up a Key in `/rooms.html` → "KEY ACQUIRED" floating text plays the new `drawIn` animation: segments draw stroke-by-stroke as the text floats up. Settles within 300-400ms.
- Kill an enemy in `/rooms.html` → "+800" score plays `dissolveOut` at the end of its lifetime: segments break loose and fade outward instead of just fading uniformly.
- F2 perf overlay during an active scramble: `text` section stays within 3-4ms (per-frame segment resolve is more expensive than cached blit; acceptable for the small window of an animation).

**Verification:** All 5 existing scramble call sites continue to work without code changes. INFECTED ZONE visibly reads as segment-level (the brainstorm's defining acceptance criterion). New animations on KEY ACQUIRED + score floats demonstrate the system is exercised, not just shipped.

---

### U8. VECTRIX logo canvas migration + Google Fonts removal

**Goal:** The landing page VECTRIX logo is rendered through canvas using direct segment data + per-segment effects. Last and most visible piece of the migration.

**Requirements:** R14; covers AE3

**Dependencies:** U1, U2, U7

**Files:**
- `src/landing/logo-canvas.ts` (new) — `createLogoCanvas(canvas, font): LogoState` + `updateLogo(state, dt)` + `drawLogo(ctx, state)`. Owns the entrance cascade, breathing, and RGB-split glitch.
- `index.html` (modify) — replace `<h1 class="logo">` element with `<canvas id="logo-canvas">`; remove `.logo`, `.logo-letter`, `@keyframes letter-enter`, `@keyframes logo-breathing`, `.glitch::before`, `.glitch::after` CSS rules
- `src/landing/main.ts` (modify) — locate the new canvas, initialize the logo state with the shared `FontRenderer`, drive its update + render from the same `requestAnimationFrame` loop that already owns the eye preview + menu background. Remove the old `scheduleLogoGlitch()` timer.

**Approach:**
- Canvas dimensions: responsive, `clamp(56px, 12vw, 120px)` tall as before; aspect ratio derived from "VECTRIX" string width via `measureText`. HiDPI-scaled via `devicePixelRatio`.
- Logo render path:
  - Default state: VECTRIX at large display-mode glyphs, `lineWidth` 8-12 for the bold look, with a soft outer glow rendered as a wider, faded second stroke (per the "fake glow" trick in CLAUDE.md's perf architecture — avoid `shadowBlur` per frame).
  - Entrance cascade: per-letter `drawIn` animation from U7, 80ms stagger across the 7 letters → ends at 7 × 80 = 560ms.
  - Breathing: parent-scope scale ↔ 1.0–1.02 on a 2.5s sin; outer glow alpha pulse 0.6–1.0 in lockstep. Skip during glitch.
  - Glitch: every 10–25s (preserving the existing cadence), render 3 stacked copies for 60-200ms — red copy at (-4, 0), white core at (0, 0), cyan copy at (4, 0). Whole logo shifts +6px right for the duration.
- All effects driven from segment data — the RGB-split is three full re-renders of the same segment list with color/offset variation; the entrance cascade uses U7's `drawIn` per letter; breathing scales the whole stack.
- **Reduced-motion handling.** The current CSS `@media (prefers-reduced-motion: reduce) { .logo, .logo-letter { animation: none; ... } }` no longer applies once `.logo` becomes a canvas. `createLogoCanvas` reads `window.matchMedia("(prefers-reduced-motion: reduce)").matches` at init and stores it in `LogoState.reducedMotion`. Subscribe to changes via `mediaQuery.addEventListener("change", ...)` so a runtime preference flip is honored. When `reducedMotion` is true: skip the entrance cascade (paint all letters at final position on frame 1), freeze breathing scale at 1.0 and glow at midpoint alpha, suppress glitch entirely. The static logo is still rendered every frame so the canvas isn't cleared — just without animated state changes.
- Final cleanup: the Orbitron Google Fonts `<link>` lines were already removed in U6 — this unit just retires the now-orphan CSS for `.logo`, `.logo-letter`, `@keyframes letter-enter`, `@keyframes logo-breathing`, and the `.glitch::before` / `.glitch::after` pseudo-element rules.

**Test scenarios:**
- AE3 covered: hard-reload `/index.html` → logo first-paints with cascade animation (V → E → C → T → R → I → X within ~560ms total), tagline lands after, menu buttons follow. Visual cohesion: logo and buttons feel like the same family.
- Logo glow pulses on a 2.5s cycle; visually smooth, no per-frame stutter on F3 (FPS overlay).
- Wait 10-25s on the landing page → glitch fires: RGB-split visible for the documented duration, logo shifts right, settles back.
- Resize the window (mobile breakpoint) → logo scales fluidly; segment-based rendering quantizes cleanly because of em-aligned coordinates.
- Run with `prefers-reduced-motion: reduce` → entrance + breathing + glitch are gated to a single static draw (matches CLAUDE.md's accessibility rule that already applies to the menu background).
- F2 perf overlay (F2 isn't currently wired into the landing — but verify with a manual `console.log` if needed): logo render per frame stays under 1ms in steady state (breathing only, no glitch); peaks during entrance + glitch are bounded.

**Verification:** Landing page visually feels cohesive with the rest of the typography. No CSS-driven logo styles remain. Reduced-motion accessibility honored.

**Execution note:** The logo is the most visible thing on the site; ship this last so the rest of the system has had time to stabilize. If the per-segment `drawIn` cascade reads as less impactful than the old CSS-driven cascade, layer the breathing pulse to start at the moment the last letter lands rather than from frame 1.

---

## Scope Boundaries

**In scope:** Everything listed in the Requirements Traceability table above.

**Out of scope (carried verbatim from origin):**

- Cyrillic, Greek, or any non-Latin scripts — game is currently English-only
- Variable fonts / `font-variation-settings` axes — single-weight data, weight is rendered, not authored
- Replacing existing DOM overlays with canvas renders — DOM stays DOM, only the font changes
- A user-facing setting to choose, customize, or disable the new font
- Localization, RTL support
- Use of an external font editor (Glyphr Studio, FontForge, Robofont) — segment master lives in code as data
- Audio cues tied to text-animation events
- Any changes to non-text visuals (palette, neon glow, hex shells, eye stack, scanlines)
- `src/landing/menu-bg.ts` matrix-rain canvas text — uses half-width katakana (`ｱｲｳｴｵ…`) which is non-Latin and out of Vectrix's glyph set by the same rule that excludes Cyrillic. The matrix rain explicitly stays on `Courier New / ui-monospace, monospace` as a deliberate design carve-out; Phase 2 verification's "every canvas-side text site uses Vectrix" claim is scoped to Latin glyphs, with the matrix rain excluded.

**Out of scope (plan-time additions):**

- `ttfautohint` or commercial hinting tools — Hinting at body 12px is partially mitigated by em-aligned grid coordinates (U2); residual readability failure falls back to Space Mono per R16, not to additional tooling. Re-evaluate if more than 2 of the 5 readability contexts fail.
- A test framework — The project has no automated test framework today; adding one is a separate effort. Test scenarios in this plan are framed for visual / behavioral verification.
- Backporting the typography changes to any unmerged feature branches — author scope only.

### Deferred to Follow-Up Work

- **Capture a `docs/solutions/` learning** after U8 lands — covering (a) the stroke→fill thickening decision and the Clipper2 trade-offs, (b) the Vite plugin + opentype.js pipeline, (c) any Safari-specific gotchas, (d) the per-context Space Mono fallback contexts (if any survived) and why. Run via `ce-compound`. Not blocking on landing.
- **`ttfautohint` evaluation** — only if the per-context fallback list from U6 has more than 2 entries. Tracks: should hinting come into the pipeline as a CLI post-step, or accept the fallback as the long-term shape.
- **Cyrillic glyph set** — when localization becomes a project goal.
- **PR-time perf budget enforcement** — F2 measurement is manual today; a CI gate that fails the PR if `text` section exceeds 2ms during a canned combat replay would be useful but is out of plan scope.

---

## Key Technical Decisions

- **Stroke-segment master format vs filled-outline master.** Canvas needs direct stroke access for per-segment animation; DOM needs a real font for legibility and CSS interop. Authoring twice (segments for canvas + outlines for TTF) breaks the single-source-of-truth rule. Decision: author segments, derive outlines via Clipper2 thickening at bake time. Cost is one extra build-time dep and an offset pass per glyph; benefit is one authoritative master that both consumers respect.
- **Bake stack: opentype.js 1.3.4 + js-angusj-clipper + wawoff2.** Picked over fonteditor-core because opentype.js has the cleanest greenfield Font/Glyph/Path API. wawoff2 is one `await compress(buf)` call for TTF → WOFF2 (opentype.js emits only TTF/OTF). All three are devDependencies — zero runtime impact. If opentype.js 1.3.4 hits a blocking bug, swap to `github:opentypejs/opentype.js#master` (same API, just more recent unreleased fixes).
- **Vite plugin, not prebuild script.** A `package.json` "prebuild" forces a full dev-server restart on every glyph edit. The plugin watches the glyph data file and triggers re-bake + full reload — meaningful during design iteration.
- **Em-aligned coordinates as partial mitigation for unhinted rendering.** opentype.js doesn't write hinting tables. Authoring on a 100-unit grid (within unitsPerEm = 1000) helps but doesn't fully replace hinting — at 12px a 100-unit stroke maps to 1.2 device-pixels which rasterizes to 1px or 2px depending on subpixel start position, producing some stroke-weight variation glyph-to-glyph. This is why R15 validates each context with a side-by-side Space Mono comparison and R16 documents per-context fallbacks. If more than 2 of the 5 readability contexts fall back to Space Mono, escalate to `ttfautohint` per the Deferred to Follow-Up Work entry.
- **Glyph sprite cache for stable strings.** Stroking ~5-12 segments per glyph per frame is fine for short labels but adds up during boss combat where 30 floating texts spawn simultaneously. Cache static strings by `${char}|${px}|${color}|${mode}`; cache dynamic strings at glyph granularity (so "15234" reuses cached "1" + "5" + "2" + "3" + "4" blits).
- **Animation bypasses sprite cache.** Per-segment animation invalidates the cache key per frame, so animated text strokes directly. This is intentional — animated text is a small temporal window, not the hot path.
- **8 implementation units, not 4-5 larger ones.** "Потихоньку внедрять" wants bisectable PRs. Each unit lands a coherent, testable slice without breaking the prior unit's surface.
- **No test framework added.** Tests in this plan are visual / behavioral. Adding Vitest or similar is its own scope. The trade-off is acceptable given the visual-first nature of typography work and the project's existing convention (CLAUDE.md doesn't mention tests; `pnpm build` is the gate).
- **Logo last.** The VECTRIX wordmark is the most visible part of the brand. Migrate it after the rest of the system has stabilized so a regression in U1-U7 doesn't take the logo down with it.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stroke→fill thickening produces self-intersecting polygons at tight glyph joins | Medium | High (broken glyphs in TTF) | Prototype with a single glyph in U5 before running the full bake. Fall-back chain: `JoinType.Miter` → `JoinType.Square` → `JoinType.Round`. If a specific glyph fails, hand-author its filled outline as an override in `glyphs.ts` (a `bakeOutlineOverride?` field — keeps the canvas path stroke-driven). |
| Body 12px readability fails in 3+ DOM contexts | Medium | High (per-context Space Mono fallbacks pile up, brand cohesion suffers) | Validate per-context in U6. Per R16, fallback is documented and bounded. If >2 contexts fail, escalate: evaluate `ttfautohint` (deferred work) or adjust glyph design at low x-height. |
| Glyph sprite cache memory growth on a long session | Low | Low (each glyph at one color/size is ~5KB; 100 glyphs × 5 sizes × 8 colors = ~20MB worst case) | Cache key rounds size to integer pixels (already in pattern). Static color palette (8 entries via `PALETTE`) bounds color dimension. No cache eviction in v1 — re-evaluate only if profiling shows growth. |
| opentype.js 1.3.4 bug blocks the bake | Low | Medium | Pin to `github:opentypejs/opentype.js#master` as documented fallback. Both produce the same output API. |
| Per-segment animation perf is worse than character-level | Low | Medium | Animations bypass sprite cache by design; perf budget is measured in U3 via the new `text` perf-meter section. Animations are temporal (intro / hit feedback / scramble) — not a hot path. If F2 shows >5ms spikes during scramble, reduce noise segment count or pre-bake noise variations. |
| HMR re-bake in dev mode is slow enough to disrupt iteration | Low | Low | Bake time at ~100 glyphs is sub-second on a modern machine. If it slows, the `addWatchFile` hook can debounce. Worst case: full server restart, same speed as today. |
| Visual cohesion regresses — Vectrix doesn't feel like a step up from Orbitron + Space Mono | Medium | High (whole project value depends on this) | Glyph design is iterative — U2 and U4 can be revisited after U3 and U6 reveal visual issues. Plan keeps the pre-tag rollback point (`pre-font-refresh`) explicit. |
| Phase mid-flight: U3 lands but U4 or U5 stalls; mixed-font UI for weeks and AE3 cannot be verified | Medium | High | Each unit is independent enough to ship cleanly, but the AE3 verifiability gap is real — visual cohesion is THE goal and it's gated on U5 + U6 landing. Mitigation: if U4 stalls beyond ~1 week, escalate the lowercase design effort or restructure U5 as a contingency to bake uppercase-only first. Mixed canvas-Vectrix + DOM-Orbitron state is acceptable as a brief transition but not as a long-term resting point. |
| Generated TTF is too large for low-bandwidth users | Low | Low | A ~100-glyph stroke-vector font is ~10-30KB WOFF2. Compared to Orbitron + Space Mono Google Fonts (~50-100KB each, multi-weight), this is a net win. |

---

## Phased Delivery

The 8 units are designed to ship in sequence, each as a standalone PR with no rollback dependency on the next. **"Bisectable" here means "no broken state at any point," not "each PR is a self-contained UX improvement."** Specifically: U3 and U4 ship canvas-side Vectrix while DOM still uses Orbitron + Space Mono — that's an intermediate visual state, not a regression. U6 first delivers visible DOM Vectrix, so AE3 (logo + menu buttons same family on first paint) becomes verifiable only after U5 + U6 land. If U4 stalls or its lowercase glyph design takes longer than expected, the project sits in mixed-font state until both U4 and U5 ship — see the upgraded "Phase mid-flight" risk row for the impact size.

- **Phase 1 — Foundation (U1, U2):** Internal-only. Glyph data, renderer, sprite cache, ~70 uppercase + digit + punct glyphs. Verified through a sandbox dev preview gated behind a query param. No user-visible change; no risk to live game.
- **Phase 2 — Canvas migration (U3, U4):** First user-visible changes. HUD, floating text, overlay titles (U3), then lowercase + cinematic typewriter + background-text (U4). Pages on `rooms.html` / `sandbox.html` / `tutorial.html` migrate; landing stays on Orbitron.
- **Phase 3 — DOM rollout (U5, U6):** Build-time bake (U5) generates the TTF. DOM CSS swaps to Vectrix across all pages (U6). Body 12px validation lands here. Google Fonts removal happens in U6.
- **Phase 4 — Polish (U7, U8):** Per-segment animation + scramble migration (U7), then the VECTRIX logo canvas migration (U8). Last and most visible.

At each phase boundary, the work is committable, deployable, and visually coherent within itself.

---

## System-Wide Impact

| Surface | Impact |
|---|---|
| Canvas hot path (HUD + floating text + overlay) | Reroutes through new `drawText`. Perf measured via new `text` section in F2. Budget: <2ms per frame at peak floating-text count. |
| DOM landing page CSS | `--font-display` + `--font-mono` swap to "Vectrix"; old keyframe rules for `.logo` removed (U8). |
| Google Fonts dependency | Removed from all HTML pages. Saves ~100-200KB of network and a request-blocking link. |
| `localStorage` schema | Untouched. No font preference, no migration. |
| Settings menu | Body font swap only. No new settings rows. |
| `pnpm dev` workflow | Vite plugin watches `src/lib/font/glyphs.ts`; glyph edits trigger full-reload re-bakes. No new dev-server commands. |
| `pnpm build` | Adds the bake step. Generated WOFF2 emitted to `dist/fonts/`. Build time impact: ~1-2s. |
| Existing scramble callers (5 sites) | API unchanged. Visual change: scramble reads as segment-level instead of character-level. |
| Existing sprite caches (9 modules) | Untouched. The new glyph cache follows the same pattern. |
| `LESSONS.md` / `docs/solutions/` | A follow-up learning is recorded after U8 via `ce-compound`. Not in plan scope. |

---

## Dependencies / Prerequisites

- **Runtime:** None — all new code is canvas-side stroke + sprite-cache logic + DOM `@font-face`.
- **Build-time (added as devDependencies in U5):**
  - `opentype.js@1.3.4` (or `github:opentypejs/opentype.js#master` if 1.3.4 hits a blocker)
  - `js-angusj-clipper` (latest stable — Clipper2 WASM bindings)
  - `wawoff2` (latest stable — TTF → WOFF2 compression)
- **Tagging:** `git tag pre-font-refresh` at U1 start (CLAUDE.md "commit before large changes" rule).
- **Assumed:** browser support for `@font-face` with WOFF2 — already universal for the target audience (project is 2026; WOFF2 is supported everywhere since 2017).

---

## Verification Strategy

Each unit's verification is local to that unit. Cumulative verification across the rollout:

- **After Phase 1 (U1-U2):** Dev preview at `sandbox.html?fontpreview` shows the full uppercase + digit + HUD-symbol glyph set in display + body mode at 12 / 14 / 18 / 24 / 60px. Family resemblance visible.
- **After Phase 2 (U3-U4):** Full traversal — landing → tutorial → rooms run to Sentinel kill → epilogue. Every canvas-side text site uses Vectrix. Lowercase tagline reads. Background-text spawns and types. Tutorial hint banner shows correct rebound keys. F2 `text` section under 2ms peak.
- **After Phase 3 (U5-U6):** DOM rollout complete. Every overlay, settings row, button label uses Vectrix. Body 12px contexts validated per R15; any fallbacks documented in code comments. AE1 verified on the Controls table. Google Fonts links absent from page HTML. Network tab shows `vectrix.woff2` loaded.
- **After Phase 4 (U7-U8):** INFECTED ZONE scramble visibly reads as segment-level — AE2. KEY ACQUIRED draws in stroke by stroke. VECTRIX logo on landing renders through canvas with the entrance cascade, breathing pulse, and RGB-split glitch — AE3 fully covered.

End-state acceptance: every requirement R1-R16 traceable to a unit; every AE1-AE4 covered by a unit's verification.

---

## Known Implementation-Time Decisions

Decisions the plan deliberately leaves for the implementer to make in the unit's context, where pre-locking the answer in the plan would freeze design judgment that needs the real code in front of it.

- **Exact glyph segment data** for the ~100 glyphs in U2 + U4 — drawing/iterating is the work of those units, not the plan
- **Final per-context Space Mono fallback list** — surfaces during U6 readability validation
- **Exact bake script TypeScript shape** (function names, type signatures) — finalized in U5
- **Animation timing curves** for draw-in / dissolve-out — tunable during U7
- **Whether `bakeOutlineOverride` field is needed** on the Glyph type — only if Clipper2 produces a broken polygon during U5 prototyping
- **Mobile breakpoint scaling for the canvas logo** — exact dimensions determined during U8

---

## Outstanding Questions

### Resolve Before Implementation

*(none — Phase 5.1 review confirms all product-level scope is resolved.)*

### Contingent Decisions (resolved during implementation)

- [Affects U5][Technical] If the dev-server middleware approach for `/vectrix/fonts/vectrix.woff2` in `configureServer` causes issues, fall back to writing the file to `public/fonts/vectrix.woff2` from `buildStart`. Both shapes are documented in the external research.
- [Affects U6][Behavioral] How many of the 5 per-context readability tests will require Space Mono fallback. Decided by direct measurement during U6, not by pre-judgment.
- [Affects U8][Visual] Whether the canvas logo glitch effect needs additional polish to match the visual weight of the current CSS RGB-split. Adjustable during U8.

---

## Future Considerations

(Not blocking, recorded only because they came up during planning.)

- **Variable-axis exploration** — Vectrix is single-weight by design, but a future "weight axis" could be added by varying stroke width across the glyph set and generating multiple WOFF2 files. Out of scope here; trivially additive later.
- **Distinct lowercase display variants** — Currently most lowercase glyphs ship with only `displaySegments`. If a future use case wants distinct display vs body lowercase (e.g. a stylized capitalized title with display lowercase), add `bodySegments` where it makes sense.
- **WOFF1 fallback** — Skipped because WOFF2 has been universally supported for years. If a need surfaces (very old corporate browser), add WOFF1 output via opentype.js's `font.toArrayBuffer()` directly (no compression step) and an additional `@font-face src` entry.
