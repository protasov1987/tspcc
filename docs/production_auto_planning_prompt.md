# Промт для внедрения автоматического планирования операций

Ниже собрана единая инструкция, как внедрить автоматическое планирование операций в текущую систему сменного планирования так, чтобы логика была детерминированной, воспроизводимой и совместимой с уже существующим ручным планированием. Повторяй описанные шаги буквально.

## Цель
- Добавить в существующее окно `#production-shift-plan-modal` полноценный режим автоматического планирования.
- Автоплан должен уметь:
  - планировать одну выбранную операцию;
  - планировать цепочку операций от выбранной операции до конца маршрута;
  - работать в режиме полного планирования;
  - работать в режиме частичного планирования;
  - учитывать задержку между операциями;
  - учитывать передачу изделий/ОС/ОК на следующую операцию партиями;
  - учитывать минимальный порог передачи, после которого следующая операция вообще может стартовать;
  - уважать текущие ограничения системы: доступные участки, свободное время смен, фиксированные смены, скрытые операции, qty-driven правила и текущий flow.

## Базовые правила (MUST)
- Существующий ручной режим планирования через `saveProductionShiftPlan()` обязан остаться рабочим без регрессий.
- Источник фактической потребности в планировании:
  - для qty-driven операций: `getOperationPlanningSnapshot(cardId, routeOpId)` и его поля `remainingQty`, `uncoveredQty`, `minutesPerUnit`, `requiredRemainingMinutes`, `availableToPlanMinutes`;
  - для не qty-driven операций: только минуты `requiredRemainingMinutes` и `availableToPlanMinutes`.
- Автоплан нельзя строить по материалам и возвратам материалов:
  - `isMaterialIssueOperation(op) === true` исключается;
  - `isMaterialReturnOperation(op) === true` исключается.
- Сушка (`isDryingOperation(op)`) не участвует в qty-driven расчётах передачи изделий между операциями.
- Для qty-driven операций разрешено планирование только целыми изделиями/ОС/ОК.
- Дробное количество для qty-driven операций запрещено как целевая партия передачи.
- Время в задаче округляется только через `roundPlanningMinutes()` / `roundPlanningMinutesServer()`.
- Количество округляется только через `roundPlanningQty()` / `roundPlanningQtyServer()`.
- Автоплан обязан использовать сервер как окончательный источник истины. Клиент может строить preview, но финальный расчёт и запись задач обязан выполнять сервер.
- Фиксированные смены и смены вне статуса планирования менять нельзя.
- Если задача автоплана требует точного учёта задержек, внутри смены обязательно должен существовать порядок задач во времени, а не только суммарные минуты на ячейку.

## Что считается полным и частичным планированием
- Полное планирование операции:
  - для qty-driven операции планируется весь `uncoveredQty`;
  - для не qty-driven операции планируются все `availableToPlanMinutes`.
- Частичное планирование операции:
  - для qty-driven операции планируется `min(userTargetQty, uncoveredQty)`;
  - для не qty-driven операции планируется `min(userTargetMinutes, availableToPlanMinutes)`.
- Полное планирование цепочки операций:
  - первая операция в цепочке получает полный целевой объём;
  - каждая следующая операция получает не больше:
    - собственного незакрытого спроса;
    - количества, которое реально передано ей с предыдущей операции по правилам передачи;
    - количества, которое помещается в доступный горизонт планирования.
- Частичное планирование цепочки операций:
  - пользователь задаёт один целевой объём `targetQty` для маршрута;
  - первая операция получает `min(targetQty, uncoveredQty первого этапа)`;
  - каждая следующая операция получает не больше:
    - `targetQty`;
    - собственного незакрытого спроса;
    - переданного ей объёма с предыдущей операции.

## Термины, которые обязаны трактоваться одинаково
- `planning scope`:
  - `selected-operation` — только выбранная операция;
  - `selected-to-end` — от выбранной операции до конца маршрута;
  - `whole-card` — весь маршрут карты с первой планируемой операции.
- `planning mode`:
  - `manual` — существующий ручной режим;
  - `auto` — новый автоматический режим.
- `planning kind`:
  - `full` — планировать максимум возможного по правилам;
  - `partial` — планировать только заданную пользователем часть.
- `transfer batch qty`:
  - количество изделий/ОС/ОК, которое передаётся на следующую операцию одной порцией.
- `transfer threshold qty`:
  - минимальное количество изделий/ОС/ОК, которое должно быть запланировано на предыдущей операции, прежде чем следующая операция вообще может получить первую порцию.
- `inter-operation delay`:
  - задержка в минутах между окончанием передаваемой партии на предыдущей операции и допустимым стартом этой партии на следующей операции.
- `planning horizon`:
  - число будущих смен, в рамках которых разрешено строить автоплан, начиная с выбранной пользователем ячейки.

## Изменения в UI модального окна (MUST)
- Использовать уже существующее окно `#production-shift-plan-modal`.
- В окне должен появиться переключатель режима:
  - `input[type=radio][name="production-shift-plan-mode"]`
  - значения: `manual`, `auto`.
- Добавить контейнер `#production-shift-auto-settings`, который:
  - скрыт в режиме `manual`;
  - видим в режиме `auto`.
- В `#production-shift-auto-settings` добавить следующие поля с точными id:
  - `#production-shift-auto-scope`
  - `#production-shift-auto-kind`
  - `#production-shift-auto-target-qty`
  - `#production-shift-auto-target-minutes`
  - `#production-shift-auto-delay-minutes`
  - `#production-shift-auto-transfer-threshold-qty`
  - `#production-shift-auto-transfer-batch-qty`
  - `#production-shift-auto-horizon-shifts`
  - `#production-shift-auto-area-mode`
  - `#production-shift-auto-allow-last-partial-batch`
  - `#production-shift-auto-preview`
- Поля обязаны работать так:
  - `#production-shift-auto-scope`
    - `selected-operation`
    - `selected-to-end`
    - `whole-card`
  - `#production-shift-auto-kind`
    - `full`
    - `partial`
  - `#production-shift-auto-target-qty`
    - используется только для qty-driven операций и только в режиме `partial`;
    - label обязан автоматически подставлять `изд`, `ОС` или `ОК`.
  - `#production-shift-auto-target-minutes`
    - используется только для не qty-driven операций и только в режиме `partial`.
  - `#production-shift-auto-delay-minutes`
    - целое число `>= 0`;
    - это задержка между операциями.
  - `#production-shift-auto-transfer-threshold-qty`
    - целое число `>= 1`;
    - пока на предыдущей операции не набралось это количество, следующая операция не стартует.
  - `#production-shift-auto-transfer-batch-qty`
    - целое число `>= 1`;
    - передача на следующую операцию идёт именно такими партиями.
  - `#production-shift-auto-horizon-shifts`
    - целое число `>= 1`;
    - ограничивает, сколько смен вперёд разрешено занимать автоплану.
  - `#production-shift-auto-area-mode`
    - `current-area-only`
    - `allowed-areas`
  - `#production-shift-auto-allow-last-partial-batch`
    - checkbox;
    - если включён, последняя партия может быть меньше `transfer batch qty`, но только для конечного остатка текущего запуска.
- В режиме `auto` справа от списка операций должен отображаться preview:
  - сколько задач будет создано;
  - на какие смены они попадут;
  - сколько минут и сколько изделий/ОС/ОК будет покрыто;
  - какой объём останется непокрытым после текущего запуска.
- Кнопка `#production-shift-plan-save`:
  - в режиме `manual` сохраняет существующее поведение;
  - в режиме `auto` запускает автоплан.

## Поведение полей и видимость
- Если выбран `manual`, все auto-настройки скрыты и игнорируются.
- Если выбран `auto` + `selected-operation`, настройки передачи между операциями видимы, но используются только если пользователь потом переключит scope на цепочку. Для одной операции они игнорируются.
- Если операция qty-driven:
  - показывать `#production-shift-auto-target-qty`;
  - скрывать `#production-shift-auto-target-minutes`.
- Если операция не qty-driven:
  - показывать `#production-shift-auto-target-minutes`;
  - скрывать `#production-shift-auto-target-qty`;
  - поля `transfer-threshold` и `transfer-batch` визуально disabled и логически игнорируются.
- Если выбран `full`, оба поля цели (`target-qty`, `target-minutes`) disabled и не участвуют в расчёте.
- Если выбран `partial`, ровно одно целевое поле обязано участвовать в расчёте:
  - qty-driven => `target-qty`;
  - не qty-driven => `target-minutes`.

## Данные и модель хранения (MUST)
- Не ломать существующий массив `productionShiftTasks`.
- Расширить `productionShiftTask` следующими полями:
  - `plannedStartOffsetMin`
  - `plannedEndOffsetMin`
  - `autoPlanRunId`
  - `autoPlanSource`
  - `autoPlanScope`
  - `autoPlanKind`
  - `transferBatchQtySnapshot`
  - `transferThresholdQtySnapshot`
  - `interOpDelayMinSnapshot`
- Значения:
  - `autoPlanSource`: `MANUAL` или `AUTO`
  - `autoPlanScope`: `SELECTED_OPERATION`, `SELECTED_TO_END`, `WHOLE_CARD`
  - `autoPlanKind`: `FULL` или `PARTIAL`
- В state / db добавить настройки по умолчанию:
  - `productionAutoPlanningSettings`
  - структура:
    - `scope`
    - `kind`
    - `delayMinutes`
    - `transferThresholdQty`
    - `transferBatchQty`
    - `horizonShifts`
    - `areaMode`
    - `allowLastPartialBatch`
- Эти настройки используются как default при открытии модалки, но пользователь может изменить их перед запуском.

## Критически важное правило по времени внутри смены
- Нельзя реализовывать задержку между операциями, опираясь только на суммарные минуты в ячейке.
- Если создаётся auto-задача, для неё обязательно сохраняются:
  - `plannedStartOffsetMin`
  - `plannedEndOffsetMin`
- Смещение считается относительно начала смены.
- Каждая новая auto-задача в ячейке ставится в хвост уже существующей очереди этой ячейки:
  - `plannedStartOffsetMin = уже занятые минуты в ячейке`;
  - `plannedEndOffsetMin = plannedStartOffsetMin + plannedPartMinutes`.
- Уже занятые минуты ячейки считаются как максимум `plannedEndOffsetMin` существующих задач, а если таких полей нет, то как сумма `getTaskPlannedMinutes(task)`.

## Merge / объединение задач (MUST)
- Старое поведение merge по ключу `cardId|routeOpId|date|shift|areaId` нельзя применять слепо к auto-задачам с таймингом.
- Если у задачи заполнены `plannedStartOffsetMin` и `plannedEndOffsetMin`, её можно объединять только если одновременно выполняются все условия:
  - одинаковый merge key;
  - одинаковый `autoPlanRunId`;
  - одинаковый `autoPlanSource`;
  - совпадают временные интервалы или они непосредственно прилегают друг к другу без разрыва;
  - совпадают snapshot-поля автоплана.
- Если эти условия не выполнены, задачи должны храниться раздельно, иначе сломается логика задержек и передачи.

## Серверный API (MUST)
- Не переносить расчёт автоплана только на клиент.
- Расширить `POST /api/production/plan/commit`.
- Допустимые `action`:
  - `add`
  - `move`
  - `auto-plan`
- Для `action: "auto-plan"` клиент отправляет:
  - `cardId`
  - `routeOpId`
  - `date`
  - `shift`
  - `areaId`
  - `scope`
  - `kind`
  - `targetQty`
  - `targetMinutes`
  - `delayMinutes`
  - `transferThresholdQty`
  - `transferBatchQty`
  - `horizonShifts`
  - `areaMode`
  - `allowLastPartialBatch`
- Сервер обязан:
  - валидировать payload;
  - сам построить список задач;
  - сам записать задачи в `productionShiftTasks`;
  - вызвать `reconcileCardPlanningTasksServer()`;
  - вернуть:
    - `ok`
    - `cardId`
    - `card`
    - `tasksForCard`
    - `createdTasks`
    - `skippedReasons`
    - `uncoveredRemainder`

## Выбор операций для цепочки
- `selected-operation`:
  - использовать только `routeOpId`, выбранный в списке.
- `selected-to-end`:
  - взять маршрут карты от выбранной операции включительно до конца;
  - исключить скрытые и непланируемые операции.
- `whole-card`:
  - взять все планируемые операции карты в маршрутном порядке;
  - если выбрана операция в середине списка, выбор пользователя не должен менять начальную точку режима `whole-card`.

## Правила выбора участка
- Если `areaMode = current-area-only`:
  - операция может планироваться только в выбранный пользователем `areaId`;
  - если операция не допускает этот участок, она пропускается с понятной причиной в `skippedReasons`.
- Если `areaMode = allowed-areas`:
  - сначала пытаемся использовать выбранный `areaId`, если он разрешён операции;
  - иначе выбираем первый разрешённый участок из `allowedAreaIds` в порядке `areas`;
  - если разрешённых участков нет, операция пропускается.

## Горизонт планирования
- Автоплан всегда стартует с выбранной пользователем ячейки `date + shift`.
- В горизонт входят только следующие по времени смены.
- Число рассматриваемых смен строго ограничено `horizonShifts`.
- Автоплан не имеет права выходить за горизонт даже если задача не закрыта полностью.

## Детерминированный алгоритм планирования одной операции
1. Построить `snapshot = getOperationPlanningRequirementServer(...)` или эквивалент на основе серверного состояния.
2. Определить целевой объём:
   - `full`:
     - qty-driven => `targetQty = uncoveredQty`
     - non-qty => `targetMinutes = availableMinutes`
   - `partial`:
     - qty-driven => `targetQty = min(userTargetQty, uncoveredQty)`
     - non-qty => `targetMinutes = min(userTargetMinutes, availableMinutes)`
3. Построить список допустимых сменовых слотов в пределах горизонта.
4. Для каждого слота вычислить свободную ёмкость через существующую логику свободных минут.
5. Для qty-driven операции:
   - вычислить `slotQtyCapacity = floor(slotFreeMinutes / minutesPerUnit)`;
   - выделять только целое количество;
   - `plannedQtyForSlot = min(remainingTargetQty, slotQtyCapacity)`;
   - `plannedMinutesForSlot = roundPlanningMinutes(minutesPerUnit * plannedQtyForSlot)`.
6. Для non-qty операции:
   - `plannedMinutesForSlot = min(remainingTargetMinutes, slotFreeMinutes)`.
7. Создавать задачи только если `plannedMinutesForSlot > 0`.
8. После каждой созданной задачи уменьшать остаток цели.
9. Остановиться, когда цель закрыта или слоты закончились.

## Детерминированный алгоритм передачи на следующую операцию
- Эти правила используются только для scope `selected-to-end` и `whole-card`.
- Для каждой пары соседних операций `prev -> next`:
  - пока суммарно запланированный объём на `prev` меньше `transferThresholdQty`, на `next` нельзя планировать ничего;
  - после достижения порога передача идёт партиями `transferBatchQty`;
  - каждая партия на `next` может стартовать не раньше, чем:
    - соответствующая партия завершилась на `prev`;
    - плюс `delayMinutes`.
- Количество, доступное `next`, рассчитывается так:
  - `releasedQty = totalCompletedQtyOnPrevEligibleForTransfer - alreadyConsumedByNext`;
  - если `releasedQty < transferBatchQty`, то:
    - при `allowLastPartialBatch = false` следующая партия не создаётся;
    - при `allowLastPartialBatch = true` партия допустима только если это конечный остаток текущего запуска.
- Следующая операция не может получить больше, чем:
  - реально выпущено и передано с предыдущей операции;
  - нужно по её собственному `uncoveredQty`;
  - помещается в доступные слоты её участка.

## Детерминированный алгоритм планирования цепочки операций
1. Выбрать операции по `scope`.
2. Для первой операции рассчитать план по правилам одной операции.
3. Для каждой следующей операции:
   - собрать временную шкалу партий, завершённых на предыдущей операции;
   - применить `transferThresholdQty`;
   - применить `transferBatchQty`;
   - применить `delayMinutes`;
   - из получившегося доступного объёма построить план по допустимым слотам.
4. Планирование всегда идёт строго в маршрутном порядке.
5. Если предыдущая операция в текущем запуске не смогла выпустить ни одной передаваемой партии, следующая операция не создаётся.
6. Автоплан не должен искусственно создавать задачи на поздних операциях без обеспеченного объёма с предыдущих этапов.

## Обязательные причины отказа / skippedReasons
- `NO_CARD`
- `NO_OPERATION`
- `NO_DEMAND`
- `SHIFT_FIXED`
- `SHIFT_COMPLETED`
- `NO_ALLOWED_AREA`
- `NO_CAPACITY`
- `TARGET_QTY_INVALID`
- `TARGET_MINUTES_INVALID`
- `TRANSFER_THRESHOLD_INVALID`
- `TRANSFER_BATCH_INVALID`
- `HORIZON_INVALID`
- `BLOCKED_BY_PREVIOUS_OPERATION`
- `DELAY_PUSHED_OUT_OF_HORIZON`

## Клиентская логика
- В `js/app.75.production.js`:
  - не ломать `openProductionShiftPlanModal()`;
  - не ломать `updateProductionShiftPlanPart()`;
  - сохранить существующий ручной ввод минут;
  - добавить отдельный state для auto-настроек модалки;
  - добавить preview-расчёт без записи в БД;
  - при сохранении в режиме `auto` отправлять только параметры запуска, а не готовый список задач.
- Preview на клиенте должен повторять серверную логику максимально близко, но если сервер вернул другой результат, UI обязан принять серверный ответ без попытки "доправить" его локально.

## Серверная логика
- В `server.js`:
  - добавить отдельные функции, а не смешивать всё в один обработчик:
    - `buildAutoPlanningContextServer(...)`
    - `buildAutoPlanningSlotsServer(...)`
    - `planSingleOperationAutoServer(...)`
    - `planOperationChainAutoServer(...)`
    - `appendAutoPlannedTasksServer(...)`
  - после записи задач обязательно вызвать:
    - `mergeProductionShiftTasksServer(...)` с новыми правилами merge;
    - `reconcileCardPlanningTasksServer(...)`.

## Диагностика (MUST)
- Любые новые изменения обязаны логироваться.
- Допустимый формат:
  - `[PLAN][AUTO] request ...`
  - `[PLAN][AUTO] slot ...`
  - `[PLAN][AUTO] release ...`
  - `[PLAN][AUTO] result ...`
- Логи обязаны позволять понять:
  - какая карта планировалась;
  - какой scope выбран;
  - какой kind выбран;
  - какая операция была стартовой;
  - какая партия когда была выпущена и когда стала доступной следующему этапу;
  - почему часть операций была пропущена;
  - сколько задач создали и сколько осталось не покрыто.

## Acceptance criteria (MUST pass)
- Ручное планирование из текущей модалки продолжает работать без изменений.
- Автоплан одной операции в режиме `full` закрывает весь доступный остаток либо упирается в горизонт/ёмкость.
- Автоплан одной операции в режиме `partial` создаёт ровно заданный объём, если хватает ёмкости.
- Для qty-driven операций создаются только целые изделия/ОС/ОК.
- Следующая операция не стартует раньше порога передачи.
- Следующая операция не стартует раньше задержки между операциями.
- Автоплан не создаёт задачи в фиксированных сменах.
- Автоплан не нарушает `allowedAreaIds`.
- Задачи с разными временными окнами не схлопываются некорректным merge.
- После автоплана стадия карты (`PROVIDED` / `PLANNING` / `PLANNED`) пересчитывается корректно.
- После перезагрузки страницы все auto-задачи и их тайминг сохраняются и отображаются корректно.

## Файлы, которые почти наверняка придётся менять
- `index.html`
- `js/app.75.production.js`
- `server.js`
- `db.js`

Скопируй и следуй этому промту при следующих задачах по внедрению автоматического планирования, чтобы не получить размытое поведение, ложные переносы между операциями и регрессии в текущем ручном планировании.
