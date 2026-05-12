---
date: 2026-05-12
topic: vector-font-refresh
---

# Vector Font Refresh

## Summary

Full replacement of Orbitron + Space Mono with a single custom stroke-vector typeface designed as ordered segment data per glyph. Canvas renders directly from segment data; DOM uses a TTF/WOFF baked from the same data via opentype.js. Modernized stroke character with display/body form variants from one master, per-segment animations (draw-in, scramble, dissolve) as first-class, body 12px readability validated side-by-side with Space Mono and falling back to Space Mono per-context if it fails.

---

## Problem Frame

The current type stack (Orbitron display + Space Mono body) is competent but generic — it ships with countless synthwave web projects. The game's identity — its name VECTRIX, the tagline "vector odyssey", the stroke-rendered eye, the hex Sentinel, the vector-arcade silhouettes drifting in the menu background — leans hard into a vector aesthetic that the typography doesn't echo. Every visible text element is currently disconnected from the visual language of the game world; the type sits adjacent to the design rather than being part of it.

The recent INFECTED ZONE scramble animation hints at what a more integrated type system could enable, but it operates at character level on top of a web font and can't be pushed further — segments, draw-in, dissolve are all out of reach. The cost of staying with two third-party web fonts is opportunity: the game can't develop a distinctive typographic voice as long as it borrows one.

---

## Requirements

**Glyph design**

- R1. Each glyph is authored as an ordered list of stroke segments (polylines and/or short curves) on a shared grid, expressed as data — not as raster sprites or filled outline paths.
- R2. The typeface character is "modernized stroke" — clean enough to read at body sizes, vector enough to feel hand-drawn from line primitives. Visibly descended from Asteroids 1979, not a literal revival.
- R3. Display and body forms come from one master. Display sizes use open forms (E with no middle bar, R with open leg, A with no crossbar, etc.); body sizes use closed forms with the same skeleton.
- R4. Single weight at the data level; rendered weight is controlled by stroke width in canvas and `font-weight` in DOM.
- R5. Glyph coverage: uppercase A-Z, lowercase a-z, digits 0-9, ASCII punctuation used in-game (`, . : ; / - _ ! ? + = % ( ) [ ] < > # @ $ * ' " | \ &`), plus HUD-specific symbols already in the game (`↑ ↓ ← → ▶ ↺ × ✕`).

**Rendering pipeline**

- R6. Canvas-side text rendering reads segment data directly and draws via stroke operations, bypassing any web-font path. This is the path for all in-game text: HUD, floating text, canvas-drawn overlay titles, background-text.
- R7. DOM-side text is rendered through a TTF/WOFF file baked from the same segment data using opentype.js (or equivalent) so DOM and canvas share one source of truth.
- R8. The bake step runs at build time, not at runtime — the generated font file ships as a static asset.

**Animation primitives**

- R9. The font system exposes per-segment animation hooks as first-class: draw-in (segments appear sequentially), scramble-in (segments shuffle position/index and settle), dissolve-out (segments break off and fade).
- R10. The existing character-level scramble used for the INFECTED ZONE label migrates to segment-level scramble using the new system; visual feel becomes finer-grained.
- R11. Animations are opt-in at the call site — plain text renders with no animation by default.

**Application scope**

- R12. The new typeface replaces Orbitron for all display contexts: VECTRIX logo, canvas overlay titles (SENTINEL, VICTORY, TUTORIAL COMPLETE, GAME COMPLETE), landing-page overlay titles (PLAYER / CONTROLS / ABOUT).
- R13. The new typeface replaces Space Mono for all body contexts: HUD (SCORE / HP / TIME / ROOM / MULT), floating text, background-text, menu buttons, tagline, settings labels, controls overlay table, about overlay body, pause menu.
- R14. The VECTRIX logo on the landing page is rendered through canvas using direct segment data (not DOM/TTF) so per-segment effects — the existing RGB-split glitch, breathing, entrance cascade — are first-class instead of CSS approximations.

**Readability fallback**

- R15. Body 12px readability is validated against Space Mono on each affected screen (Controls overlay table, About body, settings labels, button subtitles, HUD). If readability fails the side-by-side test, that context's body text at 12-13px falls back to Space Mono; the vector font remains in use at 14px and above.
- R16. The fallback decision is per-context, not global — failing in the Controls table does not pull the font out of HUD floating text.

---

## Acceptance Examples

- AE1. **Covers R15, R16.** Given the new vector font rendered at 12px in the Controls overlay table next to Space Mono at the same size, when a reader scans the table to find their DASH binding, they can read every label without leaning in or squinting; if they can't, the Controls table specifically (not the broader About body, not the HUD) reverts to Space Mono for that size.
- AE2. **Covers R9, R10.** Given the INFECTED ZONE label re-enters the viewport, when the scramble plays out, the visible motion is segments shuffling and snapping into place — not whole characters cycling through a glyph pool as they do today.
- AE3. **Covers R6, R7, R12, R13.** Given a fresh load of the landing page, when the page first paints, the VECTRIX logo and the menu button text both render in the new typeface and feel like the same family — same proportions, same stroke style, same vibe.
- AE4. **Covers R3.** Given the letter "E" rendered at 60px (overlay title) and at 14px (button label) on the same screen, when both are present, the display "E" has the open form (no middle bar) and the body "E" has the closed legible form, and the family resemblance is clear.

---

## Success Criteria

- Typography reads as part of the game's visual language rather than borrowed from a web-font menu — the type and the gameplay visuals look like they come from the same studio.
- Every visible text element on every screen uses the new typeface (or, for any body 12px context that failed the readability test, the documented Space Mono fallback).
- The INFECTED ZONE scramble and at least one additional animation primitive (draw-in or dissolve-out) are visibly used in-game; the system is exercised, not just shipped.
- A downstream implementer can pick this up without having to make product calls about scope, character set, fallback policy, or what gets animated.

---

## Scope Boundaries

- Cyrillic, Greek, or any non-Latin scripts (game is currently English-only).
- Variable fonts / `font-variation-settings` axes — single-weight data, weight is rendered, not authored.
- Replacing existing DOM overlays with canvas renders — DOM stays DOM, only the font changes.
- A user-facing setting to choose, customize, or disable the new font.
- Localization, RTL support.
- Use of an external font editor (Glyphr Studio, FontForge, Robofont) as part of the pipeline — the segment master lives in code as data.
- Audio cues tied to text-animation events.
- Any changes to non-text visuals (palette, neon glow, hex shells, eye stack, scanlines) — the brief is typography only.

---

## Key Decisions

- **Stroke-segment data as the master format.** Canvas needs direct access for per-segment animation; DOM needs a real font for legibility and CSS interop. Baking one from the other beats authoring twice.
- **One typeface, two form modes (open / closed) from one master.** Avoids shipping two unrelated fonts that visually drift apart; the open-form display variant carries the Asteroids spirit, the closed-form body variant carries readability.
- **Aggressive single-rollout scope including body 12px.** Chosen by the user against a flagged readability risk; the per-context fallback (R15-R16) is the safety net.
- **Animation as first-class capability of the font, not a decoration layer.** Lets the existing scramble pattern deepen and lets future flows (room intros, score events, ability unlocks) inherit the same vocabulary cheaply.
- **No external font editor in the pipeline.** Segment data is small enough to author in code and review in PRs; an editor would add tooling friction and a binary master that doesn't diff.

---

## Dependencies / Assumptions

- `opentype.js` (or an equivalent such as `fonteditor-core` or `fontkit`) is the bake tool — added as a build-time dependency, not a runtime one.
- The bake step runs from Node during `vite build`. If it has to run in-browser for any reason, the canvas-only rendering path (R6) still works and DOM falls back to Space Mono until the bake lands.
- Body 12px readability is the largest design risk; the per-context fallback (R15-R16) is the documented mitigation, not "we'll just make it good enough."
- `pnpm build` (`tsc && vite build`) remains the canonical gate; the bake step is added to that pipeline rather than to a separate workflow.

---

## Outstanding Questions

### Resolve Before Planning

*(none — all product-level scope is resolved.)*

### Deferred to Planning

- [Affects R1, R7][Technical] Final choice of grid resolution (7x9 vs 8x10 vs free coordinates within a normalized em-box) — depends on what makes lowercase and open-display variants both work; design exploration in early planning.
- [Affects R7, R8][Needs research] Bake-time tool selection between `opentype.js`, `fonteditor-core`, and `fontkit` — depends on which one cleanly accepts pre-stroked path data and produces a TTF small enough to ship.
- [Affects R6][Performance] Per-frame cost of stroking N segments per glyph for HUD + floating text vs the current `fillText` of a web font. Sprite caching for stable HUD strings (already used elsewhere in the codebase) is the obvious knob; needs measurement.
- [Affects R14][Technical] Landing-page logo migration from CSS `::before` / `::after` RGB-split + keyframes to canvas-driven per-segment effects — depends on whether the existing breathing / glitch beats translate cleanly to segment-level or need a re-design.
- [Affects R12, R13][Migration] Implementation phasing inside the single rollout (display first, body second, logo last vs all at once in one PR). User picked a single rollout; the internal phasing is open.
