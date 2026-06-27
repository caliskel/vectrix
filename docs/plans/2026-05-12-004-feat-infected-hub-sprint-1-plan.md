---
date: 2026-05-12
type: feat
status: active
topic: infected-hub-sprint-1
origin: docs/brainstorms/infected-sector-rooms-requirements.md
---

# feat: Infected Hub — Sprint 1 (Hub + Placeholder Side-Rooms)

## Summary

Sprint 1 ships **архитектурный скелет** infected sector: настоящий hub (Room 2-style большая красная арена с 2-3 Watcher-ами, ambient bullets, internal LOS-cover) с тремя выходами (top + bottom — в side-rooms, east — main door на 2 ключа), плюс две placeholder side-rooms где игрок просто заходит, забирает ключ из угла и возвращается. Доказывает end-to-end что 3-exit hub + 2-key gating + back-door cycle архитектура работает. Sprint 2 (Pulsing Heart) и Sprint 3 (Sleeping Chamber) переписывают side-rooms поверх этого scaffold-а в отдельных планах.

---

## Problem Frame

Watcher 2.0 уже ship-нут на main (`20701b5`). Лучший proof-of-concept для механики — это Tutorial Room 2 (одиночный watcher в коридоре). Tutorial-room и Room 1 (infected corridor без врагов) — единственные совместимые с новым Watcher arena-ы в проекте; остальные test rooms (`room2`-`room5` files) — placeholder-ы для будущей переработки. Кампания сейчас линейная: `room1 → room3 → room2 → room4 → room5`. Игрок не получает **выбора** маршрута, не сталкивается с stealth-vs-loud trade-offs, не видит hub-style multi-exit pattern.

Origin doc определяет 3-комнатный infected sector — hub + Pulsing Heart + Sleeping Chamber — как продолжение Room 1's visual языка. Полный sector планируется в 3 sprint-а. Sprint 1 — это **минимальная архитектура которую можно playtest-ить end-to-end**: hub с реальными механиками + side-rooms-болванки, доказывающие что 3-exit + 2-key + back-cycle работают. Sprint 2/3 потом подменят placeholder side-rooms на полнофункциональные.

---

## Scope and Approach

В этой итерации трогаем три семьи кода:

1. **API extensions** — `Door` получает optional `keysRequired` для 2-key gating; `Room` получает optional `extraExits` для multi-exit rooms; `Watcher` constructor получает optional `startsAggressive`. Все три — non-breaking additions, default-ы воспроизводят текущее поведение.
2. **State extension в `src/rooms/rooms-game.ts`** — `keyHeld: boolean` → `keysHeld: number`, новое поле `state.noisySector: boolean`. Hub rebuild-ится на entry с актуальным noisy flag.
3. **Новые room builders** — `src/rooms/infected-hub.ts` + `src/rooms/infected-hub-top.ts` + `src/rooms/infected-hub-bottom.ts`. Replaces test-chain insertion point: `room1.nextRoomId = "infected-hub"`, hub east → `room3`.

`src/tutorial/tutorial-game.ts` НЕ трогаем — у tutorial single-key doors и его собственный keyHeld flow продолжает работать без изменений.

Тестовая стратегия — playtest scenarios через `pnpm dev` (codebase без test infrastructure; `tsc --noEmit` — type-check gate, как в Watcher 2.0).

---

## Requirements Traceability

| Origin ID | Coverage |
|---|---|
| R1 (hub red arena, Room 1 style) | U4 |
| R2 (3 doors: top/bottom/east) | U2 (multi-exit support) + U4 (hub uses) |
| R3 (east door requires 2 keys) | U1 (2-key API) + U4 (hub config) |
| R4 (2-3 hub watchers in idle drift) | U4 |
| R5 (ambient bouncing bullet field) | U4 |
| R6 (internal LOS-cover geometry) | U4 (3 pillars Room 1 style) |
| R7 (2 visible key-slot indicators on door) | U1 (drawDoor extension) |
| R20 (noisySector flag exists) | U3 |
| R21 (noisy hub bump — aggressive watchers + denser bullets) | U3 (state) + U4 (hub consumes noisy param) |
| R22 (clean stealth → unchanged hub) | U3 (no-op when noisy=false) |
| R23 (Sprint 1 hub + placeholder side-rooms) | U4 + U5 + U6 |
| F1 (sector entry / hub navigation) | U2 + U4 + U6 |
| F5 (sector exit via east door) | U1 + U6 |
| AE1, AE2 (2-key door open/closed) | U1 |
| AE11 (Sprint 1 end-to-end placeholder traverse) | U6 (integration) |
| R8-R19 (Pulsing Heart, Sleeping Chamber mechanics) | **Out of scope** — Sprint 2/3 plans |
| AE3-AE10 (registration math, sleep wake) | **Out of scope** — Sprint 2/3 plans |
| F2, F3, F4 (Heart / Sleep flows) | **Out of scope** — Sprint 2/3 plans |

---

## High-Level Technical Design

Концептуально Sprint 1 — это вставка hub-а между Room 1 и legacy chain, с тремя строительными блоками: extended Door API (2-key), extended Room API (3 exits), state-driven hub variant (noisy flag).

```
Campaign chain (Sprint 1 end state):
  room1 (corridor)
    │
    ▼ (single-key door, unchanged)
  infected-hub  ◀────────────┐
    ├── top exit ────▶ infected-hub-top (placeholder)
    │                    │ initialKey
    │                    └─ backDoor ──┘
    ├── bottom exit ─▶ infected-hub-bottom (placeholder)
    │                    │ initialKey
    │                    └─ backDoor ──┘
    │
    ▼ (east door, requiresKey + keysRequired=2)
  room3 (legacy test, narrow trap)
    │
    ▼ ...existing chain unchanged...
  room5

Hub state at entry time:
  state.noisySector ──▶ buildInfectedHub({ noisy }) ──▶ Watchers startsAggressive
                                                       ambient bullets denser
                                                       (Sprint 3 sets the flag;
                                                        Sprint 1 always false)
```

*Directional guidance, not implementation specification.* Implementer may adjust file naming, exact Door / Room API field shapes, and pillar placements during execution.

---

## Output Structure

```
docs/plans/2026-05-12-004-feat-infected-hub-sprint-1-plan.md   (this plan)
src/lib/door.ts                                                (modify — add keysRequired)
src/lib/room.ts                                                (modify — add extraExits)
src/lib/enemies/watcher.ts                                     (modify — add startsAggressive opts)
src/rooms/rooms-game.ts                                        (modify — keysHeld, noisySector, multi-exit, rebuild-on-entry)
src/rooms/infected-hub.ts                                      (new — hub builder)
src/rooms/infected-hub-top.ts                                  (new — placeholder top side-room)
src/rooms/infected-hub-bottom.ts                               (new — placeholder bottom side-room)
src/lib/keys.ts                                                (modify — extend drawKeyHudIcon for n-of-m)
```

The implementer may rename/restructure if execution surfaces a cleaner layout.

---

## Implementation Units

### U1. 2-key Door API + keysHeld state

**Goal:** Поддержать doors требующие N ключей. Default N=1 для существующего поведения. Сменить `keyHeld: boolean` → `keysHeld: number` в rooms-game state. drawDoor для 2-key показывает два lock slot-а.

**Requirements:** R3, R7, AE1, AE2.

**Dependencies:** none.

**Files:**
- `src/lib/door.ts` (modify — add `keysRequired?: number` to `Door` type; update `makeDoor` signature; update `drawDoor` to render n-key visual indicator)
- `src/lib/keys.ts` (modify — extend `drawKeyHudIcon` to accept `held: number, required: number` для n/m display)
- `src/rooms/rooms-game.ts` (modify — `keyHeld: boolean` → `keysHeld: number`; door-open check uses `door.keysRequired ?? 1`; reset to 0 in restartRun + transitionToRoom)

**Approach:**
- В `Door` добавить optional `keysRequired?: number`. Когда `requiresKey === true` and `keysRequired` undefined — fallback to 1 (existing single-key behaviour).
- `makeDoor` signature gets one new optional trailing arg `keysRequired = 1` so existing call sites продолжают работать без правок.
- `drawDoor` логика: при `door.requiresKey && door.keysRequired === 2` — рендерит **два** lock icon side-by-side вместо одного, с visual gap. Текущий single-lock path для default (`keysRequired === 1 ?? undefined`) не меняется.
- `keyHeld: boolean` → `keysHeld: number`. Все 12 текущих references в rooms-game.ts обновляются:
  - `keyHeld = false` → `keysHeld = 0`
  - `keyHeld = true` (single-key pickup site at `checkKeyPickup`) → `keysHeld += 1`
  - Door-open check `keyHeld && requiresKey` → `keysHeld >= (door.keysRequired ?? 1)`
- HUD `drawKeyHudIcon` принимает `held: number, required: number`. Rendering: row of `required` slots, first `held` filled gold, rest dim silhouette. Layout: same horizontal spacing as existing; total width grows linearly with `required`.

**Patterns to follow:**
- Existing `Door.flipped?: boolean` optional pattern — same shape для `keysRequired?: number`.
- Existing `drawDoor` lock visual — extends linearly: instead of single lock at door center, two locks at slightly offset positions.

**Technical design:**
```
// Door type (directional sketch):
type Door = { ..existing fields.., keysRequired?: number };

// rooms-game door-open semantics:
const required = door.keysRequired ?? 1;
const canOpen = !door.requiresKey || keysHeld >= required;

// HUD:
drawKeyHudIcon(ctx, x, y, keysHeld, requiredForCurrentRoom);
//   keysHeld = 0, required = 2  →  □ □   (two dim silhouettes)
//   keysHeld = 1, required = 2  →  ■ □   (one filled, one dim)
//   keysHeld = 2, required = 2  →  ■ ■   (both filled gold)
```
*Directional — exact pixel layout tuned in playtest.*

**Test scenarios (playtest in tutorial.html Room 1 first для regression, then новых rooms once they ship):**
- Backward compat. **Covers AE1 partially.** Tutorial Room 1 single-key door. Walk to door without key — door stays closed (existing behaviour). Walk to key, pick up, walk to door — door opens (existing behaviour).
- 2-key door closed with 0 keys. **Covers AE1.** [Will run в Sprint 1 demo: walk hub east door без обоих ключей] — door stays closed, visual shows two dim lock slots.
- 2-key door closed with 1 key. **Covers AE1.** Pick up one side-room key, walk to east door — door stays closed, HUD shows 1/2, door visual shows one filled + one dim slot.
- 2-key door opens with 2 keys. **Covers AE2.** Pick up both keys, walk to east door — door transitions to `open`, HUD shows 2/2, both door slots filled.
- HUD layout — drawKeyHudIcon renders correctly for 1/1, 0/2, 1/2, 2/2 configurations (visual readability check).
- Type-check passes: `pnpm build` after refactor — no warnings от TypeScript.

**Verification:** `pnpm build` проходит. Все playtest scenarios выше fire correctly. Existing single-key doors во всех старых rooms продолжают открываться как раньше.

---

### U2. Multi-exit Room support

**Goal:** Поддержать rooms с тремя или более forward exits. Добавить optional `Room.extraExits` поле; rooms-game transition logic проверяет все exits и переходит в соответствующий roomId.

**Requirements:** R2, F1.

**Dependencies:** none.

**Files:**
- `src/lib/room.ts` (modify — add `extraExits?: Array<{ door: Door; nextRoomId: string }>` to `Room` type)
- `src/rooms/rooms-game.ts` (modify — door-overlap check loop extended; render of extra-exit doors)

**Approach:**
- Расширить `Room` type новым optional полем `extraExits` — массив объектов `{ door, nextRoomId }`. Default `undefined`, существующие rooms не затрагиваются.
- В rooms-game's frame tick (door overlap check, look for `playerOverlapsDoor` calls) — после main `door` и `backDoor` проверять каждый exit в `extraExits`. Если overlap + door open + cooldown clear — transition с `viaBack = false` (forward direction) к `nextRoomId`.
- В render path где `drawDoor(ctx, currentRoom.door)` — также `for (const exit of currentRoom.extraExits ?? []) drawDoor(ctx, exit.door)`. Order: после `door`/`backDoor` чтобы extra exits рисовались как additional decorations.
- Door open logic для extra exits — те же rules что и для main door (`requiresKey` + `keysRequired` if applicable). Placeholder side-room doors будут `requiresKey: false` (всегда open).

**Patterns to follow:**
- Existing `door` and `backDoor` handling in `rooms-game.ts` — extras mirror those code paths (overlap check, transition, draw).
- `playerOverlapsDoor` helper already exists in `src/lib/door.ts` — reuse, don't rewrite.

**Test scenarios:**
- 3-exit hub navigation (will exercise в Sprint 1 demo): walk to top door — transition to top side-room. Walk to bottom door — transition to bottom side-room. Walk to east door — depends on keys (covered in U1).
- Door cooldown — door enter cooldown (`state.doorEnterCooldown`) применяется ко всем exits, не только main. Walking into top door right after transition doesn't re-fire.
- Backward compat — existing rooms (`room1` через `room5`) с `extraExits === undefined` работают без изменений.
- Render — все 3 hub doors visually painted (cannot test visually здесь, deferred to U4 integration).

**Verification:** `pnpm build` проходит. Hub navigation в Sprint 1 demo работает (top/bottom/east exits independently triggerable).

---

### U3. noisySector state + Watcher startsAggressive

**Goal:** Plumb the `noisySector: boolean` flag в rooms-game state, готовый к Sprint 3 wake-event-у. Extend Watcher constructor чтобы принимал `startsAggressive` opt (используется hub-ом в noisy mode).

**Requirements:** R20, R21 (partial — флаг плюс watcher path), R22.

**Dependencies:** none.

**Files:**
- `src/rooms/rooms-game.ts` (modify — add `state.noisySector` field; reset on `restartRun`; preserve across `transitionToRoom`)
- `src/lib/enemies/watcher.ts` (modify — add `opts?: { startsAggressive?: boolean }` to constructor; when true skip alerting telegraph, start в aggro)

**Approach:**
- В rooms-game `state` структуре (где живут `hp`, `dashId` и т.д.) — добавить `noisySector: boolean = false`. Sprint 1 nobody sets it; it stays `false` always. Sprint 3 wake-event handler будет ставить `state.noisySector = true` при разбуженном sleeping watcher.
- `restartRun` ресетит к `false`. `transitionToRoom` preserves (т.е. не сбрасывает) — флаг живёт пока player не restart-нёт run.
- В Watcher constructor: добавить optional `opts?: { startsAggressive?: boolean }` arg. Если `opts.startsAggressive === true`:
  - `awarenessState = "aggro"` (skip idle и alerting)
  - `firstAgroFired = true` (consistent с post-agro state)
  - Skip alert burst FX (would fire on idle → alerting transition; we never go through that state)
- Default (no opts) — current behaviour: starts в idle, обычный awareness ramp.

**Patterns to follow:**
- Hunter уже принимает `{ startsAggressive?: boolean }` per ARCHITECTURE.md (используется в Room 2/3 narrow trap). Same shape.
- `initAwareness` setup — текущий код устанавливает `awarenessState = "idle"`. Когда startsAggressive — override после init.

**Technical design:**
```
// Watcher constructor (directional):
constructor(x: number, y: number, opts?: { startsAggressive?: boolean }) {
  // ... existing init ...
  initAwareness(this, ENEMY_WATCHER_DETECTION);
  this.canDeaggro = false;
  if (opts?.startsAggressive) {
    this.awarenessState = "aggro";
    this.firstAgroFired = true;
    // No alert burst — we never transitioned through alerting
  }
}
```
*Directional — implementation may use a dedicated post-init helper.*

**Test scenarios:**
- Default Watcher behavior unchanged: tutorial Room 2 Watcher continues to start in idle drift, enter aggro through detection radius. (Regression check.)
- startsAggressive option: программно создать Watcher с `{ startsAggressive: true }` в любом контексте (deferred to U4 hub demo — Watcher там используется). На entry — Watcher сразу chasing/firing, не делает alert burst, не показывает alerting jitter.
- noisySector flag persistence: F1 dev menu (если applicable) или manual debug toggle (skip — Sprint 3 will validate via real wake event). Sprint 1 verifies plumbing through type-check + structural test that flag survives `transitionToRoom` round-trip.
- restartRun resets: programmatic — call `restartRun()` and verify `state.noisySector === false` afterward.

**Verification:** `pnpm build` проходит. tutorial.html Room 2 Watcher behaviour unchanged. noisySector field exists и survives transitions (verified at integration time в U6).

---

### U4. buildInfectedHub builder

**Goal:** Реализовать hub room — большая красная арена с 3 exits, ambient bullets, internal pillars, 2-3 Watcher-а в idle drift. Принимает `noisy` arg который активирует aggressive watchers + denser ambient.

**Requirements:** R1, R2, R4, R5, R6, R7, R21 (hub-side mechanics), R22.

**Dependencies:** U1 (2-key door API), U2 (multi-exit Room support), U3 (Watcher startsAggressive opts).

**Files:**
- `src/rooms/infected-hub.ts` (new — `buildInfectedHub(opts: { noisy: boolean }): Room` factory)

**Approach:**
- Dimensions: **1600×1200** (tunable в playtest). `width/height` set; `useCamera = true` (room larger than canonical 1200×800 letterbox).
- Wall structure:
  - Perimeter walls — 30 px thick, `infected: true` (red palette), continuing Room 1's visual language.
  - Top wall: gap для top door (door centered horizontally, ~120×30).
  - Bottom wall: gap для bottom door (mirror).
  - Right wall: gap для east main door (~30×120, vertical slot).
  - Left wall: solid (нет back-door — hub является root sector, refer to Room 1 как `prevRoomId` if back-door needed; deferred decision).
  - Interior pillars: 3 шт Room 1-style (60×120, `infected: true`) — позиции tuned в playtest, начальные positions ~ (500, 400), (1100, 700), (700, 950).
- Doors:
  - `door` (east main): `makeDoor(EAST_X, MID_Y, 30, 120, "closed", true, false, 2)` — `requiresKey: true, keysRequired: 2`, flipped to face right.
  - Top door + bottom door: each `{ door: makeDoor(...), nextRoomId: "infected-hub-top" | "infected-hub-bottom" }`, packed в `extraExits`.
- `nextRoomId`: `"room3"` (east main door destination; preserves legacy chain).
- `spawnX, spawnY`: ~150, 600 (west side, vertical center — player enters from `room1` через east door of room1, lands on west of hub).
- Enemies: 2 Watcher-а в idle drift (positions ~ (700, 400) and (900, 800), tuned playtest). Constructor flag determined by `opts.noisy`:
  - `opts.noisy === false`: `new Watcher(x, y)` — default, idle figure-8 drift on entry.
  - `opts.noisy === true`: `new Watcher(x, y, { startsAggressive: true })` — start chasing immediately, denser threat.
- `ambientBullets`:
  - Normal: `{ spawnArea: full interior rect, maxBullets: 25, spawnIntervalMs: 1200, speed: 250 }` (matches Room 1 infected zone).
  - Noisy: `spawnIntervalMs: 840` (30% denser per R21), other fields same.
- `worldLabels`: optional — could add subtle "WAYSTATION" / "INFECTED SECTOR α" label на полу. Defer to playtest visual.
- `initialKey`: undefined (hub has no key on floor — keys come from side-rooms).

**Patterns to follow:**
- `src/rooms/room1.ts` — visual language (infected walls + ambient bullets + perimeter structure). Reuse `mergeLeft/mergeRight` for any seam blending.
- Existing `buildRoomN()` factory shape — return Room object literal с walls array, enemies array, door, etc.

**Technical design:**
```
// Hub builder (directional sketch):
buildInfectedHub({ noisy }: { noisy: boolean }): Room {
  const walls = [/* perimeter + 3 pillars, all infected: true */];
  const eastDoor = makeDoor(/* east position */, /*requiresKey*/true, /*keysRequired*/2);
  const topDoor = makeDoor(/* north position */, /*requiresKey*/false);
  const bottomDoor = makeDoor(/* south position */, /*requiresKey*/false);
  const watchers = noisy
    ? [new Watcher(...pos1, {startsAggressive: true}), new Watcher(...pos2, {startsAggressive: true})]
    : [new Watcher(...pos1), new Watcher(...pos2)];
  return {
    id: "infected-hub",
    walls, enemies: watchers,
    door: eastDoor, nextRoomId: "room3",
    extraExits: [
      { door: topDoor, nextRoomId: "infected-hub-top" },
      { door: bottomDoor, nextRoomId: "infected-hub-bottom" },
    ],
    spawnX: 150, spawnY: 600,
    width: 1600, height: 1200, useCamera: true,
    ambientBullets: noisy
      ? { /* denser config */ }
      : { /* normal config */ },
  };
}
```
*Directional — pillar positions, exact door coordinates, ambient bullet area rect tuned в playtest.*

**Test scenarios:**
- Hub visual continuity. Open hub в session — стены красные, ambient bullets bouncing, INFECTED visual continues Room 1's tone.
- Idle Watchers (noisy=false default). Watchers drift in figure-8, idle pupil look. They don't agro until player crosses detection radius.
- Aggressive Watchers (noisy=true). Programmatically build hub с `{noisy:true}` — Watchers start in aggro state (chase immediately, no alert burst). Verified когда noisy plumbing достигнет Sprint 3, или manual debug-set в Sprint 1.
- 3 exits visible. **Covers F1.** Top wall has gap with door, bottom wall has gap with door, east wall has gap with main door. Each door visually distinct (east shows 2 lock slots from U1; top/bottom show open arrow).
- Pillar cover. Player stands behind pillar — at least one Watcher cannot see player (LOS broken). Confirms LOS-cover geometry для Watcher 2.0 gaze mechanic.
- Ambient bullet field. Bullets spawn continuously, bounce off perimeter + pillars. Max maintained ~25-30 (per existing infected-zone tuning).

**Verification:** `pnpm build` проходит. Hub renders correctly в session. Watchers behave per noisy flag.

---

### U5. Placeholder side-rooms

**Goal:** Два простых side-rooms: top и bottom. Каждый принимает игрока, displays `initialKey` на полу в углу, имеет back-door обратно в hub. Никаких врагов, никаких ambient bullets, никаких механик. Минимум — доказательство архитектуры.

**Requirements:** R23.

**Dependencies:** none (могут быть built параллельно U4).

**Files:**
- `src/rooms/infected-hub-top.ts` (new — `buildInfectedHubTop(): Room` factory)
- `src/rooms/infected-hub-bottom.ts` (new — `buildInfectedHubBottom(): Room` factory)

**Approach:**
- Каждая комната: 1200×800 (canonical letterbox size, no camera needed).
- Walls: perimeter only, `infected: true` для visual continuity с hub.
- Doors:
  - `door`: undefined OR null (нет forward exit — placeholder ends here).
  - `backDoor`: на стене facing hub. Для top room — на south wall (player came from north of hub, returns south). Для bottom room — на north wall (player came from south of hub, returns north). `requiresKey: false, flipped: true` (faces back to hub).
- `prevRoomId`: `"infected-hub"`.
- `nextRoomId`: null (placeholder, нет forward).
- `initialKey`: lying on the floor at the far corner. Top room: at top-right; bottom room: at bottom-right. Sprint 2/3 заменят это на mechanic-driven key drops.
- `enemies`: empty array.
- `spawnX, spawnY`: just inside the back-door (~150 px in from the entry wall).
- `ambientBullets`: undefined (calm placeholder).
- `worldLabels`: optional — could add a subtle "TOP — DEFERRED CONTENT" debug label, or leave clean.

**Patterns to follow:**
- `src/rooms/room1.ts` уже имеет infected walls + `initialKey` + door pattern. Most direct template.
- backDoor + prevRoomId pattern — check existing usage (we know it's defined в `Room` type; need to verify which rooms actually use it).

**Test scenarios:**
- Top side-room entry. **Covers AE11 partially.** Enter through hub's top door. Land just inside back-door of top room. See key on floor at corner.
- Bottom side-room entry. Same pattern для bottom room.
- Key pickup. Walk over key → `keysHeld` increments by 1. Visual confirmation: HUD shows 1/2 (after picking up first), 2/2 (after both).
- Back-door return. Walk into backDoor → transition back to hub. Lands inside hub at the corresponding door's position (existing backDoor logic should drop player just inside).
- No enemies — placeholder room visually clean, no Watcher / Turret / Hunter, no ambient bullets, no lasers.

**Verification:** `pnpm build` проходит. Top + bottom rooms enterable and exitable; keys pickable; hub key counter increments.

---

### U6. Campaign chain integration + rebuild-hub-on-entry

**Goal:** Wire новые комнаты в campaign chain. Replace test-chain entry point. Each transition to `infected-hub` rebuilds hub с current `state.noisySector`.

**Requirements:** R23, F1, F5, AE11.

**Dependencies:** U1, U2, U3, U4, U5.

**Files:**
- `src/rooms/rooms-game.ts` (modify — register new rooms; rebuild-on-entry hook for hub)
- `src/rooms/room1.ts` (modify — `nextRoomId` from `"room3"` to `"infected-hub"`)

**Approach:**
- В `rooms-game.ts` где rooms registered (`rooms.set("room1", buildRoom1())` etc.):
  - Add: `rooms.set("infected-hub", buildInfectedHub({ noisy: false }))` — initial build, calm variant.
  - Add: `rooms.set("infected-hub-top", buildInfectedHubTop())`.
  - Add: `rooms.set("infected-hub-bottom", buildInfectedHubBottom())`.
  - Same additions нужны в **обоих** registration sites (lines 551-555 initial, lines 774-778 restartRun reset). Both call sites должны включать новые rooms.
- `src/rooms/room1.ts`: `nextRoomId: "room3"` → `nextRoomId: "infected-hub"`. Player after Room 1 теперь идёт в hub.
- `transitionToRoom` hook для rebuild:
  - В `transitionToRoom(id, viaBack)` — после `const next = rooms.get(id)`, перед `currentRoom = next`, добавить:
    - `if (id === "infected-hub") { const fresh = buildInfectedHub({ noisy: state.noisySector }); rooms.set(id, fresh); currentRoom = fresh; }`
    - Иначе — existing path (`currentRoom = next`).
  - Sprint 1 always `noisy === false`, но plumbing works для Sprint 3.
- Hub east door → leads to `room3` (legacy chain continues). Existing `room3` (narrow trap, Hunter + 2 turrets, no Watcher) — должен работать с Watcher 2.0 (no Watcher → no broken).

**Patterns to follow:**
- Existing `rooms.set()` calls — straightforward map registration.
- Existing `transitionToRoom` body — small targeted addition, не reorganize.

**Test scenarios:**
- End-to-end Sprint 1 traverse. **Covers AE11.** Start `rooms.html`, complete Room 1 (corridor with key, single-key door) → through east door → land in hub west spawn. See 3 exits (top, bottom, east-locked). Walk to top → enter top side-room → pick up key → return to hub (1/2 indicator). Walk to bottom → enter bottom side-room → pick up key → return to hub (2/2). Walk to east — door opens → transition to room3 (legacy narrow trap).
- restartRun cycle. Pause hub mid-encounter, restart from start screen. Verify: `keysHeld = 0`, `noisySector = false`, all room registrations refreshed, hub re-built с calm variant.
- Hub rebuild on entry. After end-to-end traverse and reaching room3 (legacy), exit back via existing chain or restart. Re-enter hub — fresh build (verify visual reset: ambient bullets initialized, Watchers in idle drift, key counter 0/2).
- room1 → hub flow. Existing room1 has Watcher (drops key). Player kills Watcher in room1, takes key, goes through room1 east door — now arrives in hub (not legacy room3). Hub's east door is locked (2 keys needed).
- room1 key still works. **Regression.** Existing room1 single-key flow not broken: key pickup still works, room1 east door opens с 1 key (its `keysRequired = 1` default).

**Verification:** `pnpm build` проходит. AE11 reproducible end-to-end. Legacy chain past hub still navigable (with whatever test rooms remain).

---

## System-Wide Impact

- **`src/lib/door.ts`**: adds optional field on Door type + extends drawDoor для 2-slot rendering. Existing rooms unaffected (default `keysRequired` undefined ≡ 1).
- **`src/lib/room.ts`**: adds optional `extraExits` field. Existing rooms unaffected.
- **`src/lib/enemies/watcher.ts`**: constructor signature gets optional opts arg. All existing call sites continue to work (no opts = default).
- **`src/lib/keys.ts`**: `drawKeyHudIcon` signature gets `required: number` param. All existing call sites pass `required = 1` implicitly. Plan: extend signature with default value `required = 1` to preserve compat OR migrate all call sites in one pass.
- **`src/rooms/rooms-game.ts`**: state shape changes (`keyHeld: boolean` → `keysHeld: number`, plus new `noisySector: boolean`); 4-5 transition / restart points updated; door-overlap loop extended for `extraExits`; one rebuild-on-entry hook for hub.
- **`src/rooms/room1.ts`**: single-line change (`nextRoomId`).
- **3 new files**: hub + 2 placeholder side-rooms.
- **`src/tutorial/tutorial-game.ts`**: НЕ затрагивается. Tutorial uses single-key doors, single key pickup — works with backward-compat shape.
- **Sandbox + other modes**: not affected.

---

## Risks and Mitigations

- **`keyHeld` → `keysHeld` refactor missed call site.** 12 references в rooms-game.ts. **Mitigation:** `tsc --noEmit` после refactor выловит любые typo / missed access сразу.
- **Hub rebuild-on-entry breaks bidirectional flow.** Игрок возвращается в hub из side-room через backDoor → `viaBack=true` flow + hub rebuild. Could lose in-flight ambient bullets / Watcher state. **Mitigation:** Per existing `transitionToRoom` logic, hub state is anyway reset (currentKey=null, bullets=[], etc.) — rebuild на entry просто refresh-ит Room reference. Watchers reset to initial state (idle drift на calm entry), что приемлемо.
- **Hub layout too punishing с Watcher 2.0.** 2 Watcher-а в 1600×1200 арене даже с 3 pillar-ами могут sustain gaze meter via crossfire. **Mitigation:** Стартовые pillar positions tuned playtest — добавить ещё pillar если encounter unwinnable. Также: hub Watchers spawn в `idle` initially → ~3-4 секунды grace перед aggro даёт игроку положиться где-то.
- **Existing `extraExits` rendering occlusion.** Top/bottom doors могут overlap с pillars или other walls если positions bad. **Mitigation:** Initial pillar positions deliberately отнесены от doors. Playtest verification.
- **`room1.nextRoomId` change breaks Tutorial.** Tutorial uses its own room0-3 chain, не shared with rooms-game's room1. **Mitigation:** Verified — `src/tutorial/` has parallel room0-3, не reference `src/rooms/room1.ts`.
- **Sprint 2/3 plans block on Sprint 1 architecture.** If U2's `extraExits` shape is wrong, Pulsing Heart / Sleeping Chamber side-rooms (which will be inserted via same mechanism) might need rework. **Mitigation:** Sprint 1's placeholder side-rooms exercise the same architecture Sprint 2/3 will use. End-to-end Sprint 1 demo validates the shape before Sprint 2 ships.

---

## Scope Boundaries

- **Pulsing Heart механика** (R8-R13 from origin) — Sprint 2's plan. Placeholder top side-room is just an `initialKey` box in Sprint 1.
- **Sleeping Chamber механика** (R14-R19 from origin) — Sprint 3's plan. Placeholder bottom side-room similar.
- **Tutorial-game keyHeld refactor** — НЕ trogaem. Tutorial uses single-key doors (`requiresKey: true`, no `keysRequired`) and its own `keyHeld: boolean` state. Backward-compat works without changes.
- **Existing test rooms (room2, room3, room4, room5)** — НЕ trogaem. East door of hub leads to `room3` (Hunter + turrets, no Watcher — should be Watcher 2.0 safe). Legacy chain past room3 may or may not work (some have open arenas с broken Watcher 2.0 incompatibility, e.g. file `room2.ts`). **Out of scope** to fix here — Sprint 1's deliverable is hub working, not whole campaign fixed.
- **Background-text shift в noisy hub** — out of Sprint 1. Sprint 3 wires this когда real noisy state триггеры существуют.
- **Sleeping watcher state** — out of Sprint 1. Sprint 3 plan adds it.
- **Multi-key door visual polish** (key counter HUD beautification, animation, transitions) — Sprint 1 ships functional baseline; visual polish through playtest tweaks.
- **Exact tuning numbers** — pillar positions, Watcher orbital positions, ambient bullet density delta для noisy variant, hub dimensions — все **starting values, playtest-tuned**.

### Deferred to Follow-Up Work

- **Pillar layout iteration** — initial 3-pillar placement в playtest, likely 1-2 adjustments before Sprint 2 ships.
- **Audio cue for hub entry** — currently silent on entry. Could later add a low-frequency drone or scramble-text sting (skip for Sprint 1).
- **East-door destination когда side-rooms become Sprint 2/3 mechanics** — после Sprint 3, possibly east door leads to a "Sector Complete" placeholder or actual next sector. Sprint 1 wires to `room3` for chain continuity.
- **Debug toggle for noisy flag в Sprint 1** — could add F2 hotkey to set `state.noisySector = true` and re-enter hub для manual verify. Decided out of scope — Sprint 3's real wake event validates the path; Sprint 1 just plumbs the field.

---

## Key Technical Decisions

- **`Door.keysRequired?: number` over `Door.requiresMultiKeys: boolean`.** Single optional number field is more extensible (could support 3-key doors later без новой типизации) and reads naturally в conditions (`keysHeld >= door.keysRequired ?? 1`). (See origin: Deferred to Planning).
- **`keyHeld: boolean` → `keysHeld: number` refactor over additive `multiKeysHeld`.** Clean single-source-of-truth state field. Backward compat: `keyHeld === true` ≡ `keysHeld > 0`. Tutorial uses similar pattern but its own scope; no shared state.
- **Hub rebuild on entry, not initial-build-once.** Allows dynamic `noisy` variant based on live `state.noisySector`. Trade-off: small per-entry cost (rebuild fresh Walls + Watchers), но Hub is entered handful of times per run, negligible.
- **Sprint 1 east-door → `room3`, not "to be continued" placeholder.** Preserves end-to-end campaign navigability (player can still reach Sentinel boss if room3-5 are still playable). Alternative "sector complete" overlay also valid but adds new room with no gameplay; current choice cheaper.
- **Watcher constructor opts mirror Hunter's pattern.** Hunter already has `{ startsAggressive: true }` per ARCHITECTURE.md — Watcher follows the same shape для consistency.
- **noisySector flag persists across `transitionToRoom`, resets only on `restartRun`.** Per origin doc Key Decisions — once player provokes the system in a run, that consequence sticks.
- **No tutorial-game changes.** Tutorial's parallel codebase stays untouched. Tutorial's single-key flow uses default `keysRequired === undefined` semantics.
- **Hub's spawn point west, east door east.** Match natural reading order. Player enters from west (from room1), exits east main door (after both keys). Top/bottom side-rooms perpendicular trips.

---

## Dependencies / Assumptions

- **Watcher 2.0** уже на main (latest commit `20701b5`). Confirmed via `git log`.
- **Existing API extensions are non-breaking.** All new fields на `Door`, `Room`, Watcher constructor — optional. Default-у воспроизводят current behaviour.
- **`makeDoor` signature extension.** New optional trailing arg `keysRequired = 1`. Existing call sites in room1.ts / room3.ts / etc. continue to compile without changes.
- **No third-party deps.** Pure TypeScript additions; no new packages.
- **`pnpm dev` остаётся primary dev loop.** Verification through manual playtest + `pnpm build` type-check, как Watcher 2.0.

---

## Outstanding Questions (Deferred to Implementation)

- [Affects U1] [Technical] HUD `drawKeyHudIcon` layout when `required = 2` — horizontal padding между slots, total width adjustment, sit alongside existing HP indicator. Tuned visual in playtest.
- [Affects U2] [Technical] Door enter cooldown — applied per-door or per-frame? Existing `state.doorEnterCooldown` is single-value; if player enters top door then immediately top door of next room (unlikely Sprint 1), could double-fire. Likely fine — cooldown is shared per-frame, so single value sufficient.
- [Affects U4] [Technical] Hub Watcher exact positions для Watcher 2.0 LOS-friendly encounter — starts at ~ (700, 400) and (900, 800), but pillars need to provide LOS-break corridor between Watcher and player. Playtest-tuned.
- [Affects U4] [Technical] Hub dimensions 1600×1200 — may be too large (sparse Watchers, long traversal) или too small (cramped с 2 Watchers + 3 pillars). Easy adjustment; default 1600×1200 as starting point.
- [Affects U4, U5] [Technical] backDoor existence in hub — should hub have one going back to Room 1? Origin doc didn't specify. Decision: **no**. Once player passes Room 1 → hub, no retreat (matches existing room1 → room3 flow where там тоже нет backDoor). If playtest shows игрок confused / soft-locked, add later.
- [Affects U6] [Technical] `room1.ts` change — `nextRoomId: "room3"` → `nextRoomId: "infected-hub"`. Single-line; verify через `pnpm build` and playtest.
- [Affects U6] [Technical] Side-room rooms aren't pre-built и updated по noisy flag — they're static placeholder boxes. Sprint 2/3 will replace with dynamic builders. No rebuild hook needed for them в Sprint 1.

---

## Verification at Plan Level

План считается успешно реализованным когда:

1. `pnpm build` (= `tsc --noEmit && vite build`) проходит без warnings / errors.
2. AE11 end-to-end reproducible: room1 → hub → top side-room (key) → hub (1/2) → bottom side-room (key) → hub (2/2) → east door opens → room3.
3. Default Watcher behaviour unchanged in tutorial.html Room 2 (regression).
4. Existing single-key doors (room1, room3, room5) продолжают работать с 1 ключом.
5. `state.noisySector` field survives `transitionToRoom`, resets on `restartRun`. Architecture verified through type-check + structural test; runtime flip deferred to Sprint 3.
6. Visual: hub reads as continuation of Room 1's infected zone (red walls, ambient bullets). 3 exits visible. 2-key main door visually distinct from single-key doors.
7. `F2` perf-meter: no section exceeds 16 ms budget при typical hub encounter (2 Watchers + 25 ambient bullets + 3 pillars).
