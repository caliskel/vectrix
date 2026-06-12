---
date: 2026-06-12
topic: visual-overhaul-zone-themes
---

# Visual Overhaul — Zone Themes (GD-inspired juice within the VECTRIX principle)

## Summary

Build a single zone-theme system that dresses every mode (sandbox, campaign, tutorial): a per-zone colored floor wash, self-luminous wireframe parallax decor, walls with neon trim and details, and irregular arena silhouettes — all inside the existing dark cyberpunk-minimalism aesthetic. The theme API carries a 0..1 intensity parameter from day one (static at first) so gameplay reactivity can layer on later without rework.

Visual target: `docs/brainstorms/visual-overhaul-reference.jpg` (AI-generated reference, approved by the author as the bar for "juicy").

---

## Problem Frame

The game currently reads as a set of bare walls on a dark floor. The arena background has a subtle deep-field layer (dust, grid pulses, radar sweeps) and the margins have faint energy lines and terminal text, but the overall picture stays austere: flat dark floor, plain rectangular rooms, walls that are a fill and a stroke. Geometry Dash was named as the reference for what "juicy" feels like — saturated living color, layered depth behind the playfield, decorated geometry, everything pulsing.

The tension: VECTRIX's identity (per `VECTRIX_LORE.md`) is dark cyberpunk minimalism — near-black, mysterious, restrained. The campaign additionally runs a darkness overlay with a ~270 px visibility radius around the player. A literal GD look (bright, saturated, full-screen color) would break the identity; the current look undersells the game. The four GD techniques were decomposed and discussed individually; parallax depth was chosen as the single highest-impact element, with the generated reference image confirming the full target mood.

---

## Requirements

**Zone theme system**

- R1. One shared theming system serves all three modes (sandbox, campaign, tutorial). A room or arena selects a zone theme; the theme defines its floor wash palette, margin decor set, wall style, and accent colors.
- R2. The theme API accepts an intensity parameter (0..1) from the first version. In v1 it is statically set per room and the rendered result at the default value matches the approved look; the parameter exists so a later iteration can drive it from gameplay (multiplier, enemy aggro, boss phases) without reshaping the system.
- R3. The infected sector zone ships first and matches the reference image's mood: red-to-purple identity. Other zones (clean corridors, boss arena, sandbox, tutorial) each get their own color identity, chosen during planning/art pass.

**Arena floor**

- R4. The arena floor gets a per-zone gradient color wash instead of flat darkness. It must read dimmer than the reference image, and the zone hue must stay distinguishable from bullet/threat colors (see R10).

**Parallax decor (highest-priority element)**

- R5. Wireframe decor layers — hex clusters, circuit fragments, data blocks, eyes, and other lore-vocabulary silhouettes — fill the space beyond the arena, in multiple depth layers moving with parallax relative to the camera.
- R6. In sandbox (and any future arena that fills the whole viewport with no margins), the decor renders as a dim under-floor layer beneath the grid instead, so the depth effect exists in every mode, not only letterboxed rooms.
- R7. Decor is self-luminous: in dark campaign rooms it stays visible through the darkness overlay, like distant city lights — darkness and juice coexist rather than one replacing the other.

**Walls, props, and silhouettes**

- R8. Walls upgrade from bare fill+stroke to: dark body, bright neon edge trim, and small details (panel lines, corner markers, hazard accents) per the zone's wall style.
- R9. Rooms gain emissive decorative props inside the arena (rosettes, trimmed pylons, small glowing details) as part of room dressing.
- R10. Arena perimeters become irregular (notched / stepped octagonal silhouettes in the spirit of the reference) composed from the existing rectangular wall blocks. Collision and physics behavior do not change — this is a room-layout change, not an engine change.

**Readability and performance**

- R11. Threat readability beats juice on every conflict: bullets, enemies, and the player must remain the brightest and most saturated layer on screen. Decor brightness/alpha is capped accordingly, and zone hues are tuned away from threat colors.
- R12. 60 fps holds. All new visuals follow the project's performance architecture (baked sprites, no per-frame shadowBlur on recurring elements, pooled objects); the F2 perf overlay is the acceptance gate.

---

## Acceptance Examples

- AE1. **Covers R2.** Given a room whose theme intensity is set to the default static value, when the game renders, the picture matches the approved zone look; changing the intensity value in code visibly scales the theme's energy (floor wash brightness, decor activity) without any other changes.
- AE2. **Covers R7.** Given a dark campaign room (visibility radius active), when the player stands anywhere, wireframe decor beyond the arena is still visible as glowing silhouettes through the darkness, while non-luminous elements remain hidden.
- AE3. **Covers R6.** Given sandbox (arena fills the viewport), when a run starts, parallax decor is visible as a dim layer under the playfield grid rather than absent.
- AE4. **Covers R4, R11.** Given the red-purple infected zone, when red bullets cross the floor wash, the bullets remain clearly distinguishable from the background at a glance (hue/brightness separation), verified by playtest.
- AE5. **Covers R10.** Given a room with a notched perimeter, when the player dashes into a notch corner, collision behaves exactly as with current rectangular walls (smash effect, sliding, no clipping).

---

## Success Criteria

- A before/after comparison of the infected hub reads as a different game: the mood of `visual-overhaul-reference.jpg` is recognizable, and "набор голых стен" no longer describes any room.
- The same system styles sandbox and tutorial without per-room hand work — a new room becomes juicy by picking a theme, not by authoring art.
- Threat readability survives playtesting: no moment where a bullet is lost against the floor wash or decor.
- F2 perf overlay stays green in the heaviest scene (boss fight, max bullets) on the same hardware that holds 60 fps today.
- Handoff quality: ce-plan can design the system from this doc plus the reference image without inventing product behavior — open items are explicitly listed below.

---

## Scope Boundaries

- No music synchronization or any audio-driven visuals (music is disabled engine-wide); "pulse" is gameplay-driven via the intensity parameter, and wiring intensity to live gameplay signals is itself a later iteration, not v1.
- No landing-page or DOM-overlay redesign — the menu already has its own animated background.
- No non-AABB collision geometry; irregular silhouettes are composed from rectangular blocks.
- No per-room hand-authored art direction (the rejected Approach B) — uniqueness comes from theme + layout.
- No gameplay, enemy, scoring, or balance changes.
- No copying of Geometry Dash assets or literal motifs (saws, spikes); decor vocabulary comes from VECTRIX lore (hexes, circuits, eyes, data blocks).

---

## Key Decisions

- **Theme system over hand-authored rooms**: the game will keep growing rooms; a system makes every future room juicy for free and keeps all modes consistent.
- **Reactivity as a built-in hook, not a v1 feature**: the intensity parameter ships in the API on day one but stays static, so the "living system" upgrade (zone reacting to the Witness — multiplier, aggro, boss phases) lands later without rework. This was chosen over shipping full reactivity now (tuning cost) and over omitting the hook (rework cost).
- **Glowing decor through darkness** over lightening the campaign: darkness is identity (lore: dark cyberpunk minimalism); juice comes from self-luminous elements coexisting with it.
- **Decor placement is mode-aware** (margins in letterboxed rooms, under-floor in full-viewport sandbox): inferred from "all modes at once" + parallax-first priority; flagged here because it was not explicitly discussed.
- **Reference image is the bar, not the spec**: its readability problem (red bullets on red floor) is explicitly corrected by R4/R11 rather than copied.

---

## Dependencies / Assumptions

- The existing deep-field arena background, margin energy/text layers, and wall rendering are the natural integration points; whether they are extended or partially replaced is a planning decision.
- Performance headroom exists for baked-sprite decor layers (verified pattern: the project already bakes walls, enemies, lasers, and light into sprites); the assumption that parallax layers fit the frame budget is unverified until profiled with F2.
- The campaign darkness overlay implementation permits selected layers to render through it (or above it); if not, the planning pass must design that exception.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][User decision at art pass] Exact color identities for non-infected zones (corridor, boss, sandbox, tutorial) — propose palettes during planning, confirm with generated mockups if useful.
- [Affects R5][Technical] Decor vocabulary catalog per zone: how many distinct silhouette types per set before it stops reading as "wallpaper".
- [Affects R6][Technical] How the under-floor decor layer in sandbox stays subordinate to gameplay (alpha budget, density) given there is no letterbox separation.
- [Affects R10][Technical] Which rooms get irregular silhouettes first, and how door/gate placement interacts with notched perimeters.
- [Affects R12][Needs research] Per-frame cost profile of multi-layer parallax at boss-fight load; pick layer counts and sprite-bake strategy from measurement, not guesses.
