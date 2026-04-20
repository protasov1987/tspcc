# Migration Plan

Этот документ фиксирует полный порядок перехода текущего migration perimeter
сайта из состояния, описанного в [Current State](./current-state.md),
в [Target Architecture](./target-architecture.md).

Это не план для "части приложения" и не список опциональных улучшений.
Это обязательный migration contract для всего in-scope perimeter сайта.

Исключение: домен `receipts` в рамках этой программы выведен в замороженный
legacy carve-out и не входит в текущий migration perimeter.

---

## Status and Migration Perimeter

- Этот документ описывает переход всего текущего migration perimeter к target architecture.
- Завершение миграции определяется по всему in-scope perimeter, а не по одному
  или нескольким наиболее важным доменам.
- Исключение `receipts` является сознательным carve-out, а не случайным пропуском.
- `receipts` не участвует в этапах, не участвует в global exit criteria и не
  является blocker для завершения этой migration program.
- `docs/business-rules/*.md` остаются обязательным guardrail для всех
  in-scope доменов и не могут быть нарушены в ходе миграции.

### In Scope

- routing / bootstrap / auth / permissions
- cards
- approvals
- input control
- provision
- card files
- directories
- users / access levels
- production schedule / plan / shifts / gantt
- workspace / flow execution
- delayed / defects / repair / dispose
- workorders / archive / items / ok / oc
- messaging / profile / notifications
- realtime
- diagnostics
- testing

### Out Of Scope For This Migration Program

- `/receipts`
- `/receipts/:id`
- related read / store / UI logic of `receipts`
- any future redesign of receipts domain

---

## Receipts Freeze Rule

- `receipts` не мигрируется в рамках этого плана.
- `receipts` не переводится на новую domain model в рамках этого плана.
- `receipts` не используется как justification для сохранения legacy-механизма
  в других доменах.
- Остальные домены не должны зависеть от `receipts` как от архитектурной опоры.
- Случайные правки `receipts` при соседних рефакторингах запрещены.
- Если когда-либо понадобится миграция `receipts`, для него должен быть
  создан отдельный самостоятельный migration plan.

---

## Main Rule

- Миграция выполняется маленькими шагами.
- Один шаг меняет один логический слой или один домен.
- Но сумма шагов обязана покрыть весь in-scope perimeter без исключений.
- Нельзя объявить миграцию завершенной, пока в рабочем in-scope perimeter
  остается хотя бы один:
  - критичный snapshot-save flow
  - неконтролируемый conflict-path
  - route outside central model
  - realtime-dependent correctness path
  - бизнес-критичный экран вне server-truth domain model

---

## Replacement Stage Plan

## Stage 0. Freeze Inventory, Perimeter and Legacy Boundaries

Цель:
- зафиксировать полный объем текущей migration program
- исключить выпадение отдельных route families и доменов из плана
- отделить in-scope perimeter от frozen `receipts`

Обязательный результат:
- все in-scope route families перечислены в этом документе
- все in-scope domain families перечислены в этом документе
- для каждого in-scope домена определено:
  - current-state
  - target-state
  - legacy-path to remove
- `receipts` явно записан как out-of-scope frozen domain
- `current-state.md`, `change-checklist.md` и `docs/business-rules/*.md`
  не противоречат этому perimeter

Этап не завершен, если:
- есть in-scope route family без привязки к этапу миграции
- `receipts` не отделен явно от migration perimeter

---

## Stage 1. Stabilize Routing, Bootstrap and Auth For Entire In-Scope Perimeter

Цель:
- сделать routing/bootstrap/auth общим надежным фундаментом для всей
  дальнейшей миграции

Обязательный результат:
- один router
- один bootstrap
- `URL -> active screen`
- `popstate -> handleRoute(fullPath, { fromHistory: true, ... })`
- protected routes only after session restore
- no forced redirect on boot
- стабильные `F5`, direct URL, history для всех in-scope routes
- `[BOOT]` и `[ROUTE]` покрывают весь in-scope perimeter

Маршруты покрытия:
- `/dashboard`
- `/cards`
- `/cards/new`
- `/cards/:id`
- `/card-route/:qr`
- `/approvals`
- `/provision`
- `/input-control`
- `/departments`
- `/operations`
- `/areas`
- `/employees`
- `/shift-times`
- `/users`
- `/accessLevels`
- `/profile/:id`
- `/production/schedule`
- `/production/plan`
- `/production/shifts`
- `/production/shifts/:key`
- `/production/gantt/:...`
- `/workspace`
- `/workspace/:qr`
- `/production/delayed`
- `/production/delayed/:qr`
- `/production/defects`
- `/production/defects/:qr`
- `/workorders`
- `/workorders/:qr`
- `/archive`
- `/archive/:qr`
- `/items`
- `/ok`
- `/oc`

Этап не завершен, если:
- хотя бы один in-scope route family открывается через обходной pipeline
- хотя бы один protected route рендерится до auth restore

---

## Stage 2. Introduce Shared Domain Write and Conflict Contract

Цель:
- создать единый контракт записи для всех in-scope критичных доменов

Обязательный результат:
- shared revision model
- shared conflict envelope
- shared client command execution pattern
- shared targeted refresh pattern
- shared `[CONFLICT]` / `[DATA]` diagnostics
- запрет на новые критичные write-path через `/api/data`

Общий контракт:
- `id`
- `rev`
- `expectedRev`
- `409 Conflict`

Response fields:
- `code`
- `entity`
- `id`
- `expectedRev`
- `actualRev`
- user-safe message

Этап не завершен, если:
- хотя бы один новый in-scope domain write проектируется вне этого контракта

---

## Stage 3. Migrate Cards Core

Цель:
- полностью убрать generic cards writes из snapshot-save

Что входит:
- create
- update
- delete
- archive
- repeat
- detail fetch
- list / query
- route-local refresh

Обязательный результат:
- cards живут через отдельный card domain API
- `card.rev` становится обязательной частью write contract
- stale card write дает `409`
- conflict не выбрасывает пользователя с card route
- targeted card refresh заменяет full reload

Этап не завершен, если:
- обычное редактирование карточки все еще зависит от `/api/data`

---

## Stage 4. Migrate Approval, Input Control and Provision

Цель:
- перевести lifecycle карточки на явные server commands без потери business-rules

Что входит:
- send to approval
- role-based approvals
- reject with reason
- return rejected to draft
- input control
- provision
- stage transitions
- audit / log side effects

Обязательный результат:
- никакой approval / input / provision write не использует `saveData()`
- stage semantics
  `DRAFT -> ON_APPROVAL -> REJECTED/APPROVED -> WAITING_* -> PROVIDED -> PLANNING -> PLANNED`
  сохранены
- reject reason и audit trail сохранены
- conflict сохраняет route и context

Этап не завершен, если:
- хотя бы один approval-related write остался на snapshot-save path

---

## Stage 5. Complete Card Files

Цель:
- довести file-domain карточки до полной target-model совместимости

Что входит:
- upload
- delete
- resync
- attachment-linked side effects
- card/file consistency

Обязательный результат:
- file operations принимают `expectedRev`
- file operations возвращают новый `cardRev`
- input-control file linkage остается корректным
- duplicate `PARTS_DOCS` rule сохранен
- file actions не используют snapshot path

Этап не завершен, если:
- file operation карточки может пройти без revision-safe contract

---

## Stage 6. Migrate Directories

Цель:
- перевести весь directories-domain на отдельные domain APIs

Что входит:
- departments / centers
- operations
- areas
- employees assignment
- shift times

Обязательный результат:
- нет directory writes через `/api/data`
- сервер валидирует права и revision where needed
- сохранены:
  - department delete guard
  - operation type guard
  - historical text preservation
  - production dependencies on areas / shift times

Этап не завершен, если:
- хотя бы один directory write по-прежнему идет через aggregated snapshot

---

## Stage 7. Complete Security Domain

Цель:
- довести users / access-levels / security behavior до полной target-модели

Что входит:
- users
- access levels
- permission semantics
- landing tab
- inactivity timeout
- profile access rules

Обязательный результат:
- все security writes идут через отдельный security domain API
- `Abyss` protection сохранен
- password validation / uniqueness preserved
- `landingTab` и `inactivityTimeoutMinutes` встроены в общую model of truth
- `/profile/:id` продолжает соблюдать ownership / privacy rules

Этап не завершен, если:
- security UI использует обходной write-path вне server-truth domain

---

## Stage 8. Migrate Production Planning Layer

Цель:
- полностью перевести planning-side на production domain API

Что входит:
- production schedule
- production plan
- production shifts
- gantt
- planning validations

Обязательный результат:
- no planning writes through snapshot-save
- только targeted production slice updates
- no correctness based on heavy local shadow state
- route-local refresh для planning pages

Этап не завершен, если:
- planning write хоть в одном in-scope сценарии уходит в общий snapshot

---

## Stage 9. Migrate Workspace and Execution Layer

Цель:
- довести execution-side production до полной target model

Что входит:
- workspace
- personal operations
- identify
- transfer
- material issue / return
- drying
- delayed
- defects
- repair
- dispose

Обязательный результат:
- все execution writes идут через explicit production commands
- сохраняется `expectedFlowVersion -> 409`
- conflict означает:
  - stay on route
  - show clear message
  - targeted production refresh
- no silent overwrite
- no correctness via pending-state tricks

Этап не завершен, если:
- хотя бы одно execution действие использует обходной write-path

---

## Stage 10. Migrate Derived Production Views

Цель:
- привести производные представления к новой source-domain architecture

Что входит:
- `/workorders`
- `/workorders/:qr`
- `/archive`
- `/archive/:qr`
- `/items`
- `/ok`
- `/oc`

Обязательный результат:
- derived views не имеют собственных bypass write-path
- они остаются производными read-model витринами
- сохраняют business-rules:
  - archive semantics
  - repeat creates new draft
  - items / ok / oc remain consistent with flow
  - detail routes remain stable

Этап не завершен, если:
- derived views зависят от legacy source-model, противоречащей новому cards / production contract

---

## Stage 11. Migrate Messaging, Profile and Notifications

Цель:
- привести messaging stack к одному final path

Что входит:
- `/profile/:id`
- direct chat
- delivered / read / unread
- user actions
- webpush
- FCM
- chat deeplinks

Обязательный результат:
- `/api/chat/*` становится единственным primary stack
- `/api/messages/*` удаляется или остается только временным adapter с финальным removal step
- profile privacy preserved
- no system-user dialog regression
- delivered / read semantics preserved
- deeplink via `openChatWith` / `conversationId` preserved

Этап не завершен, если:
- одновременно живут два равноправных message stacks

---

## Stage 12. Normalize Realtime For Entire In-Scope Perimeter

Цель:
- привести live behavior к единой модели

Что входит:
- cards live
- directories / security live
- production / workspace live
- messaging live
- fallback refresh
- `[LIVE]` diagnostics

Обязательный результат:
- realtime нигде не обязателен для correctness
- live only signals refresh
- bootstrap never depends on live
- standardized event / fallback behavior across in-scope domains

Этап не завершен, если:
- хотя бы один in-scope бизнес-критичный сценарий требует realtime для correctness

---

## Stage 13. Remove Legacy Snapshot and Transitional Overlaps

Цель:
- удалить переходную архитектуру после replacement всех in-scope domains

Что входит:
- `/api/data` as critical write path
- client `saveData()` for critical domains
- route / write / live overlaps
- shadow correctness hacks
- legacy messaging overlap

Обязательный результат:
- в in-scope perimeter больше нет критичных writes через aggregated snapshot
- no parallel domain models
- no correctness on local giant mutable snapshot
- no unresolved adapter left without removal path

Этап не завершен, если:
- в in-scope perimeter остается хотя бы один критичный snapshot-based write

---

## Stage 14. Final Diagnostics, E2E and Performance Hardening

Цель:
- закрыть миграцию доказательством достижения target architecture для всего
  in-scope perimeter

Обязательный результат:
- normalized diagnostics:
  - `[BOOT]`
  - `[ROUTE]`
  - `[LIVE]`
  - `[DATA]`
  - `[CONFLICT]`
- full E2E coverage for in-scope critical routes and conflict scenarios
- perf work only after correctness completion and measurement

Временное примечание:
- текущий realtime E2E для `/workspace` может использовать временный допуск
  выше `1000ms`, если это нужно для стабильности CI после correctness-fix
- такой допуск не считается target SLA и не меняет target architecture
- после завершения текущих architectural batches должен быть выполнен
  отдельный performance hardening для server write-path / DB persist и
  realtime measurement
- после этого временный допуск должен быть пересмотрен и ужат обратно до
  целевого значения или заменен на явно зафиксированный domain SLA

---

## Test Plan

- Route coverage must explicitly exclude only `receipts`, but include all other
  current in-scope route families.
- Card tests:
  - create / edit / delete / archive / repeat
  - approval send / approve / reject
  - input control
  - provision
  - files upload / delete / resync
  - stale `expectedRev`
- Directory / security tests:
  - delete guards
  - operation type conflict guard
  - access level effects
  - `Abyss`
  - passwords
  - `landingTab`
  - inactivity timeout
- Production tests:
  - planning success / failure
  - workspace actions
  - delayed / defect / repair / dispose
  - stale `expectedFlowVersion`
- Derived view tests:
  - workorders / archive / items / ok / oc consistency after source-domain updates
- Messaging / profile tests:
  - profile privacy
  - chat deeplink
  - delivered / read
  - push subscribe / unsubscribe / test
- Realtime tests:
  - multi-client propagation
  - correctness with live unavailable

---

## Mandatory Order Of Migration

1. Stage 0. Freeze Inventory, Perimeter and Legacy Boundaries
2. Stage 1. Stabilize Routing, Bootstrap and Auth For Entire In-Scope Perimeter
3. Stage 2. Introduce Shared Domain Write and Conflict Contract
4. Stage 3. Migrate Cards Core
5. Stage 4. Migrate Approval, Input Control and Provision
6. Stage 5. Complete Card Files
7. Stage 6. Migrate Directories
8. Stage 7. Complete Security Domain
9. Stage 8. Migrate Production Planning Layer
10. Stage 9. Migrate Workspace and Execution Layer
11. Stage 10. Migrate Derived Production Views
12. Stage 11. Migrate Messaging, Profile and Notifications
13. Stage 12. Normalize Realtime For Entire In-Scope Perimeter
14. Stage 13. Remove Legacy Snapshot and Transitional Overlaps
15. Stage 14. Final Diagnostics, E2E and Performance Hardening

Причина такого порядка:
- routing / bootstrap / auth должны быть стабильным фундаментом
- cards должны стать первым полностью доведенным core domain
- production нельзя завершать раньше, чем стабилизированы cards / directories / security
- derived views нельзя окончательно доводить раньше, чем стабилизированы source domains
- legacy snapshot нельзя удалять раньше, чем все in-scope домены получили replacement path
- perf нельзя считать целью раньше, чем закрыта correctness по всему in-scope perimeter

---

## What Must Not Be Combined In One Change

- менять bootstrap и router одновременно
- менять router и переносить большой домен на новую write-модель
- вводить новый domain write и одновременно переписывать realtime того же домена
- переводить production planning и production execution одним большим куском
- убирать legacy snapshot до завершения replacement path для всех in-scope доменов
- делать perf-cache refactor вместе с correctness migration базового потока

---

## Global Exit Criteria

Новый `migration-plan.md` считает миграцию завершенной только если:

- весь in-scope perimeter соответствует `target-architecture.md`
- все in-scope critical writes domain-based
- все in-scope competitive edits have revision / conflict model
- route / boot / live correctness achieved across all in-scope route families
- no critical in-scope domain remains on snapshot-save
- no in-scope business-critical flow depends on realtime
- business-rules preserved for all in-scope domains

И отдельно должно быть верно:

- `receipts` не является частью current migration completion criteria
- `receipts` не должен изменяться в рамках выполнения этого плана

---

## Definition Of Failure

Миграция считается незавершенной, если остается хотя бы одно из состояний ниже:

- хотя бы один in-scope критичный write-flow все еще использует aggregated snapshot-save
- хотя бы один in-scope домен не имеет явного server domain API
- хотя бы один in-scope конкурентный сценарий не имеет revision / conflict model
- хотя бы один in-scope route family управляется вне общей route model
- хотя бы один in-scope бизнес-критичный экран зависит от realtime для correctness
- хотя бы один in-scope derived view не совместим с новой source-domain model
- хотя бы один in-scope live legacy overlap оставлен без финального удаления

---

## Assumptions

- "Полный план" после этой правки означает полный план для всего текущего
  migration perimeter, где `receipts` сознательно выведен в frozen out-of-scope carve-out.
- `receipts` не блокирует завершение основной миграции и не должен использоваться
  как оправдание сохранения legacy-модели в других доменах.
- Никакие `docs/business-rules/*.md`, кроме возможной future отдельной программы
  по `receipts`, не меняют свою семантику.
