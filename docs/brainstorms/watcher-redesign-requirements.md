---
date: 2026-05-12
topic: watcher-redesign
---

# Watcher 2.0

## Summary

Полный редизайн врага Watcher из «куклы со стрельбой раз в 3.75 s» в **наблюдателя-снайпера** с непрерывной угрозой через line-of-sight. Главная новая механика — `gaze stack`: пока Watcher видит игрока, копится marker; на полном marker следующий лазер пробивает dash i-frames. Вокруг этого — tracking aim, отсутствие de-aggro, ускоренный цикл стрельбы, HP 5, постоянная gaze-линия от зрачка к игроку. Изменения глобальные (без `awakened` варианта) — Watcher везде становится единым архетипом.

---

## Problem Frame

Текущий Watcher не выполняет роль которую ему даёт лор. В `VECTRIX_LORE.md` он описан как «высокоранговый страж, снайпер, лазер которого = **признание** Witness'а, родственная сущность-зеркало». В геймплее он — медленный преследователь с предсказуемым 1.2 s telegraph и frozen aim, от которого достаточно шага в сторону. Игрок не чувствует что **за ним смотрят** — он видит дискретные firing events с большими паузами.

Три конкретные дизайн-дыры:

1. **Aim замораживается на момент старта `aiming`.** После захвата угла можно отойти и выстрел уйдёт в стену. Угроза перестаёт быть угрозой через 200 ms.
2. **Detection ring логика — binary alerting/aggro/de-aggro.** Watcher либо стреляет, либо не стреляет. Между выстрелами никакого continuous presence — он просто ходит. Лор-фраза «лазер = признание» теряется: игрок не видит что watcher на него **смотрит** до момента выстрела.
3. **HP 3 при цикле 3.75 s.** Watcher умирает в одном dash-комбо. Игрок не успевает прочувствовать угрозу — он его дашит сразу как видит.

Watcher должен стать врагом, рядом с которым игрок **режет маршрут** через геометрию (за пиларами, за стенами) — потому что continuous LOS повышает риск, а игнорирование Watcher-а активно карается.

---

## Key Flows

- F1. Encounter с одним Watcher-ом
  - **Trigger:** Игрок входит в зону `detectionRadius = 700` от Watcher-а в `idle`.
  - **Actors:** Witness (игрок), Watcher.
  - **Steps:**
    1. Awareness переходит `idle → alerting` (500 ms телеграф + alert burst, как сейчас).
    2. `alerting → aggro`. Между зрачком Watcher-а и игроком прорисовывается **gaze line** (тонкая красная). Heartbeat audio loop включается.
    3. `gaze meter` копится: пока есть прямой LOS (нет стен между watcher-ом и игроком), `+dt / 2.0` каждый кадр; иначе `−dt / 1.0`.
    4. Цикл стрельбы (idle 1.0 → aim 0.8 → fire 0.3 → cd 0.5). Во время `aiming` aim угла лерпится к направлению на игрока с ограничением 1.5 rad/s.
    5. Если в момент `fire` у игрока marker == 1.0 — лазер игнорирует dash i-frames и наносит damage. Marker сбрасывается до 0.
    6. Watcher НЕ возвращается в `idle` после того как потерял LOS — `canDeaggro = false`.
  - **Outcome:** Watcher преследует и обстреливает игрока до конца encounter-а или собственной смерти (HP 5, dash-through path как сейчас).
  - **Covered by:** R1, R3, R4, R5, R6, R7, R9, R10, R11.

- F2. Игрок разрывает LOS (counter-play)
  - **Trigger:** Игрок зашёл за стену или пилон, между ним и Watcher-ом есть препятствие.
  - **Actors:** Witness, Watcher.
  - **Steps:**
    1. Raycast watcher → player не проходит → `gazeAtPlayer -= dt / 1.0` каждый кадр.
    2. Gaze line гаснет (alpha → 0 быстрым лерпом 200 ms).
    3. Если меер ещё не был 1.0, успевает спасть до 0 за 1 секунду — игрок не marked.
    4. Watcher продолжает aiming/firing на последний известный угол (frozen pupil lock на момент потери LOS), либо переходит в чейз чтоб восстановить LOS.
  - **Outcome:** Marker снят, игрок безопасен до следующего восстановления LOS.
  - **Covered by:** R1, R2, R11.

---

## Requirements

**Gaze stack и detection**

- R1. Watcher хранит per-instance поле `gazeAtPlayer: number` (диапазон 0..1). Пока awareness state == `aggro` И raycast от Watcher → Player не пересекает стены: `gazeAtPlayer = min(1, gazeAtPlayer + dt / GAZE_FILL_TIME_SEC)`. Иначе `gazeAtPlayer = max(0, gazeAtPlayer − dt / GAZE_DECAY_TIME_SEC)`. Старт: `GAZE_FILL_TIME_SEC = 2.0`, `GAZE_DECAY_TIME_SEC = 1.0`.
- R2. Игрок имеет state-поле `markedByGaze: boolean`. Оно `true` если хотя бы один живой Watcher имеет `gazeAtPlayer ≥ 1.0`. Снимается при первом успешном попадании marked-лазером по игроку (`gazeAtPlayer` сбрасывается в 0 у Watcher-а который выстрелил).
- R3. Awareness state у Watcher-а после первого перехода в `aggro` больше не возвращается в `idle` (`canDeaggro = false`). Прежнее поведение idle figure-8 drift сохраняется только до первой агры.
- R4. `detectionRadius` остаётся 700 (без изменений). Alerting телеграф и его jitter сохраняются как сейчас.

**Aim и стрельба**

- R5. `aimAngle` лазера не замораживается на старте `aiming`. Каждый кадр во время `aiming` фазы: `aimAngle` лерпится к `atan2(player.y − watcher.y, player.x − watcher.x)` с ограничением углового изменения `AIM_TRACKING_RAD_PER_SEC * dt`. Старт: `AIM_TRACKING_RAD_PER_SEC = 1.5`. Endpoint лазера обновляется в `rooms-game.ts` laser tick через `raycastWalls` на основе свежего `aimAngle`.
- R6. Длительности фаз цикла стрельбы меняются. Старт: idle 1.0 s → aim 0.8 s → fire 0.3 s → cooldown 0.5 s. Общий цикл 2.6 s (было 3.75).
- R7. Когда Watcher переходит `aiming → firing` И в этот момент `gazeAtPlayer ≥ 1.0` — спавнящийся firing-лазер помечается флагом `piercesIframes: true`. При коллизии такого лазера с игроком dash i-frame check пропускается; damage применяется даже во время dash и обычной hit-i-frame.
- R8. Lock-on индикатор (R11) и audio cue остаются — момент перехода `aiming → firing` всё ещё имеет sharp-snap визуал.

**Выживаемость**

- R9. `WATCHER_HP_MAX = 5` (было 3). HP-pips над Watcher-ом продолжают рендериться, но строй из 5 точек вместо 3.
- R10. Только путь к damage — dash-through (как сейчас, через `tryDashDamage` + `dashIdAlreadyDamaged` дедуп). Никаких новых damage path-ей.

**Визуальный и аудио feedback**

- R11. **Gaze line**: пока `awarenessState == "aggro"`, между зрачком Watcher-а (`watcher.x + pupilOffsetX, watcher.y + pupilOffsetY`) и игроком (`player.x, player.y`) рисуется тонкая красная линия. Параметры зависят от `gazeAtPlayer`:
    - `gazeAtPlayer ∈ [0, 0.5)`: lineWidth 0.8, alpha 0.25
    - `gazeAtPlayer ∈ [0.5, 1.0)`: lineWidth 1.4, alpha 0.45
    - `gazeAtPlayer ≥ 1.0`: lineWidth 1.8, alpha 0.6, мерцает на 8 Hz
  Линия рисуется в отдельном render pass между walls и enemies. Когда LOS прерван (raycast не проходит) — линия не рисуется. Damage не наносит, hit-detection не имеет.
- R12. **Heartbeat ambient loop**: пока хотя бы один живой Watcher с `awarenessState == "aggro"` существует, играет низкочастотный пульс на бэкграунде. Громкость и частота линейно скейлятся от `max(gazeAtPlayer over all watchers)`: на 0 — частота 0.5 Hz, gain 0.15; на 1.0 — частота 1.5 Hz, gain 0.35. На разрыв LOS затухает к 0 за 500 ms (но не пропадает совсем пока в aggro есть хоть кто-то).
- R13. **Lock-on индикатор при `marked`** (gazeAtPlayer ≥ 1.0): вокруг игрока появляется тонкое красное кольцо (r = `player.size * 1.4`, lw 1.2, alpha 0.6, мерцает на 8 Hz). Снимается одновременно с marker-ом (после попадания marked-лазера или после спада meter-а ниже 1.0).

**Совместимость**

- R14. Friendly fire watcher-овским beam-ом по другим врагам работает как сейчас. Tracking aim не должен сломать существующую логику friendly fire (по beam-сегменту от `watcher` к `endX/endY`, дедуп через `hitByLaserId`). Конкретно: при tracking aim сегмент пересчитывается каждый кадр во время `firing` фазы (как уже делается), поэтому friendly-fire raycast тоже работает по свежему сегменту.
- R15. `Watcher` идл-поведение (figure-8 drift, idle pupil look) сохраняется до первой агры — лор-консистентно. После — поведение полностью новое (R3).

---

## Acceptance Examples

- AE1. **Covers R1, R2, R7, R11.** Witness стоит в чистом LOS у Watcher-а 2.0 секунды (без движения за стены). Gaze line становится толстой и мерцает; вокруг игрока появляется красное lock-on кольцо. Watcher на следующем `aiming → firing` стреляет; игрок дашится через траекторию лазера. Damage наносится несмотря на dash i-frames. Lock-on кольцо и mark снимаются. Gaze meter у этого Watcher-а возвращается к 0.

- AE2. **Covers R1, R2, R11.** Witness видит что gaze meter достиг 0.8 (gaze line утолщилась). Прежде чем meter достигнет 1.0, прячется за пилон. Gaze line гаснет, raycast watcher → player не проходит. За 1 секунду meter падает к 0. Игрок выходит из-за пилона — meter снова начинает копиться с 0.

- AE3. **Covers R5.** Watcher переходит в `aiming` пока игрок стоит на восток. Игрок начинает идти/бежать на север. Линия aim лазера медленно поворачивает следом со скоростью 1.5 rad/s. Игрок шагом не успевает оторваться (движение 440 px/s на дистанции ~300 px ≈ угловая скорость 1.47 rad/s — почти равно tracking rate). Дашит перпендикулярно — angular delta за 140 ms (dash duration) превышает tracking rate, lock breaks, лазер уходит в стену.

- AE4. **Covers R3.** Witness получил agro Watcher-а в Room 3, потом полностью вышел из `detectionRadius * 1.3 = 910` и не возвращается 5 секунд. Watcher продолжает преследовать или возвращается в патруль — но НЕ переходит в `idle` figure-8 drift. Gaze line отсутствует (LOS нет / player вне radius — это уже фильтр render-а), но `awarenessState` остаётся `aggro`.

- AE5. **Covers R7, R2.** Игрок marked (meter == 1.0 у Watcher-а #1). Рядом ещё один Watcher #2 чей meter тоже 1.0. Стреляет первым Watcher #1 — игрок получил damage с pierce. У Watcher #1 meter сбросился в 0; markedByGaze у игрока пересчитывается заново — Watcher #2 ещё ≥ 1.0, так что игрок остаётся marked для следующего выстрела Watcher #2.

- AE6. **Covers R14.** Watcher #1 в `aiming` фазе, прицелился через игрока на Watcher #2 находящегося за ним. Во время `aiming` Watcher #1 трекает игрока, ВНЕЗАПНО игрок уходит — angular delta превышен, beam летит не туда. Watcher #2 НЕ получает friendly-fire damage потому что beam ушёл мимо. Если игрок остался на линии — Watcher #2 получает friendly-fire damage в момент `firing`, как сейчас.

---

## Success Criteria

- Игрок чувствует **постоянное присутствие** Watcher-а через encounter, а не только в моменты firing. Subjective playtest check: «сколько секунд за время encounter-а игрок думал о Watcher-е?» — должно быть >50% времени, vs текущие ~10% (только в момент charge + fire).
- Игрок **режет маршрут через геометрию** (заходит за стены/пилоны) чтобы сбросить gaze meter. Если в комнате нет cover-а — encounter должен ощущаться как «выживание», а не «убил между стрельбой».
- Скорость убийства Watcher-а ≈ 2 dash-чейна (HP 5, dash-through 1 damage, 1 чейн = 1-2 successful dashes через тело). Время-на-убийство возрастает с текущих ~4 секунд до ~10-15 секунд.
- Friendly fire через watcher beam продолжает быть **викабильной** боевой механикой — в room-encounter-ах где есть 2+ watcher-а или watcher + другие враги, игрок может организовать crossfire.
- Lock-on механика читаема: первый раз когда игрока marked, он должен понять что произошло (увидеть красное кольцо, услышать heartbeat peak, получить damage сквозь dash) и интуитивно решить «надо ломать LOS».

---

## Scope Boundaries

- **Не делаем варианты Watcher-а** (`awakened` флаг, level-specific версии). Все Watcher-ы в игре становятся Watcher 2.0 одинаково. Если в будущем понадобится more dangerous variant — это отдельный архетип (например, `Greater Watcher`), а не флаг.
- **Не трогаем Hunter, Turret, Sentinel.** Изменения замкнуты на Watcher.
- **Не вводим новые damage-пути для Watcher-а.** Никаких body-slam dash-ей, proximity aura tick, contact-damage tick. Единственный damage — beam + body contact (как сейчас).
- **Не вводим predictive lead** (стрельба «куда игрок будет»). Tracking aim + faster cycle уже дают усиление; predictive lead избыточно и потенциально нечитаемо для игрока.
- **Не вводим memory shot** (echo прошлого dash-а как aim). Концептуально красиво, но за пределами текущей дизайн-итерации. Может вернуться отдельным enhancement-ом.
- **Не вводим convergence/triangulation для нескольких Watcher-ов.** Если 2+ marked одновременно — это просто 2 независимых выстрела сквозь iframe-ы. Без отдельной геометрии пересечения. Если будут конкретные level-encounter-ы где это важно — добавим в дальнейшем.
- **Тестовые комнаты (Room 2, 3, 4, 5)** не нужно отдельно балансировать под Watcher 2.0. Они тестовые, в будущем будут переделаны. Single source of truth по балансу — будущие новые комнаты, проектируемые под Watcher 2.0.
- **Room 1 (infected zone)** не затрагивается (там нет Watcher-ов).

---

## Key Decisions

- **Marker сбрасывается после попадания, не по таймеру.** Дискретная награда за wasted gaze — игрок понимает что выживание сброс mark-а заработал. Альтернатива «marker decays after N seconds» создаёт unclear feedback.
- **Lock-on линия видна постоянно при aggro, не только при `gaze ≥ 0.5`.** Лор требует «видеть что за тобой смотрят», даже когда угрозы мало. Утолщение/мерцание по мере роста meter-а делает прогрессию читаемой.
- **`canDeaggro = false` — поведение Hunter-style.** Это уже существующий контракт в awareness system; используем тот же путь. Лорно: «зеркало признало тебя».
- **HP 5, не 4 и не 6.** 4 — недостаточно чтобы encounter ощущался persistent (умирает в 2 дашевых чейна). 6 — слишком долго при tracking aim + faster cycle. 5 даёт ~2-3 чейна в окнах безопасности.
- **Стартовые цифры заведомо агрессивные.** Лучше дойти до баланса через ослабление; добавлять рычаги когда «не страшно» — путь к недодизайну.

---

## Dependencies / Assumptions

- Существующий `raycastWalls(x1, y1, x2, y2, walls)` уже используется лазерами (`src/rooms/rooms-game.ts` + `tutorial-game.ts`). Можно переиспользовать для gaze LOS check без новых модулей.
- `awarenessState` machine остаётся как есть в `lib/enemies/awareness.ts`; меняется только `canDeaggro` флаг (он уже параметр Watcher-а).
- Audio system (`lib/audio.ts`) поддерживает гейновые ramps и фильтры — heartbeat loop добавляется как новый synth chain (см. как сейчас сделан `watcherCharge` drone).
- `Laser` тип в `lib/enemies/types.ts` принимает дополнительный флаг `piercesIframes?: boolean` — изменение типа потребуется. Существующий код проверки laser-vs-player iframe пишется так, что если флаг есть и `true` — skip iframe check.
- Gaze line — отдельный render pass, должен идти **после** `drawWalls` и **до** `drawEnemies`, чтобы линия читалась поверх стен (а не наоборот) но под телами врагов. Уточняется при реализации.
- HUD никак не изменяется. Lock-on индикатор — render в world space вокруг player-а, не HUD.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R11][User decision] Gaze line должна рисоваться по прямой между зрачком Watcher-а и игроком ВСЕГДА когда aggro, или только когда LOS есть (raycast проходит)? Решено выше: только когда LOS есть. Но если playtest покажет что игрок теряет связь с Watcher-ом во время cover — возможно стоит рендерить «приглушённую» версию даже при разрыве LOS.
- [Affects R6, R12][User decision] Heartbeat loop в R12 нужно ли в этой итерации, или можно отложить как «audio polish после первого playtest визуала»? Лорно — желательно сразу, audio = большая часть «scary». Но можно отложить если хочется быстрее увидеть только визуальный/механический эффект.

### Deferred to Planning

- [Affects R5][Technical] Где конкретно в pipeline лазера живёт `aimAngle` сейчас — в `Watcher.advancePhase` (capture) и `rooms-game laser tick` (endpoint update)? Tracking логику нужно положить в одну точку, не дублировать.
- [Affects R1][Technical] Performance: 2-3 Watcher-а в комнате × 60 fps = 120-180 raycasts/sec. Учитывая что raycast уже работает для лазеров и cull-радиус известен — должно быть дёшево, но валидировать на perf-meter (F2) перед merge.
- [Affects R7][Technical] При `piercesIframes` — должен ли лазер ВСЁ РАВНО уважать player-side hit i-frame от другого источника? Например, игрок только что получил damage от Hunter-а, в hit i-frame, и тут летит marked beam. Решение: pierce обходит **dash** i-frame только; hit i-frame уважается (иначе chain death без агентности игрока).
- [Affects R12][Needs research] Какой синт для heartbeat — sub-bass triangle с фильтром? Существующая audio модель достаточная или нужен новый звуковой паттерн?
