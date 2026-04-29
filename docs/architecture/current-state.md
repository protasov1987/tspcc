# Current State

Этот документ фиксирует актуальное состояние сайта после завершения
`docs/architecture/migration-plan.md`.

Текущее состояние архитектуры должно соответствовать
[Current Architecture](./current-architecture.md). Если код, тесты или
последующий аудит обнаруживают расхождение с этим документом, такое расхождение
считается bug/regression или документационным drift, а не допустимым
промежуточным legacy-состоянием.

---

## Status

- Migration plan выполнен для всего in-scope perimeter.
- `docs/architecture/current-architecture.md` является обязательным
  архитектурным контрактом.
- `docs/architecture/migration-plan.md` является завершенной исторической
  записью перехода и источником exit criteria.
- `docs/architecture/target-architecture.md` оставлен только как compatibility
  entry point для старых ссылок.
- `docs/architecture/mysql-84-target-architecture.md` остается отдельной
  будущей target architecture для persistence-слоя MySQL 8.4 и не означает,
  что SQL cutover уже выполнен.
- `docs/architecture/mysql-84-migration-plan.md` является активным планом
  будущего перехода persistence-слоя на MySQL 8.4.
- `docs/business-rules/*.md` остаются обязательными guardrail для бизнес-логики.

---

## 1. High-Level Summary

- Сайт является SPA с одним центральным routing/bootstrap pipeline.
- URL является источником истины для активного экрана:
  `window.location.pathname + window.location.search`.
- Protected route rendering выполняется только после session restore/checkAuth.
- Browser history работает через `popstate -> handleRoute(fullPath,
  { fromHistory: true, ... })`.
- Критичные пользовательские write-flow выполняются через серверные domain
  commands, а не через общий snapshot-save.
- Конкурентные write-flow используют domain revision model:
  `expectedRev`, `expectedFlowVersion`, `expectedPlanningRev` или другой
  доменный equivalent.
- Stale write должен возвращать `409 Conflict` и сохранять текущий маршрут
  пользователя.
- Realtime является вспомогательным каналом refresh/signal и не является
  источником корректности.
- Диагностика boot/route/data/live/conflict должна сохранять устойчивые
  префиксы: `[BOOT]`, `[ROUTE]`, `[DATA]`, `[LIVE]`, `[CONFLICT]`.

---

## 2. Architecture Shape

### Client

- Клиент организован как SPA поверх центрального route/page controller.
- Навигационный слой должен оставаться идемпотентным.
- UI может использовать локальное состояние и optimistic UX только как
  временный визуальный слой; server truth не должен подменяться локальным
  snapshot или pending-state.
- Route-local refresh является preferred pattern после доменных изменений и
  conflict handling.

### Server

- Сервер является единственным write-owner для сохраняемых бизнес-данных.
- Все критичные изменения проходят через server domain API.
- Сервер выполняет:
  - auth/session checks;
  - permission checks;
  - input validation;
  - revision/conflict checks;
  - audit/log side effects, где они являются частью бизнес-команды.
- Domain command должен возвращать точный результат операции или контролируемую
  ошибку, включая `409 Conflict` для stale state.

### Persistence

- Текущий persistence-слой не приравнивается к MySQL 8.4 target state, пока
  SQL cutover не выполнен отдельной migration program.
- Независимо от storage engine, authoritative writes должны оставаться
  domain-based и server-confirmed.
- Общий snapshot не является допустимым primary write-path для critical
  in-scope доменов.
- Если в коде существует legacy snapshot/export/read compatibility, она не
  должна становиться write-authority и не должна расширяться для новых задач.

---

## 3. Routing and Bootstrap

Актуальная модель:

- один bootstrap pipeline;
- session-first initialization;
- один центральный `handleRoute(...)`;
- URL-first route activation после восстановления сессии;
- no forced redirect to dashboard on boot;
- protected pages do not render before session restore;
- centralized page visibility control;
- idempotent navigation/setup functions;
- route diagnostics через `[ROUTE]`;
- boot diagnostics через `[BOOT]`.

Критичные route families:

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

Любое добавление страницы без регистрации в центральном маршрутизаторе является
архитектурной ошибкой.

---

## 4. Data Loading and Write Model

Актуальная модель:

- critical writes являются доменными и точечными;
- каждый critical write проходит через server domain command;
- клиент отправляет expected revision/version для конкурентных сценариев;
- сервер сравнивает expected value с actual state;
- conflict возвращается как `409 Conflict`;
- клиент остается на текущем маршруте и выполняет targeted refresh;
- realtime может ускорять refresh, но не подтверждает correctness.

Запрещенное состояние:

- новый critical write через `saveData()` или общий `/api/data`;
- silent overwrite чужих изменений;
- full app reload вместо route-safe conflict recovery как основной сценарий;
- зависимость business correctness от SSE/live-соединения;
- расширение legacy snapshot как нового integration surface.

---

## 5. Auth, Session, Permissions

Актуальная модель:

- session restore/checkAuth выполняется до protected render;
- login/logout и session state подтверждаются сервером;
- мутирующие запросы защищаются auth/permission checks;
- access level определяет tab access, special roles, `landingTab` и
  `inactivityTimeoutMinutes`;
- `landingTab` влияет на домашний маршрут только после восстановления сессии;
- `/profile/:id` соблюдает ownership/privacy rules;
- `Abyss` сохраняет special protection и не может быть деградирован
  случайными UI/server изменениями;
- password validation, uniqueness и hash semantics не должны ослабляться.

---

## 6. Cards, Approvals and Card Files

Актуальная модель:

- карточка является доменной сущностью с `id` и `rev`;
- create/update/delete/archive/repeat/list/detail выполняются через card
  domain API;
- обычное редактирование карточки использует `expectedRev -> 409`;
- conflict не выбрасывает пользователя с card route;
- card refresh выполняется точечно;
- approval/input/provision transitions являются явными server commands;
- reject требует reason;
- audit/log side effects сохраняются как часть lifecycle;
- card files upload/delete/resync выполняются через file domain API;
- file operations используют revision-safe contract и возвращают новый
  `cardRev` или совместимый доменный результат;
- duplicate `PARTS_DOCS` rule и input-control linkage должны сохраняться.
- delete карточки выполняет server-side cascade cleanup: удаляет саму карточку,
  связанные production tasks, storage folder по `qrId`, close-page rows/facts,
  shift snapshot task references, shift logs, user actions и chat/system
  messages только при устойчивой ссылке на удаляемую карточку или ее attachment.

Ключевой lifecycle:

- `DRAFT`
- `ON_APPROVAL`
- `REJECTED`
- `APPROVED`
- `WAITING_INPUT_CONTROL`
- `WAITING_PROVISION`
- `PROVIDED`
- `PLANNING`
- `PLANNED`

Repeat из архива создает новую draft-card, а не восстанавливает старую
архивную карточку.

---

## 7. Directories and Security

Актуальная модель:

- departments/centers, operations, areas, employees assignment и shift times
  редактируются через directory domain API;
- users и access levels редактируются через security domain API;
- сервер проверяет права, бизнес-инварианты и revision/conflict contract там,
  где сущность конкурентно изменяется;
- historical text preservation сохраняется при удалении или изменении
  справочников;
- production dependencies on areas/shift times защищены business guards.

Обязательные guards:

- нельзя удалить подразделение, если к нему привязаны сотрудники;
- нельзя удалить подразделение/операцию, если это ломает исторические или
  рабочие связи карточек;
- нельзя менять operation type, если это нарушает активные production flows;
- нельзя удалить area, если это ломает текущее planning/execution состояние;
- `Abyss`, password validation, permissions, `landingTab` и
  `inactivityTimeoutMinutes` должны сохранять текущую семантику.

---

## 8. Production, Workspace and Derived Views

Актуальная модель:

- production planning и execution являются отдельным server domain layer;
- planning-side использует собственную revision/conflict model, независимую от
  unrelated global snapshot changes;
- execution-side использует `expectedFlowVersion` или совместимый equivalent;
- stale production/workspace command возвращает `409`;
- after-conflict behavior: stay on route, clear message, targeted production
  refresh;
- correctness не строится на heavy local shadow state или realtime;
- workspace actions являются explicit server commands.

Derived views:

- `/workorders`
- `/workorders/:qr`
- `/archive`
- `/archive/:qr`
- `/items`
- `/ok`
- `/oc`

Эти экраны являются read-model/view layer поверх cards/production source
domains. Они не должны получать собственный bypass write-path.

---

## 9. Messaging, Profile and Notifications

Актуальная модель:

- `/api/chat/*` является primary messaging stack;
- параллельный равноправный `/api/messages/*` stack не допускается;
- profile privacy сохраняется;
- direct chat, delivered/read/unread, user actions, webpush/FCM и deeplinks
  должны работать через единый messaging/profile/notifications contract;
- `openChatWith` / `conversationId` deeplink behavior должен сохраняться;
- realtime chat signal не заменяет server truth.

---

## 10. Realtime

Актуальная модель:

- realtime only signals refresh;
- bootstrap never depends on live;
- business-critical correctness works without live connection;
- live events должны вести к targeted refresh или контролируемому fallback;
- `[LIVE]` diagnostics должны позволять понять источник события, домен и
  fallback behavior.

Любая новая логика, где пользовательский success зависит только от live event,
является архитектурной регрессией.

---

## 11. Diagnostics

Минимальные обязательные диагностические префиксы:

- `[BOOT]`
- `[ROUTE]`
- `[LIVE]`
- `[DATA]`
- `[CONFLICT]`

При изменении bootstrap/routing/domain writes/realtime нельзя обеднять
диагностику. Логи должны позволять понять:

- где остановился boot;
- какой route активируется;
- какой домен дал conflict;
- какой targeted refresh или fallback выполнен;
- было ли live-событие вспомогательным сигналом, а не источником correctness.

---

## 12. Testing Expectations

Критичные проверки для последующих изменений:

- direct URL и `F5` на protected routes;
- Back / Forward без редиректа на dashboard;
- protected render только после session restore;
- success-path и conflict-path для измененного domain write;
- route stability после `409`;
- targeted refresh после conflict;
- business rules по затронутому домену;
- realtime unavailable fallback для live-sensitive зон;
- no new snapshot-save critical write path.

Если задача меняет bootstrap order, должен обновляться
`docs/architecture/spa-boot.md`.

---

## 13. Residual Compatibility Policy

После завершения migration-plan любые остаточные compatibility adapters
трактуются так:

- они не являются primary architecture;
- они не могут использоваться для новых critical writes;
- их нельзя расширять как удобный обход domain API;
- bugfix внутри adapter допустим только если он не возвращает adapter роль
  source of truth;
- preferred direction: removal, read-only compatibility, explicit export или
  замена на domain read/write model.

Если будущий аудит находит application caller, который делает critical write
через legacy snapshot path, это считается regression.

---

## 14. Practical Implication for Future Changes

Для любой новой задачи использовать вместе:

- `docs/architecture/current-architecture.md`
- `docs/architecture/current-state.md`
- `docs/architecture/change-checklist.md`
- `docs/business-rules/*.md`

`docs/architecture/migration-plan.md` использовать только как историческую
запись и источник exit criteria. Он больше не разрешает временное расширение
legacy-паттернов.

`docs/architecture/mysql-84-target-architecture.md` и
`docs/architecture/mysql-84-migration-plan.md` использовать только для задач,
связанных с будущим переходом persistence-слоя на MySQL 8.4.
