---
date: 2026-05-12
type: feat
status: active
topic: watcher-redesign
origin: docs/brainstorms/watcher-redesign-requirements.md
---

# feat: Watcher 2.0 — gaze-driven LOS sniper

## Summary

Глобальный редизайн врага Watcher из binary-firing «куклы» в continuous-threat снайпера. Ядро механики — `gaze stack` per-Watcher, копится пока есть LOS до игрока, на полном — следующий лазер пробивает dash i-frames. Поверх: tracking aim во время charge, отсутствие de-aggro, ускоренный цикл стрельбы, HP 5, постоянная визуальная gaze-линия, lock-on индикатор вокруг игрока, ambient heartbeat audio loop. Изменения глобальные — все Watcher-ы во всех режимах (rooms + tutorial) ведут себя одинаково.

---

## Problem Frame

Текущий Watcher не выполняет роль которую ему даёт лор (см. `VECTRIX_LORE.md`). Aim замораживается на старте `aiming` (1.2 s) — достаточно шага в сторону. Цикл 3.75 s — длинные dead-окна без угрозы. HP 3 — умирает в одном dash-комбо. Между firing-events — никакого continuous presence. Игрок не чувствует что **за ним смотрят**.

Цель — превратить Watcher в врага, рядом с которым игрок **режет маршрут** через геометрию (за стенами, за пиларами), потому что continuous LOS повышает risk через gaze stack. См. origin: `docs/brainstorms/watcher-redesign-requirements.md`.

---

## Scope and Approach

Изменения локализованы на сущности Watcher и тонком ярусе game-side wiring (laser collision, render passes, audio ticker) в обоих game-файлах (`rooms-game.ts` + `tutorial-game.ts`). Никаких новых архетипов врагов, никаких изменений в Hunter/Turret/Sentinel, никаких новых damage-путей (только beam + body contact).

Подход — **single source of truth** в `src/lib/enemies/watcher.ts`: новые поля и поведение живут на классе. Game-files читают per-watcher `gazeAtPlayer` и агрегируют в state.maxGazeAtPlayer. Render-helpers и audio синт — shared в `lib/`.

Тестовая стратегия — playtest scenarios через `pnpm dev` (codebase не имеет unit-test инфры; `tsc --noEmit` — gate на type-correctness, CLAUDE.md фиксирует это как канон).

---

## Requirements Traceability

| Origin ID | Coverage |
|---|---|
| R1 (gazeAtPlayer field + decay) | U3 |
| R2 (markedByGaze derived; reset on hit) | U3, U4 |
| R3 (canDeaggro = false; idle gated) | U1 |
| R4 (detectionRadius unchanged; alerting kept) | U1 |
| R5 (tracking aim 1.5 rad/s) | U1 |
| R6 (cycle 1.0/0.8/0.3/0.5) | U1 |
| R7 (piercesIframes flag + pierce dash iframes only) | U3, U4 |
| R8 (lock-on indicator + audio cue at fire) | U4, U5 |
| R9 (HP 5) | U1 |
| R10 (no new damage paths) | enforced by scope; no implementation needed |
| R11 (gaze line render) | U4 |
| R12 (heartbeat ambient loop) | U5 |
| R13 (lock-on ring around player) | U4 |
| R14 (friendly fire preserved with tracking aim) | U1 (no-op — endpoint already refreshed per frame) |
| R15 (idle behavior pre-first-agro) | U1 |
| F1 (encounter flow) | U1, U3, U4, U5 |
| F2 (LOS break counter-play) | U2, U3, U4 |
| AE1–AE6 | covered by playtest scenarios per unit |

---

## High-Level Technical Design

Концептуально — три слоя:

```
[Watcher per-instance]                       [Game-side state]              [Render / Audio]
  gazeAtPlayer (0..1)        ──aggregates──>  state.maxGazeAtPlayer  ──>    lock-on indicator
  LOS raycast every frame                                            ──>    heartbeat audio gain
  tracking aim during aiming                                         ──>    gaze line per watcher
  on aim→fire: snapshot gaze    captures laser.piercesIframes flag
                                                                            
[Laser]                                                              
  piercesIframes: bool (captured at fire-spawn)                                  
  endpoint refreshed per frame (existing)                                        
  on player-collision: if piercesIframes, skip dash iframe check,                
                       ownerEnemy.gazeAtPlayer ← 0                              
```

*Directional guidance, not implementation specification.* Watcher живёт автономно (knows player, walls, dt), game-side только подцепляет collision-pierce, render и audio. `state.maxGazeAtPlayer` — derived caching layer чтобы render и audio не итерировали по списку enemies каждый кадр.

---

## Implementation Units

### U1. Watcher core behavioral changes

**Goal:** Все per-Watcher изменения которые не требуют новых LOS-утилит — HP, цикл, отсутствие de-aggro, tracking aim, idle figure-8 drift только до первой агры.

**Requirements:** R3, R4, R5, R6, R9, R14, R15.

**Dependencies:** none.

**Files:**
- `src/lib/enemies/watcher.ts` (modify)
- `src/lib/config.ts` (add constants)

**Approach:**
- Добавить в `config.ts` константы: `WATCHER_HP_MAX = 5` (переопределяет существующее inline), `WATCHER_IDLE_SEC = 1.0`, `WATCHER_AIMING_SEC = 0.8`, `WATCHER_FIRING_SEC = 0.3`, `WATCHER_COOLDOWN_SEC = 0.5`, `WATCHER_AIM_TRACKING_RAD_PER_SEC = 1.5`. Заменить локальные `PHASE_*_SEC` в `watcher.ts` на импорты.
- Изменить `WATCHER_HP_MAX` в `watcher.ts` с 3 на 5 (через импорт). Pip-render цикл уже параметризован по `WATCHER_HP_MAX` — визуал HP подстроится.
- `canDeaggro` — установить `false` в конструкторе. Field уже существует.
- Tracking aim: в `update()` для phase == `aiming` каждый кадр вычислять `targetAimAngle = atan2(player.y - this.y, player.x - this.x)` и лерпить активный `aimAngle` (через ссылку на текущий live laser в `ctx.lasers` — найти laser где `l.ownerEnemy === this && l.age < l.chargingDuration`) с ограничением `WATCHER_AIM_TRACKING_RAD_PER_SEC * dt`. Использовать `shortestAngleDiff` для корректной работы вокруг ±π (Sentinel уже использует этот pattern — см. `src/lib/enemies/sentinel.ts`).
- Запись angle live laser-у: alternative — хранить per-Watcher `currentLaserId` после спавна, искать в списке по id. Цена та же. Решение в plan-time: использовать прямую ссылку через `currentAimingLaser?: Laser` поле на Watcher, освобождать на advancePhase firing→cooldown.
- `pupilLockX/Y` (визуал зрачка во время aim/fire) тоже обновлять каждый кадр на tracking aim — иначе зрачок отстанет от линии лазера.
- Idle figure-8 drift gating: добавить `private firstAgroFired = false`. Установить в `true` при первом переходе `idle → alerting`. В блоке `awarenessState === "idle"` ветки идле-drift — `if (!this.firstAgroFired)` обходит figure-8 movement и idle-look pupil. После первой агры в idle (теоретически невозможно при `canDeaggro = false`, но защитимся) — Watcher просто стоит неподвижно с пупилем на последней captured точке.

**Patterns to follow:**
- `Sentinel.sentinel.ts` `clampAngularRotation` / `shortestAngleDiff` для tracking-rate лимита.
- Существующая `advancePhase` стейт-машина — не ломаем структуру, только меняем длительности и поведение per-phase.

**Technical design:**
```
// in Watcher.update, aiming phase, every frame:
const targetAngle = atan2(player.y - this.y, player.x - this.x);
const live = this.currentAimingLaser;
if (live) {
  const diff = shortestAngleDiff(targetAngle, live.aimAngle);
  const maxStep = WATCHER_AIM_TRACKING_RAD_PER_SEC * dt;
  const clamped = clamp(diff, -maxStep, maxStep);
  live.aimAngle += clamped;
}
// rooms-game's refreshLaserEndpoints picks up the new aimAngle next tick.
```
*Directional — implementation may differ in exact field naming.*

**Test scenarios (playtest in `tutorial.html` Room 2, single Watcher):**
- HP check. **Covers AE5 partially.** Dash through Watcher repeatedly without missing — verify 5 successful dash-throughs are required to kill (4-th dash leaves him alive, 5-th destroys).
- No-deaggro. **Covers AE4.** Walk into Watcher detectionRadius, then walk away beyond `detectionRadius * 1.3 = 910 px` (use the corridor's full extent). Stay out for 5 s. Verify Watcher does not return to figure-8 drift — он либо чейзит, либо стоит в aiming/cooldown, но awareness ring остаётся в aggro-цвете.
- Tracking aim — walk break. **Covers AE3 partially.** Стоя на восток, дождаться `aiming` фазы (визуально brake squash + zрачок снапается). Начать идти на север со средней скоростью. Beam-линия aim в течение aim-window поворачивает следом. Шагом не оторваться — попадание на fire.
- Tracking aim — dash break. **Covers AE3.** Та же ситуация, но в aim-window дашить перпендикулярно. Lock breaks — beam уходит в стену.
- Cycle timing. Засечь от idle-end до следующего idle-end — должно быть ~2.6 s (±100 ms измерительной погрешности).
- Idle behavior pre-agro: запустить `tutorial.html` Room 2. Watcher до пересечения detection radius должен делать figure-8 drift и idle pupil look (без изменений).
- Friendly fire preserved (sanity): в `rooms.html` Room 3 (4 turrets + 1 watcher), заманить watcher-beam через turret — verify turret получает damage при fire-tick, как раньше.

**Verification:** `pnpm build` (tsc + vite) проходит. Все playtest-сценарии выше fire correctly.

---

### U2. Shared raycast / LOS utilities

**Goal:** Вынести `raycastWalls` из `rooms-game.ts` + `tutorial-game.ts` в `src/lib/walls.ts` (общая lib), добавить `isSegmentBlocked(ox, oy, tx, ty, walls)` для LOS-проверки между двумя точками.

**Requirements:** Enables R1 (Watcher.update needs LOS check).

**Dependencies:** none.

**Files:**
- `src/lib/walls.ts` (add functions)
- `src/rooms/rooms-game.ts` (replace local `raycastWalls` with import)
- `src/tutorial/tutorial-game.ts` (replace local `raycastWalls` with import)

**Approach:**
- Скопировать существующую implementation `raycastWalls(ox, oy, angle, walls)` из `rooms-game.ts:275-327` в `walls.ts`. Подпись и поведение — 1:1.
- Добавить `isSegmentBlocked(ox, oy, tx, ty, walls): boolean`. Внутри: вычислить angle = `atan2(ty - oy, tx - ox)`, расстояние target = `hypot(tx-ox, ty-oy)`, raycast вдоль angle, сравнить `hit_distance < target_distance` (с epsilon 1 px чтобы исключить self-stuck в стене). Возвращает `true` если стена в пути.
- Удалить local `raycastWalls` в `rooms-game.ts` и `tutorial-game.ts`, добавить импорты. Существующий `refreshLaserEndpoints` продолжает работать.
- Использовать `LASER_RAYCAST_FALLBACK` константу — переместить в `walls.ts` или оставить локально и принять параметром (выбор: переместить, она логически принадлежит raycast-утилите).

**Patterns to follow:**
- `src/lib/walls.ts` уже хостит `resolveEntityWallCollisions` и `Wall` тип — расширяем тот же модуль.

**Test scenarios (regression — no behavior change expected):**
- Type-check: `pnpm build` проходит без errors.
- Visual smoke: запустить rooms.html, проверить что watcher-лазеры в Room 3 (arena) корректно упираются в стены/пилоны как раньше.
- Tutorial smoke: запустить tutorial.html, дойти до Room 2, проверить watcher-лазер.

**Verification:** Существующий visual behavior лазеров не изменился; тип-чек проходит.

---

### U3. Gaze stack + pierce-iframe mechanic

**Goal:** Реализовать ядро механики — per-Watcher `gazeAtPlayer` копится по LOS, на fire-transition snapshot в `Laser.piercesIframes` флаг, на hit-with-pierce damage наносится сквозь dash i-frame и сбрасывает gazeAtPlayer на ownerEnemy.

**Requirements:** R1, R2, R7.

**Dependencies:** U1 (Watcher class shape), U2 (isSegmentBlocked).

**Files:**
- `src/lib/enemies/watcher.ts` (add gaze field, update tick, snapshot in advancePhase)
- `src/lib/enemies/types.ts` (add `piercesIframes?: boolean` to `Laser`)
- `src/rooms/rooms-game.ts` (player-laser collision: pierce path + state.maxGazeAtPlayer aggregation)
- `src/tutorial/tutorial-game.ts` (same wiring as rooms-game)

**Approach:**
- На `Watcher`: добавить `gazeAtPlayer: number = 0` field. В `update()` после awareness tick — если `awarenessState === "aggro"`: `losClear = !isSegmentBlocked(this.x, this.y, player.x, player.y, ctx.walls)`. Если `losClear`: `gazeAtPlayer = min(1, gazeAtPlayer + dt / GAZE_FILL_TIME_SEC)`. Иначе: `gazeAtPlayer = max(0, gazeAtPlayer - dt / GAZE_DECAY_TIME_SEC)`. Если не aggro — `gazeAtPlayer = 0`.
- Константы `GAZE_FILL_TIME_SEC = 2.0`, `GAZE_DECAY_TIME_SEC = 1.0` — добавить в `config.ts`.
- На `advancePhase` `aiming → firing`: захватить snapshot — если `this.gazeAtPlayer >= 1.0`, у уже-existing live laser устанавливать `laser.piercesIframes = true`. Иначе — `false` (явно установить — TS strict не любит unset booleans). НЕ сбрасывать `gazeAtPlayer` здесь — сброс происходит на hit.
- В `src/lib/enemies/types.ts` добавить `piercesIframes?: boolean` в Laser type. Default false при отсутствии флага.
- В **обоих** game files (`rooms-game.ts:2156-2197` player-laser collision блок + аналогичный блок в `tutorial-game.ts`): когда `d2 < halfPlus2` и `l.piercesIframes === true`:
  - skip ветку `player.dashIframeTime > 0 → dodge bonus`
  - skip ветку `state.hitIframe > 0 → ignore` — она остаётся (per R7 deferred decision: pierce обходит **dash** i-frame, **hit** i-frame уважается)
  - на pierce-hit: после `takeHit()` + `triggerShake(...)`, выполнить `l.ownerEnemy.gazeAtPlayer = 0` (нужен type guard — Laser.ownerEnemy типизирован как Enemy, добавить `if (l.ownerEnemy instanceof Watcher)` или проще `if ("gazeAtPlayer" in l.ownerEnemy)`).
- Агрегация `state.maxGazeAtPlayer`: в frame tick обоих games — после enemy update, до render. `state.maxGazeAtPlayer = Math.max(0, ...currentRoom.enemies.filter(e => !e.isDead() && "gazeAtPlayer" in e).map(e => (e as Watcher).gazeAtPlayer))`. Хранится в state как scratch field — используется в U4 + U5.
- `state.markedByGaze` derived = `state.maxGazeAtPlayer >= 1.0`. Можно inline в render, можно cached field.

**Patterns to follow:**
- Pierce flag в Laser — параллель к `dodgedByDashId` (per-laser dedup field), та же конструкция.
- gazeAtPlayer на Watcher — параллель `hitByLaserId` (per-instance scratch state), общий шаблон в этом codebase.

**Technical design:**
```
// Watcher.update, aggro state, every frame:
const losClear = !isSegmentBlocked(this.x, this.y, player.x, player.y, ctx.walls);
if (losClear) this.gazeAtPlayer = min(1, this.gazeAtPlayer + dt / GAZE_FILL_TIME_SEC);
else          this.gazeAtPlayer = max(0, this.gazeAtPlayer - dt / GAZE_DECAY_TIME_SEC);

// Watcher.advancePhase, aiming → firing:
const live = this.currentAimingLaser;
if (live) live.piercesIframes = this.gazeAtPlayer >= 1.0;

// rooms-game / tutorial-game player-laser collision:
if (d2 >= halfPlus2) continue;
if (state.hitIframe > 0) continue;        // hit iframe always respected
if (l.piercesIframes) {
  triggerShake(...); takeHit();
  if ("gazeAtPlayer" in l.ownerEnemy) (l.ownerEnemy as Watcher).gazeAtPlayer = 0;
  break;
}
if (player.dashIframeTime > 0) {
  // existing dodge bonus path
  ...
} else {
  triggerShake(...); takeHit(); break;
}
```
*Directional.*

**Test scenarios (playtest in `tutorial.html` Room 2; also smoke in `rooms.html` Room 3):**
- Gaze fill timing. **Covers AE1, AE2 partially.** Войти в Room 2, дать Watcher-у aggro. Стоять в чистом LOS 2.0 секунды (без укрытий). Подготовка: положить на DOM debug-overlay или хотя бы visual подтверждение через gaze line из U4 (если U4 ещё не сделан — добавить temp console.log в Watcher.update для gazeAtPlayer). Verify: gazeAtPlayer достигает 1.0 за ~2.0 s.
- Mark-execute pierce. **Covers AE1.** После 2 s LOS — следующий fire (после aim window). Дашиться через траекторию лазера. Получить damage несмотря на dash i-frame. После hit — gazeAtPlayer на этом watcher-е == 0.
- LOS decay. **Covers AE2.** После 1.5 s LOS (gaze ≈ 0.75) спрятаться за пилон (Room 3 corridor has none — use Room 1 corridor `rooms.html` with its 3 pillars at 1100, 1900, 2700). Через 1 s wait — verify gaze упало до 0 (gaze line исчезла полностью, lock-on ring никогда не появлялся).
- Tracking + gaze interaction. Marked игрок (gaze == 1.0) дашит перпендикулярно во время aiming — tracking lock breaks, beam ушёл в сторону → pierce-flagged laser промахнулся. На next cycle если LOS возобновлён, gaze ещё около 1.0, опять marked. Pierce-логика капчится в момент aim→fire.
- Multi-watcher marked. **Covers AE5.** В `rooms.html` Room 3 arena (4 turrets + 1 watcher) — есть только один Watcher; для AE5 нужно временно добавить второго Watcher-а в test-комнату через editor или вручную в `room2.ts`. Проверить: оба marked одновременно, первый стреляет, у него gazeAtPlayer = 0, у второго остаётся ≥ 1 → markedByGaze у player всё ещё true.
- Friendly fire preserved with pierce. **Covers AE6 partially.** Marked игрок, beam летит в сторону другого врага за ним. Если beam попадает в другого врага — friendly fire fires нормально (не пробивает hit iframe для player, но это к friendly fire не относится).
- Hit iframe respected. Получить hit от bullet (hitIframe активен 1.0 s). Marked Watcher стреляет в этом окне — laser проходит через hitIframe-ed player без urona. Pierce flag не пробивает hit iframe.

**Verification:** `pnpm build` проходит. Все 7 playtest сценариев работают как описано.

---

### U4. Gaze line + lock-on indicator render

**Goal:** Визуализация LOS-присутствия Watcher-а и marked-состояния игрока.

**Requirements:** R8, R11, R13.

**Dependencies:** U3 (state.maxGazeAtPlayer aggregation; Watcher.gazeAtPlayer field).

**Files:**
- `src/lib/enemies/watcher.ts` (add `drawWatcherGazeLine(ctx, watcher, player, walls)` exported helper)
- `src/lib/player.ts` (add `drawMarkedIndicator(ctx, player, isMarked, nowMs)` exported helper)
- `src/rooms/rooms-game.ts` (call helpers in render pipeline)
- `src/tutorial/tutorial-game.ts` (call helpers in render pipeline)

**Approach:**
- `drawWatcherGazeLine`: проверить `awarenessState === "aggro"`. Если нет — skip. Сделать `isSegmentBlocked` check (либо передать pre-computed losClear из game tick). Если blocked — skip. Иначе: stroke line от `(watcher.x + pupilOffsetX, watcher.y + pupilOffsetY)` до `(player.x, player.y)`. Параметры зависят от `gazeAtPlayer`:
  - `gaze < 0.5`: lineWidth 0.8, alpha 0.25, strokeStyle `rgba(255, 23, 68, alpha)` (Watcher PALETTE.bullet)
  - `0.5 <= gaze < 1.0`: lineWidth 1.4, alpha 0.45
  - `gaze >= 1.0`: lineWidth 1.8, alpha 0.6, мерцание via `sin(nowMs * 0.05) * 0.5 + 0.5` (8 Hz = `0.05 * 2π * 1000 ms / Hz`, нужно подобрать константу).
  Без `shadowBlur` — perf-conscious (CLAUDE.md: per-frame shadowBlur запрещён).
- `drawMarkedIndicator`: если `!isMarked` — skip. Иначе stroke circle вокруг `(player.x, player.y)` радиусом `player.size * 1.4` (player.size = 24, → r = 33.6), lineWidth 1.2, alpha 0.6, мерцание на той же 8 Hz частоте, цвет `#ff1744` (Watcher iris color).
- В game render pipelines (both rooms-game and tutorial-game): найти существующий wall→enemy render boundary. Per CLAUDE.md и actual flow в rooms-game render — стены идут перед enemies. Между ними вставить loop по watcher-ам с вызовом `drawWatcherGazeLine`. После enemies / перед HUD — `drawMarkedIndicator` (он в world space вокруг игрока, не HUD).
- Передать pre-computed `losClear` per watcher: для каждого watcher-а в render tick — `losClear = !isSegmentBlocked(...)`. Можно не делать — пусть helper сам raycast'ит (дешевле кода, чуть дороже компьюта; 1-3 watcher × 60 fps = тривиально). Решение: helper делает raycast сам.

**Patterns to follow:**
- Existing render helpers в `lib/player.ts` (`drawPlayerEye`) — same exported function pattern.
- Wall / enemy render layering в `rooms-game.ts` — render order уже структурирован.
- Lock-on индикатор может переиспользовать render-pattern hit vignette / shield ring (см. `drawPlayer` или impact-effects код).

**Test scenarios (playtest in `tutorial.html` Room 2 + `rooms.html` Room 1 corridor):**
- Gaze line visibility on aggro. Подойти к Watcher-у. После idle→alerting→aggro transition: тонкая красная линия от зрачка watcher-а к игроку.
- Gaze line thickness scaling. Стоять в LOS, наблюдать утолщение по мере роста gaze (0.5 mark и 1.0 mark — заметные шаги в lineWidth).
- Gaze line at 1.0 — мерцание. Visually verify 8 Hz flicker.
- Gaze line break on LOS. Зайти за стену/пилон (Room 1 corridor — 3 пилона). Line исчезает мгновенно (helper does raycast).
- Lock-on ring at marked. Когда gazeAtPlayer hits 1.0 — красное кольцо вокруг player с мерцанием. Снимается одновременно с marked (после успешного попадания pierce-laser-а ИЛИ после спада gaze ниже 1.0).
- Lock-on ring with multiple watchers. Add a second Watcher (temp), пометить обоих → ring появляется только один (не N штук). После hit от первого: gaze#1=0, но если gaze#2 ещё ≥ 1 → ring остаётся.
- Visual perf check. Run `F2` perf-meter. Ни одна section не уходит в красное (>16ms target).

**Verification:** `pnpm build` проходит. Все 6 visual playtest scenarios читаются как описано.

---

### U5. Heartbeat ambient audio

**Goal:** Атмосферный low-frequency pulse loop пока в комнате есть aggro Watcher; gain и частота скейлятся от `maxGazeAtPlayer`. Снимается при смерти всех Watcher-ов или после длительного break-LOS.

**Requirements:** R8, R12.

**Dependencies:** U3 (state.maxGazeAtPlayer + aggro-watcher detection).

**Files:**
- `src/lib/audio.ts` (new synth chain + start/stop/update methods)
- `src/rooms/rooms-game.ts` (frame-tick wiring)
- `src/tutorial/tutorial-game.ts` (same wiring)

**Approach:**
- В `audio.ts`: добавить новые fields на `AudioEngine` — `heartbeatSynth?: MembraneSynth | Synth`, `heartbeatGain?: Gain`, `heartbeatLoop?: Tone.Loop`. Создать в `setupHeartbeat()` (вызывается из `init()` после остальных synth setup).
- Архитектура: `Tone.Loop` triggering `heartbeatSynth.triggerAttackRelease("F1", 0.08, time, velocity)` — sub-bass thump каждый interval. Interval контролируется снаружи: `setHeartbeatRate(hz)` устанавливает `heartbeatLoop.interval = 1 / hz`. Gain контролируется `setHeartbeatLevel(level)` через `heartbeatGain.gain.rampTo(level, 0.2)`.
- Methods на `play.{name}` accessor: `setHeartbeat(level: number, hz: number)`. Comprehensive — отвечает за start/stop/update в одной точке. Если `level === 0` — `triggerRelease` + остановить loop. Если `level > 0 && !running` — `loop.start()`. Иначе — update gain + interval.
- В game frame-tick (both rooms-game and tutorial-game): после `state.maxGazeAtPlayer` aggregation —
  ```
  const anyAggroWatcher = currentRoom.enemies.some(
    e => !e.isDead() && "gazeAtPlayer" in e && (e as Watcher).awarenessState === "aggro"
  );
  if (!anyAggroWatcher) {
    audio.play.setHeartbeat(0, 0.5);
  } else {
    const gaze = state.maxGazeAtPlayer;
    const level = 0.15 + gaze * 0.20;  // 0.15 at gaze 0, 0.35 at gaze 1
    const hz = 0.5 + gaze * 1.0;        // 0.5 Hz at gaze 0, 1.5 Hz at gaze 1
    audio.play.setHeartbeat(level, hz);
  }
  ```
- Tone.js Master gain bus уже существует — heartbeatGain маршрутится через master + sfx (или master напрямую — heartbeat это атмосфера, не SFX; решение: подключить к sfx bus как у остальных combat audio).

**Patterns to follow:**
- Существующие watcherChargeSynth setup в `audio.ts:519-543` — same pattern (Synth + Filter, configured in setup, attacked/released via methods).
- `Tone.Loop` — стандартный Tone.js paradigm, не требует custom infra.

**Test scenarios:**
- Heartbeat start on first aggro. Войти в зону watcher-а — audio loop включается на low gain после alerting → aggro transition.
- Heartbeat scale with gaze. Стоять в LOS — частота и громкость растут плавно (linear от gaze).
- Heartbeat stop on LOS break. Скрыться за стену — gaze падает, loop затихает к low level (0.15 gain, 0.5 Hz) но не останавливается полностью.
- Heartbeat full stop on watcher death. Убить watcher-а (HP 5 → 0). Через 200 ms — loop fully released.
- Multi-watcher: max gaze drives. Add a second Watcher. Только max(gaze1, gaze2) определяет частоту — не сумма.
- Sandbox no-op. Sandbox не содержит watcher-ов; heartbeat НЕ должен включаться в `sandbox.html` (sandbox-game.ts не вызывает `setHeartbeat`).

**Verification:** `pnpm build` проходит. Audio context корректно поднимается после первого keydown (как сейчас для остальных synths). Heartbeat плавно ramps in/out без щелчков (audio-gain ramps via Tone.js gain.rampTo).

---

## System-Wide Impact

- **`src/lib/enemies/types.ts`**: добавляется опциональное поле `piercesIframes?: boolean` в Laser type. Existing-code-compatible (default undefined ≡ false).
- **`src/rooms/rooms-game.ts`**: меняется player-laser collision (~30 строк), добавляется `state.maxGazeAtPlayer` aggregation + render helper calls + audio tick wiring (~15 строк). Удаляется local `raycastWalls` (заменён импортом).
- **`src/tutorial/tutorial-game.ts`**: те же изменения параллельно (~50 строк нового кода + удаление local raycastWalls).
- **`src/sandbox/sandbox-game.ts`**: не затрагивается. Watcher не используется в sandbox.
- **`src/lib/walls.ts`**: расширяется новыми exports (raycastWalls, isSegmentBlocked). Existing API не меняется.
- **`src/lib/audio.ts`**: расширяется heartbeat synth + method. Существующие synth chains не затрагиваются.
- **`src/lib/player.ts`**: добавляется один helper (`drawMarkedIndicator`). Существующие helpers не меняются.
- **`src/lib/enemies/watcher.ts`**: бóльшая часть изменений живёт здесь. Тип Watcher class API не меняется (всё через existing Enemy interface contract).

---

## Risks and Mitigations

- **Tutorial Room 2 становится слишком сложным.** Tutorial Watcher arena (`src/tutorial/room2.ts`) — single watcher, узкий corridor с стенами для cover. С новыми механиками encounter будет ощутимо сложнее. **Mitigation:** Tutorial Room 2 будет переработана отдельно если playtest покажет softlock-проблему. Per user signal — tutorial rooms тестовые, не блокеры релиза.
- **`rooms.html` Room 3 arena (open) without cover.** Open 1400×900 arena, нет пиларов для LOS break. Игрок не может избежать gaze meter fill. **Mitigation:** добавить 2-3 пилара в `room2.ts` (файл с file-id "room2", третий по chain) если encounter становится unwinnable. Или (предпочтительнее) построить новые комнаты которые специально проектируются с cover layout.
- **Performance: raycast в Watcher.update.** 1-3 Watcher-а × 60 fps = 60-180 LOS raycasts/sec. Cost per raycast = O(walls) ≈ 10-30 ops. Total: ~5000 ops/sec. Тривиально, но валидировать через `F2` perf-meter.
- **Audio heartbeat clipping/popping.** Tone.js gain ramps требуют корректного `rampTo` timing; sharp gain changes могут popнуть. **Mitigation:** все gain changes через `rampTo(level, 0.2)` (200 ms ramp), как уже сделано в существующих synths.
- **Marked state visual edge case: множественные watcher-ы.** Если игрок marked двумя watcher-ами одновременно, оба firing одновременно — один pierce-hit reset'ит только свой `gazeAtPlayer`, но второй laser ещё в полёте и тоже piercesIframes=true. Игрок получает damage дважды в одном цикле. **Решение:** допустимо. Hit iframe (R7) защитит — после первого hit `state.hitIframe > 0` блокирует второй laser. Verified через AE5 test scenario.
- **Tracking aim → friendly fire может промахнуться сильнее чем сейчас.** Static aim иногда «случайно» убивает другого врага — игрок этого ожидает. Tracking aim иногда уведёт beam с цели. **Mitigation:** AE6 проверяет что friendly fire всё ещё работает на корректно расположенных целях. Это побочный эффект, не баг.

---

## Scope Boundaries

- **Не делаем `awakened` варианты или per-room/per-level настройки Watcher-а.** Все Watcher-ы получают одинаковое поведение.
- **Не трогаем Hunter, Turret, Sentinel.** Per origin scope.
- **Не вводим новые damage paths** (proximity aura, body-slam dash, contact tick). Только existing beam + body contact.
- **Не вводим predictive lead, memory shot, convergence/triangulation.** Per origin scope. Может вернуться отдельным enhancement.
- **Не балансируем тестовые комнаты** (Tutorial Room 2, rooms.html Room 2-5). Per user signal — это будущая работа.
- **Не вводим debug HUD для gazeAtPlayer.** Visual feedback (gaze line, lock-on ring, heartbeat) уже даёт достаточно ощущения. Внутреннее значение gazeAtPlayer остаётся private state Watcher-а.

### Deferred to Follow-Up Work

- **Tuning pass после playtest.** Стартовые цифры заведомо агрессивные (per origin Key Decisions). Ожидаемо первая итерация playtest покажет 1-2 параметра требующих смягчения — `GAZE_FILL_TIME_SEC` (вероятный кандидат), `AIM_TRACKING_RAD_PER_SEC`, или cycle timings.
- **Audio polish-pass.** Heartbeat использует базовый MembraneSynth/Synth pattern. Может потребоваться более характерный sub-bass — saw + chorus, или layered samples. Откладывается до первой playtest.
- **Optional: gaze line render даже при разорванном LOS** (приглушённой, дашед, alpha 0.05). Origin doc предусматривает это как possible enhancement если playtest покажет «теряется связь с watcher-ом при cover». Не реализуется в этой итерации.
- **Refactor: `currentAimingLaser` field на Watcher.** Хранение прямой ссылки на live laser — pattern может быть переписан если в будущем потребуется multi-laser (например Watcher с двумя beam-ами). Не нужно сейчас.

---

## Key Technical Decisions

- **Single source of truth — Watcher class.** Все per-instance state (gazeAtPlayer, currentAimingLaser, firstAgroFired) живут на Watcher; game files только агрегируют и читают. Альтернатива (state на game-side, ID lookup) — добавила бы indirection и risk of stale references. (See origin: `docs/brainstorms/watcher-redesign-requirements.md` Key Decisions.)
- **Pierce flag на Laser, не на Player.** Capture-at-fire-spawn rather than evaluate-at-hit-time. Альтернатива (player.markedByGaze evaluated at hit) — позволяет hit-time changes (например marked just dropped below 1.0 between spawn and hit), что меньше предсказуемо для игрока. Capture-at-spawn — fair и читаемо: «он зарядил marked, beam обязательно несёт punch». (See origin: R7.)
- **Reset gazeAtPlayer on hit, not on fire-spawn.** Если marked-laser промахнулся, gaze остаётся ≥ 1.0 (если LOS не нарушен) и следующий cycle снова marked. Альтернатива (reset на fire-spawn) — слишком прощающий: marked Watcher теряет threat после каждого промаха. (See origin: R2.)
- **Pierce обходит dash i-frame, респектит hit i-frame.** Альтернатива (pierce обходит оба) — приводит к chain death без агентности игрока. Решение из origin Outstanding Questions (R7 deferred → resolved here).
- **Single `state.maxGazeAtPlayer` derived field.** Render и audio читают одно значение вместо итерации по enemies. Computed once per frame. Альтернатива (each consumer iterates) — duplicate work. Cost — 1 maximization over 1-3 watchers per frame, тривиально.
- **`raycastWalls` factor out в `lib/walls.ts`.** До этого функция дублирована в rooms-game и tutorial-game. Расширяемость для Watcher.update требует shared lib placement.
- **Audio loop через Tone.Loop, не requestAnimationFrame.** Tone.js предоставляет precision timing через Web Audio API clock — лучше чем rAF для periodic audio events (rAF jittered под GC/render load).

---

## Dependencies / Assumptions

- Tone.js уже в `package.json` и используется в `audio.ts` — нет новых dependencies.
- Существующий `awareness.ts` контракт (`idle | alerting | aggro`) не меняется. `canDeaggro` уже flag на enemy.
- Существующий `EnemyContext` уже передаёт `walls`, `player`, `dt`, `lasers` — Watcher.update has everything needed without API change.
- `state.maxGazeAtPlayer` и `state.markedByGaze` — добавляются как новые fields на game-side state object. Тип state уже structured (см. `rooms-game.ts` state init) — расширение без миграций.
- Player size = 24 px (PLAYER_SIZE constant). Lock-on ring радиус 33.6 px (`size * 1.4`) — внутри dash i-frame visualization, не конфликтует визуально.
- `pnpm dev` + `F2` perf-meter — основной dev loop для playtest validation.

---

## Outstanding Questions (Deferred to Implementation)

- [Affects U1, U3][Technical] Точное место хранения `currentAimingLaser` ссылки на Watcher — direct field, или через laser-id lookup на каждом фрейме? Decision: direct field, освобождать на firing → cooldown transition.
- [Affects U4][Technical] Mercание 8 Hz реализуется через `sin(nowMs * 0.05)` или Tone.Transport-driven? Decision: `sin(performance.now() * 0.05)` для visual sync — не требует Tone clock.
- [Affects U5][Technical] Должен ли heartbeat включаться при `alerting` фазе (500 ms телеграф) или только на `aggro`? Decision (default): только на `aggro` — alerting уже имеет alert burst audio cue, heartbeat пусть не конкурирует.
- [Affects U3][Technical] Type-guard pattern для `if ("gazeAtPlayer" in l.ownerEnemy)` — корректен в TS strict? Альтернатива: `l.ownerEnemy.type === "watcher"` (Watcher уже expose `readonly type = "watcher"`). Решение: использовать `.type` check, чище.

---

## Verification at Plan Level

План считается успешно реализованным когда:

1. `pnpm build` (= `tsc --noEmit && vite build`) проходит без warnings/errors.
2. Все playtest scenarios из U1-U5 fire correctly в `tutorial.html` Room 2 и `rooms.html` Room 1 corridor / Room 3 arena.
3. Все Acceptance Examples из origin doc (AE1-AE6) reproducible через playtest.
4. `F2` perf-meter показывает что ни один section не превышает 16ms budget при типичном encounter (1-3 watcher, обычная плотность пуль).
5. Sandbox-режим (`sandbox.html`) не затрагивается — никаких heartbeat audio, никаких marked indicators (там нет Watcher-ов).
