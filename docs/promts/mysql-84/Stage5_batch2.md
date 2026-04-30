# MySQL 8.4 Stage 5 Batch 2

## Общий префикс

```text
Работай строго по:
- AGENTS.md
- docs/architecture/current-architecture.md
- docs/architecture/current-state.md
- docs/architecture/change-checklist.md
- docs/architecture/mysql-84-target-architecture.md
- docs/architecture/mysql-84-migration-plan.md
- docs/business-rules/*.md

Важно:
- Это MySQL 8.4 Stage 5: Cards, Approval and Card Files SQL Cutover.
- Batch 1 выполнен как audit/design. Его итоги обязательны для Batch 2.
- Stage 4 reconciliation PASS: warnings 0, manual decisions 0, missing files 0,
  orphan files 0, size mismatches 0. Stage 4 не блокирует Stage 5.
- Batch 1 audit зафиксировал текущую отправную точку:
  - `handleCardsCoreRoutes()` уже является domain API boundary для cards,
    approval/input/provision и использует `expectedRev -> 409`;
  - `handleFileRoutes()` уже является domain API boundary для card files и
    использует card revision-safe contract;
  - runtime source of truth все еще `JsonDatabase` / `database.update()`;
  - `CardsRepository` / `CardFilesRepository` еще отсутствуют;
  - `card_attachments` уже существует в SQL schema, но без contextual columns:
    `scope`, `scope_id`, `operation_label`, `items_label`, `op_id`,
    `op_code`, `op_name`;
  - importer сейчас импортирует attachment metadata без этих contextual fields;
  - `/api/data` POST остается writable compatibility path и может принять
    `cards` payload, если его не заблокировать отдельно;
  - `ensureCardsCoreDataReady()` может выполнять скрытую cards mutation для
    flow normalization и после cutover не должен быть write-authority.
- Можно менять только cards/lifecycle/files SQL cutover scope.
- Нельзя трогать directories/security/production/messaging cutover.
- Нельзя менять business semantics карточек, approval, input-control,
  provision и файлов.
- Нельзя проектировать raw SQL directly in `server.js`: SQL ownership должен
  идти через repository boundary.
- Нельзя делать dual-write или возвращать critical writes к snapshot-save.
- Нельзя писать `card_flow_projection` из cards/lifecycle/files cutover.
  Production execution остается единственным владельцем production flow state,
  flow events и projection updates.
- Принятое архитектурное решение для Batch 2:
  1. attachment contextual metadata хранить в явных SQL-колонках;
  2. `/api/data` для cards/files сделать SQL-derived read-only/export-only;
  3. cards/lifecycle/files SQL ownership вести через строгий repository boundary
     с самого начала;
  4. `ensureCardsCoreDataReady()` и аналогичные JSON helpers не могут оставаться
     runtime write-authority для cards/files после cutover.
- Если меняются файлы сайта, выполни version bump по AGENTS.md.
```

## Промт

```text
Нужно выполнить Stage 5 Batch 2: реализовать cards/lifecycle/files SQL source
of truth с учетом итогов Stage 5 Batch 1 audit/design.

Сначала проверь обязательные preflight-блокеры. Если хотя бы один блокер нельзя
закрыть корректно в этом batch, остановись и верни BLOCKED без частичного
cutover:

1. Attachment contextual metadata:
   - runtime attachments могут содержать `scope`, `scopeId`, `operationLabel`,
     `itemsLabel`, `opId`, `opCode`, `opName`;
   - выбран обязательный вариант: добавить явные SQL-колонки в
     `card_attachments`;
   - нельзя заменять это решение `metadata_json` или доказательством
     non-authoritative без отдельного нового архитектурного решения;
   - без migration для этих колонок file cutover небезопасен.

2. `/api/data` compatibility:
   - выбран обязательный вариант: cards/files slices в compatibility shape
     должны быть SQL-derived и read-only/export-only;
   - `/api/data` POST не должен иметь authority over cards/files после cutover;
   - запрещено оставлять путь, где snapshot payload перезаписывает или сохраняет
     cards/files как authoritative данные.

3. Repository/source-of-truth boundary:
   - SQL для cards/lifecycle/files должен быть инкапсулирован в repositories;
   - route handlers могут оркестрировать request/response, но не должны становиться
     владельцами raw SQL бизнес-команд;
   - строгий boundary обязателен с первого cutover-шага, а не как последующий
     refactor.

4. Hidden JSON cards mutations:
   - `ensureCardsCoreDataReady()` сейчас может делать `database.update()` для
     cards/flow normalization;
   - после cutover этот helper не должен мутировать authoritative cards/files;
   - допустимый результат: read-only compatibility/read normalization или явный
     SQL command в правильном owner repository;
   - если это нельзя закрыть без production execution scope, остановись и верни
     BLOCKED с точным remediation plan.

5. Existing file upload transaction risk:
   - текущий runtime пишет physical file и JSON metadata в одном handler flow;
   - SQL implementation не должен держать DB transaction во время base64 decode,
     transfer или physical write;
   - нужен staged physical write -> short SQL transaction -> post-commit cleanup
     / rollback cleanup contract.

Реализуй cutover в таком порядке:

1. Добавь repository boundary:
   - `CardsRepository`: card aggregate, list/detail, create/update/archive/
     repeat/delete, `cards.rev`;
   - `CardLifecycleRepository` или lifecycle methods внутри `CardsRepository`:
     approval/input/provision stage transitions, `card_lifecycle_events`,
     `card_approval_events`, `card_input_control_records`,
     `card_provision_records`, `card_logs`;
   - `CardFilesRepository`: attachment metadata, file-linked card revision updates;
   - используй existing `BaseRepository`, `withTransaction`, `createSqlConflict`
     / `SqlConflictError`.
   - raw SQL business commands не должны быть разбросаны по `server.js`.

2. Закрой attachment metadata gap до runtime file cutover:
   - добавь migration с явными колонками:
     `scope`, `scope_id`, `operation_label`, `items_label`, `op_id`, `op_code`,
     `op_name`;
   - сохрани camelCase/snake_case mapping на уровне repository/API shape:
     `scopeId` <-> `scope_id`,
     `operationLabel` <-> `operation_label`,
     `itemsLabel` <-> `items_label`,
     `opId` <-> `op_id`,
     `opCode` <-> `op_code`,
     `opName` <-> `op_name`;
   - сохрани mapping:
     `card_attachments.id` <- attachment id,
     `card_id` <- card id,
     `storage_key` <- normalized card qrId/storage folder key,
     `rel_path` <- folder/storedName,
     `category` <- GENERAL/INPUT_CONTROL/PARTS_DOCS/etc.,
     `original_name` <- originalName/name,
     `mime_type` <- mime/type,
     `size_bytes` <- reconciled physical file size,
     `cards.input_control_file_attachment_id` <- current inputControlFileId.
   - обнови importer/reconciliation так, чтобы contextual fields не терялись.

3. Реализуй SQL read path shape compatible with current API contracts:
   - primary: `GET /api/cards-core`, `GET /api/cards-core/:idOrQr`;
   - targeted/live refresh: `GET /api/cards-live`;
   - compatibility: `GET /api/data` may return cards/files shape, but it must be
     SQL-derived read-only/export-only.
   - `GET /api/data` не должен становиться primary SQL API.

4. Перенеси card commands в SQL transactions:
   - create/update: `POST /api/cards-core`, `PUT/PATCH /api/cards-core/:id`;
   - lifecycle: `POST /api/cards-core/:id/archive`,
     `POST /api/cards-core/:id/repeat`, `DELETE /api/cards-core/:id`;
   - один command = одна короткая SQL transaction;
   - сохраняй `expectedRev -> 409` contract.
   - `repeat` должен создавать новую `DRAFT` card, а не разархивировать source.
   - `delete` должен сохранить текущий server-side cascade semantics и не
     оставлять broken production references.

5. Перенеси approval/input/provision commands в SQL transactions:
   - approval:
     `POST /api/cards-core/:id/approval/send|approve|reject|return-to-draft`;
   - input/provision:
     `POST /api/cards-core/:id/input-control/complete`,
     `POST /api/cards-core/:id/provision/complete`;
   - сохрани stage semantics, approvalThread/logs and record tables;
   - invalid stage должен возвращать controlled result, stale rev должен идти в 409.
   - reject reason, approval thread, actor snapshots and card logs не должны
     потеряться или перейти в loose snapshot-only storage.

6. Перенеси file metadata commands в SQL:
   - `GET /api/cards/:id/files`;
   - `POST /api/cards/:id/files`;
   - `POST /api/cards/:id/files/resync`;
   - `DELETE /api/cards/:id/files/:fileId`;
   - `GET /files/:attachmentId`;
   - `GET /api/cards/:id/files/:fileId`;
   - upload не должен держать DB transaction во время transfer/decode больших
     файлов: сначала temp/staged physical write, затем короткая SQL transaction,
     затем commit/cleanup;
   - physical files остаются filesystem/object storage, но availability валидна
     только через SQL metadata;
   - `deleted_at` используй только если явно сохранены physical cleanup semantics.
   - `GET /files/:attachmentId` должен искать metadata в SQL, а не в
     `cards[].attachments[]`.

7. Сохрани conflict envelope:
   - repository throws `SqlConflictError` / `createSqlConflict({
       code: 'STALE_REVISION',
       entity: 'card',
       id,
       expectedRev,
       actualRev
     })`;
   - HTTP handler возвращает существующий 409 payload: `code`, `entity`, `id`,
     `expectedRev`, `actualRev`, user-safe message;
   - client remains on current route and uses targeted refresh flow.
   - не меняй client route/bootstrap behavior в этом batch.

8. Сохрани revision discipline:
   - для простых commands используй
     `UPDATE cards ... rev = rev + 1 WHERE id = ? AND rev = ?`;
   - для complex lifecycle/file/delete commands допустим
     `SELECT ... FOR UPDATE` plus explicit compare;
   - live events отправляй только after commit.
   - create starts with `rev = 1`; every successful card/file/lifecycle mutation
     increments only affected card aggregate revision.

9. Убери cards/files write authority из JSON/snapshot:
   - `ensureCardsCoreDataReady()` и похожие JSON helpers не должны снова
     становиться cards write authority;
   - compatibility adapters для cards/files можно оставить только как
     SQL-derived read-only/export;
   - `/api/data` POST должен отклонять или игнорировать cards/files slices с
     diagnostic log, но не должен сохранять их как authoritative snapshot state.
   - `preserveProtectedSlicesForLegacySnapshot()` / protected slice policy must
     explicitly protect or reject cards/files after cutover.

10. Проверь projection guard:
    - cards repository may read `card_flow_projection` for display;
    - cards/lifecycle/files cutover must not write `card_flow_projection`.
    - production execution remains sole writer of production flow state,
      flow events and projection updates.

Что нельзя делать:
- не использовать `/api/data` for cards/files writes;
- не оставлять snapshot-save как fallback для card critical writes;
- не создавать second flow source of truth;
- не менять production execution;
- не терять route on conflict;
- не делать broad refactor вне cards/lifecycle/files scope.
- не менять `router`, `bootstrap`, `popstate`, route registration или page
  visibility logic.
- не начинать Stage 6 directories/security, Stage 7 planning, Stage 8 execution
  или Stage 9 derived views.

Обязательные проверки:
- SQL integration: card create/update/archive/repeat/delete success and stale
  `expectedRev -> 409`;
- approval: send/approve/reject/return-to-draft success, invalid stage, stale
  conflict;
- input/provision: success, invalid stage, stale conflict, transitions to
  `WAITING_INPUT_CONTROL`, `WAITING_PROVISION`, `PROVIDED`;
- files: upload/delete/resync, stale conflict, duplicate PARTS_DOCS,
  input-control file relink/clear, physical missing file behavior;
- compatibility: `/api/data` cannot overwrite SQL cards/files;
- route stability: `/cards`, `/cards/:id`, `/card-route/:qr`, `/approvals`,
  `/input-control`, `/provision`, archive/repeat routes after success and 409;
- reconciliation/sample equality for cards, logs, approval events, attachments,
  input-control/provision records;
- projection guard: card commands/files do not write `card_flow_projection`.
- audit guard: no remaining cards/files `database.update()` authority path except
  explicitly documented read-only/export compatibility or non-authoritative test
  setup.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 5 Batch 2 PASS/FAIL/BLOCKED.
2. Repository/source-of-truth changes.
3. Attachment metadata decision/migration.
4. `/api/data` compatibility protection.
5. Cards/lifecycle/files transaction model.
6. Conflict behavior and route preservation.
7. Tests/checks run.
8. Remaining compatibility removal path.
9. Можно ли переходить к Stage 5 Batch 3.
```

## Ручная проверка после Prompt

Открыть `/cards`, создать и отредактировать тестовую карточку, проверить
archive/repeat/delete, approval/input/provision, загрузку/удаление/resync файла,
F5 на `/cards/:id`, `/card-route/:qr`, `/approvals`, `/input-control`,
`/provision`, а также stale conflict в двух вкладках если возможно.
