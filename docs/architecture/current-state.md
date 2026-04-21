# Current State

Этот документ фиксирует текущее фактическое состояние сайта по результатам
аудита кода, Playwright E2E, фикстур и существующей документации.

Это не target state. Это описание того, что уже есть в репозитории сейчас,
включая сильные стороны, legacy-участки и переходные ограничения.

---

## Status

- Источники аудита:
  - клиентские модули `js/app.*`
  - `server.js`, `db.js`, `server/authStore.js`
  - E2E-тесты `tests/e2e/*`
  - архитектурные документы в `docs/architecture/*`
  - baseline-фикстура `tests/e2e/fixtures/baseline-core.database.json`
- Документ описывает текущее рабочее поведение системы.
- Если код и этот документ расходятся, источником истины для аудита считается код.
- Любая миграция к target architecture должна сохранять перечисленные здесь
  рабочие бизнес-инварианты, пока не принято отдельное продуктовое решение.

---

## 1. High-Level Summary

- Сайт уже является SPA с одним центральным маршрутизатором и одним основным
  bootstrap pipeline.
- URL в целом уже работает как источник истины для экрана:
  прямой заход, `F5` и `history` покрыты E2E и поддерживаются кодом.
- Bootstrap уже построен по модели `session restore -> route-critical data -> render`.
- Клиентская модель данных пока гибридная:
  - чтение уже частично разбито на scope;
  - запись частично вынесена в доменные endpoint'ы;
  - значительная часть бизнес-операций все еще живет через общий snapshot-save
    `POST /api/data`.
- Карточки уже имеют `card.rev`, а production/workspace уже используют
  `flow.version` и серверные `409`, но единая ревизионная модель для всех
  критичных сущностей еще не внедрена.
- При этом в коде уже появился shared foundation для будущих `rev/expectedRev`:
  нормализация ревизий, сравнение expected/actual и совместимое формирование
  conflict payload через общий helper-слой.
- Shared Stage 2 foundation уже живет в production/workspace как reference path:
  серверный conflict envelope, клиентский route-safe write helper и общие
  `[DATA]` / `[CONFLICT]` diagnostics используются в реальных write-сценариях
  без начала массовой доменной миграции Stage 3+.
- Realtime уже работает как дополнительный канал обновления, но архитектура
  еще содержит смешение новых и legacy-механизмов refresh.
- Тестовое покрытие сильнее всего в зонах:
  - auth / routing / bootstrap
  - deep routes
  - realtime / concurrency для workspace
- Самая зрелая серверная доменная модель сейчас в production/workspace.
- Самая крупная незавершенная миграция сейчас в:
  - approvals / input control / provision
  - card files revision contract
  - directories
  - части планирования и вспомогательных production UI

---

## 2. Current Architecture Shape

### Client

- Основной глобальный SPA-стек сосредоточен в `js/app.00.state.js`,
  `js/app.50.auth.js`, `js/app.81.navigation.js`, `js/app.99.init.js`.
- Главные экраны и бизнес-модули разнесены по крупным файлам:
  - `js/app.70.render.cards.js`
  - `js/app.71.cardRoute.modal.js`
  - `js/app.72.directories*.js`
  - `js/app.73.receipts.js`
  - `js/app.74.approvals.js`
  - `js/app.75.production.js`
  - `js/app.90.usersAccess.js`
  - `js/app.95.messenger.js`
  - `js/app.96.webpush.js`
- Клиент до сих пор хранит крупные глобальные массивы данных:
  `cards`, `ops`, `centers`, `areas`, `users`, `accessLevels`,
  `productionSchedule`, `productionShiftTimes`, `productionShiftTasks`,
  `productionShifts`.
- UI по-прежнему во многом построен как большой набор глобальных функций с
  shared mutable state.

### Server

- Серверная логика в основном сосредоточена в одном крупном `server.js`.
- Хранилище представляет собой файловую БД с нормализацией через `db.js`.
- Сессии и аутентификация вынесены в `server/authStore.js`, но приложение в
  целом остается монолитом без строгого разделения на доменные серверные слои.
- Сервер уже содержит:
  - auth/session model
  - security/users/access levels API
  - cards files API
  - production/workspace domain endpoints
  - SSE/live streams
  - chat/push API

### Persistence

- База хранится как JSON с нормализацией и автозаполнением дефолтов.
- Есть глобальный `meta.revision`.
- Для карточек уже поддерживается `card.rev`.
- Для production flow поддерживается `card.flow.version`.
- В baseline-фикстуре обнаружена схема-аномалия:
  дублируются ключи `approvalSKKStatus` и `approvalSkkStatus`.
  Это технический риск для сериализации, миграций и анализа данных.

---

## 3. Routing and Bootstrap

### What already works

- В системе есть один центральный route handler: `handleRoute(...)`.
- Список базовых маршрутов объявлен централизованно.
- Deep routes поддерживаются централизованно тем же route handler.
- `window.popstate` уже привязан к
  `handleRoute(fullPath, { fromHistory: true, replace: true })`.
- Bootstrap guarded:
  `js/app.99.init.js` использует `appBootstrapStarted`.
- Навигационный слой уже имеет idempotent guards:
  `navigationSetupDone`, `cardsDropdownSetupDone`, `cardsTabsSetupDone`.
- Bootstrap уже строится по модели:
  1. восстановление сессии
  2. loader / overlay
  3. route-critical loading
  4. одноразовый setup UI
  5. render
  6. route activation
  7. background hydration
- В коде уже есть выраженная boot/route диагностика:
  `[BOOT]`, `[ROUTE]`, `[DATA]`, `[PERF]`.

### Current route map

- Базовые page routes:
  - `/cards`
  - `/dashboard`
  - `/approvals`
  - `/provision`
  - `/input-control`
  - `/departments`
  - `/operations`
  - `/areas`
  - `/employees`
  - `/shift-times`
  - `/production/schedule`
  - `/production/shifts`
  - `/production/delayed`
  - `/production/defects`
  - `/production/plan`
  - `/workorders`
  - `/items`
  - `/ok`
  - `/oc`
  - `/archive`
  - `/receipts`
  - `/workspace`
  - `/users`
  - `/accessLevels`
  - `/cards/new`
- Deep routes:
  - `/cards/:id`
  - `/card-route/:qr`
  - `/profile/:id`
  - `/workorders/:qr`
  - `/workspace/:qr`
  - `/archive/:qr`
  - `/production/shifts/:key`
  - `/production/delayed/:qr`
  - `/production/defects/:qr`
  - `/production/gantt/:...`

### Current limitations and risks

- `initNavigation()` кроме guarded setup-функций дополнительно вешает
  некоторые close/back handlers без отдельного глобального guard.
  Это не сломано в текущем состоянии, но является точкой риска при future refactor.
- Bootstrap уже лучше legacy-состояния, но все еще включает много UI setup и
  косвенных доменных зависимостей.
- Background hydration существует и не является источником истины, но добавляет
  сложность reasoning о моменте окончательной готовности данных.

---

## 4. Data Loading and Write Model

### Current read model

- На клиенте уже есть scope-based loading:
  - `full`
  - `cards-basic`
  - `directories`
  - `production`
- `ensureRouteCriticalData()` выбирает scope по текущему маршруту.
- Security data подгружается отдельно через `loadSecurityData()`.
- Это уже уменьшает объем первичной загрузки и приближает архитектуру к
  route-local refresh.

### Current write model

- В проекте одновременно живут две модели записи.

#### Legacy snapshot-save

- `saveData()` в `js/app.40.store.js` по-прежнему отправляет крупный клиентский
  snapshot в `/api/data`.
- `/api/data` теперь явно обозначен в коде как legacy snapshot boundary для
  совместимости с еще не мигрированными доменами, а не как целевая норма для
  новых critical writes.
- В snapshot входят сразу несколько доменов:
  `cards`, `ops`, `centers`, `areas`, `users`, `accessLevels`,
  `productionSchedule`, `productionShiftTimes`, `productionShiftTasks`,
  `productionShifts`.
- Многие client-side бизнес-действия все еще делают:
  1. локальную мутацию массивов
  2. `saveData()`

#### Domain endpoints

- Уже вынесены отдельные endpoint'ы для:
  - users
  - access levels
  - card files
  - production/workspace flow actions
  - push/chat/profile-related actions
- Mature production/workspace flows уже используют общий client/server
  write/conflict foundation:
  - shared server conflict helpers
  - shared client write execution helper
  - route-safe targeted refresh / fallback refresh pattern
  - legacy-compatible conflict payload with `error` and `flowVersion`

### Current conclusion

- Проект находится в гибридной стадии миграции.
- Snapshot-save уже не является единственной моделью записи, но все еще
  остается основной для заметной части доменов.
- Это означает, что система уже не чисто legacy, но еще не пришла к target
  architecture.

---

## 5. Auth, Session, Permissions

### Current state

- Сессия восстанавливается через `/api/session`.
- Login/logout и session restore серверно подтверждаются.
- Для мутирующих запросов используется CSRF-токен с серверной проверкой.
- У access level есть полноценный набор прав, включая:
  - tab access view/edit
  - специальные роли
  - `landingTab`
  - `inactivityTimeoutMinutes`
- Сервер поддерживает inactivity timeout по access level.
- Для Android-клиента есть особое поведение по inactivity timeout.
- Главный системный пользователь `Abyss` гарантированно существует.
- Пароли на сервере хранятся как PBKDF2 hash + salt, но legacy-совместимость с
  более старым форматом еще присутствует.

### Important current behaviors

- Канонический домашний маршрут определяется не константой в UI, а
  `currentUser.permissions.landingTab`.
- Профильный маршрут `/profile/:id` приватен:
  пользователь может открыть только собственный профиль.
- Access levels влияют и на навигацию, и на допустимые действия в доменах.

### Risks

- В клиенте есть локальный password cache для части сценариев профиля / печати.
  Это текущее поведение, которое нужно учитывать при любых security-изменениях.

---

## 6. Cards Domain

### Current shape

- Карточки являются центральной доменной сущностью сайта.
- Карточка уже имеет `id` и `rev`.
- Основная UI-логика карточек сосредоточена в `js/app.70.render.cards.js`.
- Карточка хранит:
  - базовые реквизиты
  - quantities / serials
  - операции
  - approval state
  - attachments
  - logs / snapshots
  - production flow
  - supply / input control markers
  - archive marker

### Current lifecycle

- Новая карточка создается как `DRAFT`.
- Отправка на согласование переводит карточку в `ON_APPROVAL`.
- Отклонение переводит карточку в `REJECTED` и требует причину.
- После полного согласования карточка становится `APPROVED`.
- Далее возможны стадии:
  - `WAITING_INPUT_CONTROL`
  - `WAITING_PROVISION`
  - `PROVIDED`
  - `PLANNING`
  - `PLANNED`
- Повтор из архива создает новый draft-copy, а не восстанавливает старую карту.
- Архивирование сейчас soft:
  `card.archived = true`.
- Удаление карточки сейчас hard:
  карточка удаляется из `cards`, а связанные `productionShiftTasks` чистятся.

### Current write model

- Stage 3 `cards core` фактически закрыт:
  - create
  - update
  - delete
  - archive
  - repeat
  - detail fetch
  - list / query
  - route-local refresh
- Основной generic create/edit draft flow уже переведен на `cards-core` API.
- Archive / repeat / delete user-visible flows тоже переведены на
  `cards-core` API с обязательным `expectedRev -> 409`.
- Для обычного редактирования карточки клиент использует
  `expectedRev -> 409 Conflict` и route-safe targeted refresh текущей карточки.
- Approvals, input control, provision и card files по-прежнему являются
  отдельными следующими этапами миграции и не входят в закрытый Stage 3 cards core.

### Current file model

- Для файлов карточки уже есть отдельные endpoint'ы.
- Хранение идет в `storage/cards/<normalizedQr>/<folder>/...`.
- Upload/delete/resync уже вынесены из общего snapshot-save.
- После file-операций сервер меняет карточку и ее attachments.
- Явный контракт `expectedRev -> 409 Conflict` для card files пока не является
  общим правилом домена.

---

## 7. Approvals, Provision, Input Control

### Current approval roles

- В текущей модели есть три основные согласующие роли:
  - начальник производства
  - начальник СКК
  - заместитель технического директора
- Администратор `Abyss` может выполнять эти действия как override-role.

### Current behaviors

- Approval UI и transitions сосредоточены в `js/app.74.approvals.js`.
- Reject всегда требует причину.
- Любое движение по approval stage пишет card log.
- Rejected card может быть возвращена в `DRAFT` через отдельный сценарий с
  пользовательским комментарием.
- Входной контроль и обеспечение доступны только после стадии `APPROVED` и
  производных waiting-stage.
- Если выполнены и входной контроль, и обеспечение, стадия становится `PROVIDED`.
- Если выполнено только одно из двух, карточка остается в соответствующей
  waiting-stage.

### Current limitation

- Первый executable batch Stage 4 уже перевел server-side approval lifecycle
  commands на отдельный command path:
  - send to approval
  - approve
  - reject
  - return rejected to draft
- Эти команды уже используют `card.rev` + `expectedRev -> 409` и возвращают
  точечный card payload без full snapshot.
- Но input control и provision по-прежнему остаются следующими частями Stage 4
  и еще не доведены до полной отдельной command model.

---

## 8. Directories Domain

### Scope

- Участки / подразделения
- Операции
- Производственные зоны / areas
- Сотрудники и их привязка
- Времена смен

### Current state

- Основная UI-логика сосредоточена в `js/app.72.directories.pages.js`.
- Значительная часть write-операций здесь все еще идет через `saveData()`.

### Current business protections already implemented

- Подразделение нельзя удалить, если к нему привязаны сотрудники.
- При удалении подразделения или операции старые карточки не должны терять
  текстовое историческое значение поля.
- Тип операции нельзя менять, если существуют запланированные МК с этой
  операцией в статусе выше `NOT_STARTED`.
- Для areas уже есть логика расчета загрузки и отображения load metrics.

### Current conclusion

- Directories уже имеют заметную бизнес-логику и ограничения, но по модели
  записи все еще во многом legacy.

---

## 9. Security Domain

### Current state

- Users и access levels уже редактируются через отдельные серверные endpoint'ы.
- Сервер санитизирует user payload и не отдает парольные поля в ответах.
- На сервере валидируются:
  - формат пароля
  - уникальность пароля
  - доступность операции по правам
- `Abyss` нельзя безопасно удалить как на UI-слое, так и на сервере.

### Current permissions model

- Access level описывает:
  - tab-level view/edit
  - специальные роли production / approval
  - landing tab
  - inactivity timeout
- В UI права редактируются через matrix-like форму.
- Семантика уже нормализуется так, что edit по смыслу включает view.

### Current maturity

- Security domain архитектурно зрелее directories, но уже не опережает
  закрытый `cards core` так радикально, как в раннем гибридном состоянии.
- Но он все еще тесно связан с текущей моделью большого SPA и общими global state.

---

## 10. Production, Planning and Workspace

### Current architecture level

- Это самый развитый domain API в проекте.
- Основная логика сосредоточена в `js/app.75.production.js`,
  `js/app.73.receipts.js` и значительном числе серверных `/api/production/*`
  endpoint'ов.

### Current business model

- В production участвуют:
  - production schedule
  - production shifts
  - production plan
  - workspace
  - delayed queue
  - defects queue
  - personal operations
  - material issue / return / drying
  - repair / dispose flows

### Current visibility rules

- На production planning попадают неархивные MKI-карты с планируемыми
  операциями и нужной approval stage.
- Для очереди планирования допустимы стадии `PROVIDED` и `PLANNING`.
- Для очереди уже запланированных карточек допустима стадия `PLANNED`.
- В workspace попадают только карты:
  - не архивные
  - типа `MKI`
  - с операциями
  - в стадии `PLANNING` или `PLANNED`
  - с операцией, реально запланированной на текущую открытую смену

### Current conflict model

- Production/workspace используют `card.flow.version`.
- Клиент отправляет `expectedFlowVersion`.
- Сервер сравнивает версию и возвращает `409`, если flow устарел.
- После conflict клиент делает targeted refresh production/workspace scope.
- Это уже рабочая серверная conflict-control модель, но она локальна для
  production flow, а не для всех доменов сайта.

### Current strengths

- Production actions уже выражены как отдельные серверные команды.
- Сервер валидирует допустимость операций по текущему flow и статусам.
- В коде много явных 409-состояний с понятными бизнес-причинами.
- Workspace realtime и concurrency дополнительно покрыты E2E.

### Current limitations

- Не весь production UI уже переведен на единый domain API.
- Часть планирования и справочников вокруг production все еще опирается на
  глобальные массивы и snapshot-save.
- Production остается сильнее связанным с общими клиентскими структурами,
  чем требует target architecture.

---

## 11. Workorders, Archive, Items, OK, OC

### Current shape

- Эти представления в основном сосредоточены в `js/app.73.receipts.js`.
- Это не отдельная база сущностей, а пользовательские представления,
  построенные поверх карточек, операций, flow и архивного статуса.

### Current behaviors

- Workorders показывают активные производственные MKI-карты, пригодные для
  работы или уже находящиеся в процессе.
- Archive показывает архивные производственные карты.
- Repeat из архива создает новую карточку-черновик.
- Pages `Items`, `OK`, `OC` являются аналитическими / операционными витринами,
  собранными из состояния карточек и flow.

### Current constraint

- Логика этих страниц сильно связана с текущими card/production структурами,
  поэтому любые рефакторинги в cards или flow легко создают скрытые регрессии в
  их отображении.

---

## 12. Receipts

### Current shape

- В системе существует отдельный маршрут `/receipts` и detail route
  `/receipts/:id`.
- Для него выделено отдельное permission `receipts`.
- Основная list-логика находится в `js/app.73.receipts-list.js`.
- Detail route открывается как modal-context через `showModalReceipt(...)`.

### Current maturity

- Домен выглядит изолированным и заметно менее зрелым, чем cards или production.
- Текущая реализация опирается на `store.receipts`.
- В рамках этого аудита receipts не проявляется как развитый write-domain с
  заметной серверной бизнес-логикой.
- Это нужно считать low-maturity / likely-legacy screen, а не доказательством
  отсутствия бизнес-значимости.

### Practical implication

- Даже если receipts кажется небольшим экраном, его нельзя случайно удалить,
  сломать по маршруту или лишить permission semantics при рефакторинге
  навигации и store.

---

## 13. Messaging, Profile and Notifications

### Current state

- У пользователя есть персональный профиль `/profile/:id`.
- Профиль включает:
  - messenger
  - user actions log
  - webpush controls
- Основной современный чат работает через `/api/chat/*`.
- Дополнительно в сервере еще существует legacy-слой `/api/messages/*`.
- Для live chat используются SSE-стримы.
- Поддерживаются delivered/read/unread состояния.
- Есть WebPush и FCM-подписки.

### Current conclusion

- Messaging уже не является примитивным уведомлением, а представляет собой
  самостоятельный домен.
- При этом в коде еще одновременно существуют новый и legacy chat/message API.
  Это нужно считать осознанным transitional overlap и не усиливать новым кодом.

---

## 14. Realtime

### Current state

- В проекте уже есть несколько live streams:
  - общий app stream
  - cards live summary
  - chat stream
  - messages stream
- Сервер рассылает структурированные события по карточкам, справочникам,
  пользователям и access levels.
- Для production/workspace используются structured refresh/fallback механизмы.

### Current maturity

- Realtime уже не выглядит как единственный механизм корректности.
- Система в основном способна пережить временное отсутствие live-канала.
- Но часть клиентского кода по-прежнему содержит сложные fallback refresh paths,
  что увеличивает связанность между live и store logic.

---

## 15. Diagnostics

### What already exists

- В проекте уже используются устойчивые префиксы:
  - `[BOOT]`
  - `[ROUTE]`
  - `[DATA]`
  - `[PERF]`
  - частично live / auth / chat префиксы
- Диагностика уже достаточна, чтобы локализовать:
  - boot зависания
  - route problems
  - scope load issues
  - часть live и auth проблем

### What is still missing

- Shared diagnostics foundation уже существует для mature production/workspace
  write-path, но единый conflict contract еще не доведен до всех доменов:
  shared revision foundation уже есть, однако большая часть snapshot-based
  доменов вне закрытого `cards core` пока не переведена на обязательный
  `expectedRev -> 409`.
- Диагностика production и messaging уже сильная, но в разных стилях.

---

## 16. Testing

### What is covered well

- `tests/e2e/00.auth-routes.spec.js`:
  - login
  - direct URL entry
  - `F5`
  - browser history
  - deep routes
- `tests/e2e/01.pages-and-modals-smoke.spec.js`:
  - smoke по основным страницам и модалкам
- `tests/e2e/02.workspace-realtime.spec.js`:
  - realtime propagation
  - concurrency
  - multi-client workspace behavior
  - conflict-path with route stability and shared `[DATA]` / `[CONFLICT]`
    diagnostics on the mature path

### What this means

- Routing/bootstrap regressions уже контролируются заметно лучше, чем раньше.
- Workspace live consistency и shared Stage 2 conflict foundation уже
  тестируются как реальный конкурентный сценарий.
- Cards core теперь имеют dedicated E2E не только на create/update/conflict,
  но и на archive / repeat / delete.
- Но новый доменный write-механизм еще не покрыт везде одинаково:
  approvals, files и directories все еще не доведены до такой же зрелости.

---

## 17. Current Technical Debt and Migration Risks

- Гибридная write-модель:
  snapshot-save и domain API живут одновременно.
- Generic cards edit flow now has mandatory `expectedRev -> 409` contract,
  but the wider cards domain is still partially hybrid outside ordinary draft
  create/update.
- Card files уже вынесены в endpoint'ы, но еще не доведены до полной
  revision-safe модели карточки.
- Directories по-прежнему largely snapshot-based.
- Огромные монолитные файлы:
  - `server.js`
  - `js/app.00.state.js`
  - `js/app.73.receipts.js`
  - `js/app.75.production.js`
- Есть overlap нового chat API и legacy messages API.
- Есть локальный password cache, который может стать security-регрессией при
  неосторожных изменениях.
- В baseline-фикстуре есть duplicate-key anomaly.
- `receipts` выглядит как изолированный и мало покрытый low-maturity route.
- Production уже достаточно сложен, чтобы любые изменения в flow, plan и
  delayed/defect действиях считались high-risk.

---

## 18. Current Maturity by Domain

- Routing / bootstrap:
  зрелый переходный слой, уже близко к target behavior.
- Security users / access levels:
  доменный API уже есть, бизнес-правила явно выражены.
- Cards generic CRUD:
  Stage 3 закрыт: отдельный `cards-core` API, `card.rev`, `expectedRev -> 409`,
  targeted refresh и dedicated E2E уже работают.
- Card approvals:
  send/approve/reject/return-to-draft уже вынесены на отдельные server commands
  с `expectedRev -> 409`, но полный Stage 4 еще не завершен из-за input control
  и provision.
- Card files:
  вынесены в endpoint'ы, но ревизионная модель еще неполная.
- Directories:
  богатая бизнес-логика при legacy write model.
- Production / workspace:
  наиболее развитый доменный слой, уже с версионным conflict control.
- Messaging / notifications:
  рабочий отдельный домен с overlap legacy/new APIs.
- Receipts:
  отдельный маршрут с признаками low-maturity legacy area.

---

## 19. Practical Implication for Future Changes

- Нельзя считать проект ни полностью legacy, ни уже достигшим target architecture.
- Любая безопасная задача в этом коде должна держать две рамки одновременно:
  - не ломать текущую бизнес-логику
  - не усиливать legacy-подход там, где уже есть более зрелая доменная модель
- Для практической работы вместе с этим документом нужно использовать:
  - `docs/architecture/target-architecture.md`
  - `docs/architecture/migration-plan.md`
  - `docs/architecture/change-checklist.md`
  - `docs/business-rules/*.md`
