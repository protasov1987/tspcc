# MySQL 8.4 Target Architecture

Этот документ фиксирует целевое архитектурное состояние persistence-слоя
после перехода сайта на MySQL 8.4.

Это не утверждение о том, что текущая реализация уже соответствует этой модели.
Текущая файловая JSON-БД и legacy snapshot compatibility могут существовать
только как временный migration boundary.

Цель перехода на MySQL не в механической замене файла `database.json` на одну
таблицу с JSON, а в переходе на правильную промышленную модель хранения,
записи, редактирования, аудита и конкурентного доступа к данным.

Бизнес-логика работы сайта должна быть полностью сохранена.

---

## Status

- Документ фиксирует target state для MySQL 8.4.
- Этот документ дополняет, но не заменяет
  [Target Architecture](./target-architecture.md).
- Все правила `routing`, `bootstrap`, `domain writes`, `revision model`,
  `realtime`, `security` и `testing` из `target-architecture.md` остаются
  обязательными.
- Если текущая реализация еще использует файловый snapshot или scoped snapshot
  reads, новые изменения не должны расширять этот legacy-подход.
- Любой промежуточный шаг должен приближать проект к доменной SQL-модели, а не
  закреплять хранение всего сайта как одного большого JSON-документа.

---

## Migration Rules

### MUST

- Переход на MySQL должен выполняться маленькими шагами по доменам.
- Один шаг должен переносить один логический storage-slice или один домен.
- Поведение пользовательских сценариев должно оставаться совместимым с текущими
  business-rules документами.
- Серверные domain endpoint'ы должны остаться единственным местом, где
  принимается решение о записи.
- Любая write-операция должна быть атомарной на уровне БД.
- Любая конкурентно редактируемая сущность должна иметь `rev`.
- Любое изменение persistence-слоя должно сохранять или расширять диагностику:
  `[DB]`, `[DATA]`, `[CONFLICT]`, `[BOOT]`, `[ROUTE]`.
- После переноса домена на SQL для него должен быть определен removal path для
  JSON/snapshot compatibility.
- После SQL cutover конкретного домена legacy JSON/snapshot слой для этого
  домена может быть только read-only compatibility/export layer.
- Для каждого домена removal path должен явно описывать:
  - какие legacy JSON/snapshot поля удаляются;
  - когда они удаляются;
  - какие проверки должны пройти перед удалением;
  - кто является owner'ом удаления;
  - какой fallback допустим до удаления.

### MUST NOT

- Нельзя заменить `database.json` одной таблицей `app_data(json)` как финальной
  моделью.
- Нельзя переносить клиентский snapshot-save в MySQL как новый основной write
  path.
- Нельзя обходить domain endpoint'ы прямыми SQL-записями из UI или
  неавторизованных helper'ов.
- Нельзя менять бизнес-семантику карточек, согласования, производства,
  справочников, пользователей, сообщений или маршрутов под удобство схемы БД.
- Нельзя оставлять после cutover два write-authority для одного домена:
  MySQL и JSON/snapshot.
- Нельзя совмещать в одном изменении:
  - перенос storage engine;
  - переписывание router/bootstrap;
  - массовый rewrite API;
  - redesign бизнес-процессов.

---

## 1. Core Model

### MUST

- MySQL 8.4 должен быть источником истины для сохраняемых данных.
- Сервер остается единственным write-owner'ом БД.
- Клиент не получает прямого доступа к SQL.
- Все записи идут через server domain commands.
- SQL-схема должна отражать домены сайта, а не форму текущего клиентского
  глобального state.
- Данные должны храниться так, чтобы можно было:
  - валидировать связи через foreign keys;
  - выполнять точечные domain reads;
  - выполнять атомарные domain writes;
  - проверять `expectedRev`;
  - восстанавливать audit trail;
  - делать резервные копии и миграции без остановки бизнес-логики.

### MUST NOT

- БД не должна быть дампом клиентских массивов.
- Корректность не должна зависеть от порядка полей JSON.
- Один глобальный `meta.revision` не должен быть concurrency-моделью для всех
  доменов.
- MySQL не должен использоваться только как файловое хранилище строки JSON.

---

## 2. MySQL Platform Baseline

### MUST

- Версия СУБД: MySQL 8.4 LTS.
- Storage engine: InnoDB.
- Character set: `utf8mb4`.
- User-facing text collation по умолчанию:
  `utf8mb4_0900_ai_ci`, если домен не требует строгого binary-сравнения.
- Exact identifiers, tokens, hashes, external IDs and case-sensitive codes
  должны храниться с binary-safe сравнением:
  `utf8mb4_0900_bin`, `VARBINARY` или явно нормализованным canonical value.
- Все таблицы должны иметь явный primary key.
- Все внешние связи, которые являются инвариантами домена, должны быть
  выражены через foreign key или через явно документированный application guard.
- Все временные поля должны храниться в UTC.
- Для новых SQL-таблиц предпочтительный тип времени: `DATETIME(3)` UTC.
- Legacy millisecond timestamps могут сохраняться на API boundary только как
  compatibility-представление.
- Время на всех серверах, участвующих в работе сайта, БД, backup и deploy,
  должно синхронизироваться через NTP или эквивалентный системный механизм.
- Подключение к БД должно идти через connection pool с ограниченным размером.
- Секреты подключения должны храниться в env/config вне репозитория.

### MUST NOT

- Нельзя хранить пароли, токены, cookies или service credentials в SQL в
  открытом виде.
- Нельзя полагаться на timezone сервера БД для бизнес-расчетов.
- Нельзя использовать MyISAM или таблицы без транзакций.
- Нельзя использовать `latin1` или непредсказуемую collation по умолчанию.

### Database Identity and Connection Contract

Эти значения фиксируют целевой локальный/bootstrap contract для MySQL 8.4.
Код приложения должен читать их из env/config, а не хардкодить в server logic.

- Database/schema name: `tspcc_bd`
- Application DB user: `tspcc_app`
- Local/bootstrap password: `TspccApp!Local2026`
- Default host: `127.0.0.1`
- Default port: `3306`
- Default charset: `utf8mb4`
- Default collation: `utf8mb4_0900_ai_ci`
- Default timezone contract: UTC for stored timestamps
- Required storage engine: InnoDB

Целевые переменные окружения:

- `TSPCC_DB_HOST=127.0.0.1`
- `TSPCC_DB_PORT=3306`
- `TSPCC_DB_NAME=tspcc_bd`
- `TSPCC_DB_USER=tspcc_app`
- `TSPCC_DB_PASSWORD=<secret>`
- `TSPCC_DB_CONNECTION_LIMIT=<positive integer>`
- `TSPCC_DB_SSL=<disabled|required|custom>`, если окружение требует TLS

### Backup and Restore Contract

### MUST

- Резервное копирование MySQL должно выполняться промышленным способом через
  стандартную утилиту `mysqldump`.
- Бэкапы должны выполняться регулярно и автоматически, например через cron или
  другой системный scheduler.
- Файлы дампов должны сохраняться вне production-диска, на котором работает
  сайт и основная MySQL data directory.
- Для бэкапов должен быть определен retention period.
- Бэкапы должны быть доступны для быстрого восстановления при сбое.
- Процедура восстановления из `mysqldump`-дампа должна быть документирована.
- Восстановление из дампа должно периодически проверяться на тестовой среде.
- Перед production cutover на MySQL должен быть свежий проверенный дамп.
- Backup/restore diagnostics должны позволять понять:
  - когда создан последний успешный дамп;
  - где он хранится;
  - прошла ли последняя проверка восстановления;
  - какой retention применяется.

### MUST NOT

- Нельзя хранить единственную копию бэкапа на том же production-диске.
- Нельзя считать backup strategy рабочей без проверенного restore.
- Нельзя заменять database backup только Git history, JSON export или ручным
  копированием файлов.

### Database Grants

### MUST

- `tspcc_app` должен быть application runtime user.
- `tspcc_app` должен иметь только права, необходимые приложению:
  `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `EXECUTE`, если stored routines
  используются осознанно.
- Schema migration user должен быть отдельным от `tspcc_app`.
- Migration/admin user может иметь `CREATE`, `ALTER`, `DROP`, `INDEX`,
  `REFERENCES`, но эти права не должны требоваться runtime-приложению.
- Production password для `tspcc_app` должен задаваться через secret/env и
  может отличаться от локального/bootstrap password.

### MUST NOT

- Нельзя запускать сайт под MySQL `root`.
- Нельзя давать `tspcc_app` глобальные права `*.*`.
- Нельзя требовать `CREATE/DROP/ALTER` для обычного запуска сайта.
- Нельзя считать локальный/bootstrap password обязательным production password.

---

## 3. Storage Boundary

### MUST

- В коде должен появиться один persistence boundary для SQL, например
  `Database` / `Repository` / `UnitOfWork`.
- Domain logic не должна размазывать raw SQL по случайным местам `server.js`.
- Каждый домен должен иметь явный repository / query layer:
  - cards
  - card files metadata
  - directories
  - security
  - production planning
  - production execution
  - derived read models
  - messaging/profile/notifications
  - receipts, если этот домен когда-либо выводится из frozen legacy carve-out
- Общие helpers должны покрывать:
  - transaction start/commit/rollback;
  - conflict response;
  - deadlock retry;
  - audit/outbox запись;
  - DB diagnostics.

### MUST NOT

- Нельзя делать SQL-запросы из клиентского кода.
- Нельзя создавать второй независимый persistence pipeline рядом с основным.
- Нельзя оставлять домен одновременно на двух равноправных источниках истины.
- Нельзя читать часть домена из JSON snapshot, а часть из MySQL без явного
  migration adapter и removal path.

---

## 4. Schema Design

### MUST

- Схема должна быть нормализована по доменным агрегатам.
- Основные mutable entities должны иметь:
  - `id`
  - `rev`
  - `created_at`
  - `updated_at`
  - domain-specific status fields
- Справочники должны иметь стабильные IDs и отдельные таблицы связей там, где
  есть many-to-many.
- Исторические бизнес-события должны храниться append-only, а не перетираться
  вместе с текущим состоянием.
- Для часто используемых выборок должны быть добавлены индексы по реальным
  query patterns.
- Уникальные бизнес-инварианты должны быть выражены через unique indexes там,
  где это возможно.

### SHOULD

- Для сложных, но не являющихся основой конкурентного редактирования атрибутов
  допустимы JSON columns, если:
  - владелец поля указан;
  - есть check/validation на сервере;
  - поле не заменяет нормальную relation-модель критичного домена;
  - есть план нормализации, если поле становится query/write-critical.

### MUST NOT

- Нельзя хранить `cards`, `users`, `productionSchedule` или `chatMessages` как
  массивы внутри одной JSON-колонки в финальном состоянии.
- Нельзя проектировать таблицы как 1:1 копию текущих клиентских global arrays,
  если это сохраняет legacy-связанность.
- Нельзя использовать JSON columns для обхода foreign keys в критичных связях.

---

## 5. Revision and Conflict Model

### MUST

- Каждая критично изменяемая сущность должна иметь `rev INT NOT NULL`.
- Начальное значение `rev`: `1`.
- Каждая успешная domain write-операция должна увеличивать `rev` ровно тех
  сущностей или агрегатов, которые реально изменены.
- Клиент должен отправлять `expectedRev` или domain-specific equivalent:
  `expectedFlowVersion`, `expectedPlanningRev`.
- Сервер должен сравнивать expected value с текущим SQL state внутри
  транзакции.
- При несовпадении сервер должен возвращать `409 Conflict`.
- Конфликт должен возвращать совместимый payload:
  - `code`
  - `entity`
  - `id`
  - `expectedRev`
  - `actualRev`
  - user-safe message
  - targeted refresh metadata, если применимо

### SQL Pattern

Для простого optimistic update целевой паттерн:

```sql
UPDATE cards
SET ..., rev = rev + 1, updated_at = UTC_TIMESTAMP(3)
WHERE id = ? AND rev = ?;
```

Если affected rows = `0`, команда должна перечитать actual revision и вернуть
`409`.

Для сложных агрегатов команда должна использовать транзакцию и, где нужно,
`SELECT ... FOR UPDATE` на aggregate root.

### MUST NOT

- Нельзя инкрементить глобальную ревизию всего сайта как замену ревизиям
  доменов.
- Нельзя принимать stale write как success.
- Нельзя делать silent merge конфликтующих изменений.
- Нельзя увеличивать `rev` unrelated домена.

---

## 6. Transactions

### MUST

- Каждая domain command должна выполняться в транзакции.
- Транзакция должна включать:
  - чтение текущего состояния, нужного для проверки прав и бизнес-правил;
  - проверку `expectedRev`;
  - запись изменений;
  - запись audit/outbox событий, если они являются частью команды.
- Команда должна быть атомарной: либо все изменения команды сохранены, либо
  ничего не сохранено.
- Для команд, которые меняют несколько таблиц одного агрегата, aggregate root
  должен блокироваться через optimistic condition или `SELECT ... FOR UPDATE`.
- Deadlock / lock wait timeout должны диагностироваться через `[DB]` и
  обрабатываться контролируемым retry там, где команда идемпотентна.

### SHOULD

- Базовый isolation level для API-команд should быть `READ COMMITTED` с явными
  row locks там, где они нужны.
- Если домен требует repeatable aggregate read, это должно быть указано в
  repository method, а не быть случайным побочным эффектом.

### MUST NOT

- Нельзя держать транзакцию открытой во время upload/download файла,
  long polling, SSE или внешнего сетевого вызова.
- Нельзя выполнять full table lock для обычной пользовательской операции.
- Нельзя делать несколько независимых commits внутри одной бизнес-команды.

---

## 7. Domain Tables

Целевые таблицы могут уточняться в SQL migration design, но финальная модель
должна иметь не менее следующих доменных областей.

### Cards

### MUST

- Карточка является aggregate root.
- Основная таблица: `cards`.
- Связанные таблицы:
  - `card_operations`
  - `card_serials` / `card_quantities`, если serial/quantity model требует
    отдельной нормализации
  - `card_approval_states`
  - `card_approval_thread`
  - `card_logs`
  - `card_attachments`
  - `card_input_control`
  - `card_provision`
  - `card_flow_state`, если production flow остается частью card aggregate
- `cards.rev` должен защищать обычное редактирование карточки и lifecycle
  commands, если для конкретного поддомена не введена более точная ревизия.
- Архивирование должно оставаться soft-state, если бизнес-правила не изменены.
- Repeat из архива должен создавать новую draft card, а не оживлять старую.

### MUST NOT

- Нельзя сохранять всю карточку одной JSON-строкой как final model.
- Нельзя хранить attachments только в файловой системе без SQL metadata.
- Нельзя терять card logs / approval thread при переносе.

### Directories

### MUST

- Справочники должны быть отдельными таблицами:
  - `departments` / `centers`
  - `operations`
  - `areas`
  - `employees` или `user_department_assignments`, согласно фактическому
    owner'у связи
  - `shift_times`
  - relation tables для allowed areas / assignments
- Delete guards должны выполняться сервером на основе SQL-связей и доменных
  проверок.
- Исторические текстовые значения, которые по бизнес-правилам должны
  сохраняться в уже созданных карточках, не должны переписываться каскадом.

### MUST NOT

- Нельзя делать cascade delete там, где бизнес-правило требует guard или
  сохранение истории.

### Security

### MUST

- Пользователи и уровни доступа должны быть SQL-сущностями:
  - `users`
  - `access_levels`
  - `access_level_permissions` или структурированная permission table
  - `sessions`
  - `csrf_tokens` / session-bound token state, если хранится persistently
  - `user_actions`
- Password storage должен сохранять PBKDF2 hash/salt compatibility и иметь
  явный путь к будущему password hash upgrade, если он понадобится.
- `Abyss` protection должен быть enforced сервером и SQL constraints/guards
  where practical.
- `landingTab`, `inactivityTimeoutMinutes` и profile access rules должны
  сохраниться.

### MUST NOT

- Нельзя отдавать password hashes в client payload.
- Нельзя хранить legacy password fields как active source of truth без
  migration/removal path.

### Production

### MUST

- Production planning и execution должны быть отдельными SQL-доменами:
  - `production_schedule`
  - `production_plan`
  - `production_shift_tasks`
  - `production_shifts`
  - `production_shift_closures`
  - `production_flow_events`
  - `production_delays`
  - `production_defects`
  - `production_repairs`
  - `production_disposals`
  - material issue / return / drying tables, если эти действия имеют
    самостоятельную историю
- Planning должен иметь собственную revision model:
  `production_planning_rev` или rev на конкретных planning aggregates.
- Execution должен сохранить `expectedFlowVersion -> 409` semantics.
- Derived views `/workorders`, `/archive`, `/items`, `/ok`, `/oc` должны
  строиться из source-domain tables или documented read models.

### MUST NOT

- Нельзя хранить production как один массив `productionShiftTasks` в JSON.
- Нельзя инвалидировать planning `expectedRev` unrelated изменениями
  пользователей, сообщений или карточек вне planning aggregate.
- Нельзя строить корректность production на клиентских pending overlays.

### Messaging, Profile and Notifications

### MUST

- Chat/profile/push должны иметь отдельные таблицы:
  - `chat_conversations`
  - `chat_messages`
  - `chat_participants`
  - `chat_read_states`
  - `web_push_subscriptions`
  - `fcm_tokens`
  - `user_visits`
  - `user_actions`
- `/api/chat/*` остается primary write stack.
- Delivered/read/unread semantics должны сохраниться.
- Push subscriptions and tokens должны быть связаны с пользователем и иметь
  controlled cleanup.

### MUST NOT

- Нельзя держать `messages`, `chatConversations`, `chatMessages`,
  `chatStates`, `userActions` как snapshot compatibility fields в финальном
  SQL target state.

### Receipts

### MUST

- Пока `receipts` остается frozen legacy carve-out в основном migration plan,
  MySQL-переход не должен случайно менять его бизнес-поведение.
- Если `receipts` переносится на MySQL, для него должен быть отдельный
  domain design:
  - таблицы;
  - owner;
  - write contract;
  - route behavior;
  - tests;
  - migration/removal path.

### MUST NOT

- Нельзя использовать `receipts` как оправдание для сохранения общей
  snapshot-модели в остальных доменах.

---

## 8. Files and Binary Data

### MUST

- Файлы карточек могут оставаться в filesystem/object storage.
- MySQL должен хранить metadata файлов:
  - `id`
  - `card_id`
  - folder/type
  - original name
  - stored path/key
  - mime
  - size
  - checksum, если доступен
  - created_by
  - created_at
  - deleted_at, если используется soft delete
- File upload/delete/resync должны обновлять SQL metadata и `card.rev` /
  `cardRev` в одной контролируемой команде.
- Файловая операция должна быть idempotent-aware: повтор после сбоя не должен
  создавать несогласованное состояние.

### MUST NOT

- Нельзя считать файл существующим только потому, что он есть на диске.
- Нельзя считать файл удаленным только потому, что metadata исчезла.
- Нельзя держать DB transaction открытой во время передачи большого файла.

---

## 9. API and Read Model

### MUST

- Внешний client API должен сохранять бизнес-поведение.
- Переход на SQL не должен ломать URL, protected route boot, F5 и history.
- Domain write endpoints должны сохранять command-oriented contract.
- Read endpoints должны постепенно заменить scoped snapshot reads:
  - cards list/detail
  - directories slices
  - security slices
  - production slices
  - messaging/profile slices
- API может временно возвращать legacy-compatible shape, но source of truth
  должен быть SQL.
- Compatibility adapter должен быть read-only, если домен уже перенесен на SQL.
- Read-only compatibility adapter после cutover не должен выполнять обратную
  синхронизацию в JSON/snapshot.
- Для каждого read-only adapter должен быть указан removal path и набор
  проверок, после которых adapter удаляется.

### MUST NOT

- Нельзя возвращать весь сайт целиком из MySQL как основной read contract.
- Нельзя делать `/api/data` primary SQL endpoint.
- Нельзя менять route behavior из-за перехода на SQL.
- Нельзя делать dual-read/dual-write без явно ограниченного migration window,
  owner'а, diagnostics и rollback plan.

---

## 10. Audit, Outbox and Realtime

### MUST

- Бизнес-значимые события должны иметь audit trail.
- Realtime должен строиться поверх committed SQL state.
- После успешной транзакции доменная команда должна создавать outbox/live event
  или иной надежный post-commit signal.
- Live event должен содержать минимум:
  - domain
  - entity
  - id
  - rev/version
  - event type
  - timestamp
- Realtime остается вспомогательным каналом: корректность не зависит от SSE.

### SHOULD

- Для надежной доставки live/follow-up effects should использоваться outbox
  table:
  - `id`
  - `event_type`
  - `aggregate_type`
  - `aggregate_id`
  - `payload`
  - `created_at`
  - `processed_at`
  - `attempts`

### MUST NOT

- Нельзя отправлять live event до commit как подтверждение записи.
- Нельзя использовать realtime как замену SQL conflict control.

---

## 11. Data Migration

### MUST

- Миграция из JSON в MySQL должна быть воспроизводимой.
- Перед импортом должны быть выполнены validation checks:
  - обязательные IDs;
  - duplicate IDs;
  - duplicate-key anomalies;
  - encoding issues;
  - broken references;
  - invalid status/stage values;
  - invalid revisions;
  - orphan attachments metadata;
  - production flow consistency.
- Импорт должен сохранять все бизнес-значимые данные.
- Каждая миграция должна быть versioned и repeatable в test environment.
- После миграции должны быть reconciliation reports:
  - counts by domain;
  - sample entity equality;
  - broken reference count;
  - skipped/converted fields;
  - warnings requiring manual decision.
- Reconciliation должен быть не только ручным отчетом, но и автоматической
  проверкой ключевых выборок по доменам до и после cutover.
- Для production cutover должен быть воспроизводимый и протестированный
  rollback plan.
- Rollback plan должен включать восстановление из проверенного `mysqldump`
  backup, если cutover уже сделал MySQL production source of truth.
- Batch-операции и временные таблицы, если они используются при миграции,
  должны иметь явно описанный lifecycle:
  - owner;
  - purpose;
  - expected lifetime;
  - cleanup step;
  - validation after cleanup.

### MUST NOT

- Нельзя silently drop unknown fields.
- Нельзя исправлять данные во время импорта без отчета.
- Нельзя менять IDs сущностей без compatibility mapping.
- Нельзя удалять legacy JSON backup до успешной проверки SQL cutover.
- Нельзя оставлять временные migration tables или batch artifacts без owner'а
  и cleanup plan.

---

## 12. SQL Migrations and Versioning

### MUST

- SQL schema changes должны храниться как versioned migrations в репозитории.
- Migration runner должен вести таблицу примененных миграций.
- Миграции должны быть forward-only по умолчанию.
- Каждая migration должна иметь краткое описание:
  - purpose;
  - затронутые домены;
  - влияние на бизнес-логику или явное указание, что бизнес-логика не меняется;
  - rollback/restore expectation.
- Destructive migration должна иметь отдельный backup/restore plan.
- Server boot не должен незаметно менять production schema без контролируемого
  migration step.
- Fixture/test database setup должен использовать те же schema migrations, что
  и production-like окружение.
- Для тестовой среды допускается ограниченный schema rollback или полный сброс
  тестовой БД, если это не переносится как production-практика и явно отделено
  от production migration contract.

### MUST NOT

- Нельзя править production schema вручную на VDS как основной процесс.
- Нельзя держать "актуальную схему" только в README или комментариях.
- Нельзя полагаться на `CREATE TABLE IF NOT EXISTS` как замену migration
  history.
- Нельзя использовать test rollback как оправдание rollback-first стратегии для
  production schema.

---

## 13. Performance

### MUST

- Производительность должна достигаться через:
  - domain-specific queries;
  - индексы по реальным фильтрам;
  - pagination/limits;
  - targeted refresh;
  - read models там, где они оправданы измерениями.
- Для тяжелых экранов должны быть определены query patterns до добавления
  индексов.
- Slow query logging / `[PERF][DB]` diagnostics должны позволять увидеть
  проблемный SQL path.
- Должен быть настроен monitoring и alerts минимум для:
  - slow queries;
  - deadlocks;
  - lock wait timeouts;
  - connection pool exhaustion;
  - failed backup;
  - failed restore rehearsal.
- Connection pool metrics должны позволять отличить нехватку pool capacity от
  медленного SQL path.

### MUST NOT

- Нельзя компенсировать плохую SQL-схему большими клиентскими кэшами.
- Нельзя делать `SELECT *` по большим доменам для каждого route refresh.
- Нельзя добавлять индексы вслепую без понимания query pattern.

---

## 14. Security

### MUST

- Все SQL-запросы должны использовать parameterized queries.
- DB user приложения должен иметь минимально необходимые права.
- Separate admin/migration credentials should использоваться только для
  migration runner.
- Sensitive fields должны быть исключены из API payload.
- Session/auth checks должны выполняться до domain command.
- Permission checks должны выполняться внутри server command перед SQL write.
- Production credentials должны иметь процедуру ротации.
- Ротация production credentials должна быть возможна без пользовательского
  downtime или с заранее объявленным maintenance window, если zero-downtime
  rotation технически недоступен.
- ORM/SQL helpers, query builders и repository helpers должны проходить review
  на отсутствие SQL injection paths даже при использовании parameterized
  queries.
- Dynamic SQL, если он нужен для сортировки/фильтрации, должен использовать
  allowlist полей и направлений.

### MUST NOT

- Нельзя строить SQL строковой конкатенацией с пользовательским input.
- Нельзя выдавать приложению root/admin DB credentials.
- Нельзя логировать password hashes, tokens, cookies или raw credentials.
- Нельзя считать parameterized queries достаточной защитой, если helper
  позволяет небезопасно подставлять identifiers, ORDER BY, LIMIT или raw
  fragments из пользовательского input.

---

## 15. Testing

### MUST

- Для каждого SQL-переносимого домена должны быть тесты:
  - successful write;
  - `expectedRev -> 409`;
  - route stability после conflict;
  - direct URL/F5 там, где route зависит от домена;
  - migration import equality;
  - automated pre/post cutover comparison по ключевым выборкам домена;
  - automated check that post-cutover legacy layer is read-only;
  - rollback/retry behavior для транзакционных ошибок, где применимо.
- E2E должны продолжать покрывать:
  - auth/bootstrap/routes;
  - cards;
  - approval/input/provision;
  - card files;
  - directories/security;
  - production planning/execution;
  - messaging/profile;
  - realtime unavailable fallback.
- Test fixtures должны перейти от JSON database fixture к SQL seed/migration
  fixture или иметь documented compatibility bridge.
- Backup/restore test должен включать восстановление `mysqldump`-дампа на
  тестовой среде и smoke-проверку ключевых доменных выборок после restore.

### MUST NOT

- Нельзя считать домен перенесенным на MySQL без conflict-path теста.
- Нельзя удалять JSON compatibility до прохождения migration reconciliation.
- Нельзя считать migration cutover проверенным только по ручному просмотру
  reconciliation report.

---

## 16. Migration Stage Plan

### Stage 0. SQL Readiness Inventory

Цель:
- зафиксировать текущие JSON поля, владельцев доменов и связи.

Обязательный результат:
- inventory всех snapshot fields;
- mapping `JSON field -> SQL domain/table`;
- список compatibility fields;
- список duplicate/encoding/schema anomalies;
- список бизнес-инвариантов из `docs/business-rules/*.md`, которые должны быть
  проверены импортом.

### Stage 1. MySQL Foundation

Цель:
- добавить SQL infrastructure без смены бизнес-поведения.

Обязательный результат:
- connection pool;
- migration runner;
- transaction helper;
- repository boundary;
- `[DB]` diagnostics;
- test database setup;
- no production domain cutover yet.

### Stage 2. Schema and Import Dry Run

Цель:
- создать начальную SQL-схему и воспроизводимый импорт из JSON.

Обязательный результат:
- schema migrations;
- importer;
- validation report;
- reconciliation report;
- automated pre/post import comparison checks;
- no live writes to SQL as source of truth yet.

### Stage 3. Cards and Card Files Cutover

Цель:
- перенести card aggregate и file metadata.

Обязательный результат:
- cards reads/writes use SQL;
- `card.rev` enforced in SQL;
- attachments metadata in SQL;
- card logs and approval thread preserved;
- `/api/data` no longer owns cards.
- cards JSON/snapshot compatibility is read-only or removed with documented
  removal path.

### Stage 4. Directories and Security Cutover

Цель:
- перенести справочники, пользователей, уровни доступа и сессии.

Обязательный результат:
- directory/security writes use SQL;
- guards and permissions preserved;
- `Abyss` protection preserved;
- password hash semantics preserved;
- no snapshot authority for these domains.
- directory/security JSON/snapshot compatibility is read-only or removed with
  documented removal path.

### Stage 5. Production Cutover

Цель:
- перенести planning and execution source of truth.

Обязательный результат:
- planning revision stored/enforced in SQL;
- flow version stored/enforced in SQL;
- production commands atomic;
- derived views read from SQL source/read models;
- workspace conflict behavior unchanged.
- production JSON/snapshot compatibility is read-only or removed with
  documented removal path.

### Stage 6. Messaging/Profile/Notifications Cutover

Цель:
- перенести chat/profile/push data.

Обязательный результат:
- `/api/chat/*` uses SQL;
- delivered/read/unread preserved;
- push subscriptions and FCM tokens stored in SQL;
- snapshot chat compatibility removed or read-only archived.
- messaging/profile JSON/snapshot compatibility has documented final removal
  criteria.

### Stage 7. Remove JSON Snapshot Authority

Цель:
- удалить remaining authority of `database.json`.

Обязательный результат:
- `JsonDatabase` no longer primary persistence;
- `/api/data` removed or explicitly limited to non-authoritative diagnostic /
  legacy export, if still needed;
- client no longer depends on full snapshot payload;
- fixtures use SQL seed path.

### Stage 8. Hardening

Цель:
- доказать промышленную готовность SQL-модели.

Обязательный результат:
- backup/restore procedure;
- tested `mysqldump` restore on test environment;
- migration rehearsal report;
- slow query review;
- monitoring/alerts for slow queries, deadlocks, lock waits, pool exhaustion
  and backup/restore failures;
- deadlock/timeout diagnostics;
- complete E2E pass;
- load/perf baseline for critical routes and writes.

---

## 17. Forbidden Final State

Сайт не должен прийти к состоянию, где одновременно или по отдельности
присутствуют такие свойства:

- MySQL содержит одну большую JSON-строку всего сайта.
- `/api/data` остается primary read/write API.
- Клиентский snapshot-save пишет в SQL.
- `database.json` и MySQL оба считаются источниками истины.
- Конфликты конкурентных правок решаются last-write-wins.
- Сущности без `rev` редактируются конкурентно.
- Production planning зависит от unrelated global revision.
- Realtime нужен для корректности SQL state.
- Файлы существуют без согласованной SQL metadata.
- SQL schema меняется вручную без migrations.
- Бизнес-правила изменены только ради удобства хранения.

---

## 18. Definition of Done

Можно считать, что переход на MySQL 8.4 достиг целевой промышленной модели,
если одновременно верно все ниже:

- MySQL 8.4 InnoDB является единственным source of truth для in-scope данных.
- Все critical writes идут через server domain commands.
- Все critical writes атомарны на уровне SQL transaction.
- Критичные mutable entities имеют `rev`.
- `expectedRev` / `expectedFlowVersion` / `expectedPlanningRev` enforced in SQL.
- Stale write возвращает `409 Conflict`, а не перетирает данные.
- SQL-схема разделена по доменам и не является большим snapshot JSON.
- Foreign keys / unique indexes / guards защищают основные бизнес-инварианты.
- Audit/log/history данные сохранены и продолжают пополняться.
- Realtime работает только поверх committed SQL state.
- `/api/data` не является authoritative API.
- `database.json` не является authoritative storage.
- Миграции воспроизводимы и фиксируются в migration history.
- Backup/restore procedure проверена.
- Сценарий восстановления из `mysqldump` backup проверен на тестовой среде.
- Monitoring и alerts настроены для slow queries, deadlocks, lock waits,
  connection pool exhaustion и backup/restore failures.
- Production credentials имеют documented rotation procedure.
- Все SQL helpers/repositories прошли review на SQL injection paths.
- Для каждого перенесенного домена documented removal path выполнен или
  остается только read-only compatibility layer с owner'ом и датой удаления.
- E2E покрывают маршруты, конфликты и ключевые бизнес-сценарии после SQL cutover.
- Бизнес-логика сайта полностью сохранена.
