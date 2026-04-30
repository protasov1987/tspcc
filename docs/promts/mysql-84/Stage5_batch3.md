# MySQL 8.4 Stage 5 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 5: Cards, Approval and Card
  Files SQL Cutover.
- Batch 3 не должен начинать новый cutover scope.
- Нельзя начинать Stage 6.
- Нельзя исправлять крупные blockers в этом batch. Если обнаружен blocker,
  зафиксируй FAIL/BLOCKED и точный remediation batch.
- Допустимы только минимальные test/diagnostic fixes, если они не меняют
  business semantics и не расширяют scope.
- Принятое Stage 5 решение, которое нужно проверять:
  1. attachment contextual metadata хранится в явных SQL-колонках;
  2. `/api/data` для cards/files является SQL-derived read-only/export-only;
  3. cards/lifecycle/files SQL ownership идет через строгий repository boundary.
  4. `ensureCardsCoreDataReady()` и аналогичные JSON helpers не являются
     runtime write-authority для authoritative cards/files state.
- Проверка должна явно подтвердить, что Batch 2 закрыл audit gaps из Batch 1:
  repository boundary, attachment contextual columns, `/api/data` cards/files
  write protection, file upload transaction model и projection guard.
- Если меняются файлы сайта, выполни version bump по AGENTS.md.
```

## Промт

```text
Нужно выполнить Stage 5 Batch 3: приемку Cards, Approval and Card Files SQL
Cutover после Batch 2.

Проверь exit criteria. Stage 5 можно считать PASS только если все пункты
выполнены:

1. Source of truth:
   - MySQL `cards` plus related card tables are source of truth for cards,
     lifecycle, approval thread/logs and attachment metadata;
   - physical files remain filesystem/object storage, but reads/downloads are
     valid only with SQL metadata;
   - JSON/database snapshot cannot write or overwrite cards/files.
   - no runtime cards/files command persists through `JsonDatabase.update()`,
     `mergeSnapshots()` or hidden `ensureCardsCoreDataReady()` mutation.

2. API contracts preserved:
   - `GET /api/cards-core`, `GET /api/cards-core/:idOrQr`,
     `GET /api/cards-live` return compatible card shapes;
   - `POST /api/cards-core`, `PUT/PATCH /api/cards-core/:id`,
     archive/repeat/delete commands work through SQL;
   - approval/input/provision endpoints work through SQL and preserve stage
     semantics;
   - file endpoints `GET/POST /api/cards/:id/files`,
     `POST /api/cards/:id/files/resync`, `DELETE /api/cards/:id/files/:fileId`,
     `GET /files/:attachmentId`, `GET /api/cards/:id/files/:fileId` are
     SQL-metadata-backed.
   - existing response shapes remain compatible: card payloads, `cardRev`/`rev`,
     `files`/`attachments`, `inputControlFileId`, duplicate `PARTS_DOCS` error
     and user-safe validation errors.

3. Conflict contract:
   - all card/file critical writes enforce `cards.rev`;
   - stale `expectedRev` returns existing 409 envelope with `code`, `entity`,
     `id`, `expectedRev`, `actualRev` and user-safe message;
   - conflict does not redirect to dashboard and does not lose current route;
   - client uses targeted refresh flow after 409.
   - `INVALID_STATE` lifecycle conflicts remain controlled and do not become
     silent success or route reset.

4. Transaction model:
   - one SQL transaction per command;
   - simple commands use `UPDATE cards ... rev = rev + 1 WHERE id = ? AND rev = ?`
     or equivalent compare-and-increment;
   - complex lifecycle/file/delete commands use `SELECT ... FOR UPDATE` plus
     explicit rev compare where needed;
   - live events are emitted only after commit;
   - file upload does not hold DB transaction during large transfer/decode.
   - physical file write uses staged/cleanup contract and cannot leave silent
     SQL metadata divergence on failed commit.

5. Attachment metadata:
   - contextual fields from audit (`scope`, `scopeId`, `operationLabel`,
     `itemsLabel`, `opId`, `opCode`, `opName`) are persisted in explicit SQL
     columns;
   - required SQL columns exist and are used by repositories:
     `scope`, `scope_id`, `operation_label`, `items_label`, `op_id`, `op_code`,
     `op_name`;
   - no `metadata_json` substitute is used for these chosen Stage 5 fields;
   - attachment mapping to `card_attachments` is verified;
   - physical missing file behavior is controlled and visible to reconciliation.
   - importer/reconciliation preserves these contextual fields or reports exact
     differences; no contextual attachment field is silently dropped.

6. Compatibility boundary:
   - `/api/data` may return compatibility shape, but cards/files slices are
     SQL-derived and read-only/export-only;
   - `/api/data` POST cannot overwrite SQL cards/files;
   - `/api/data` POST rejects or ignores cards/files slices with diagnostic log,
     but does not persist them as authoritative snapshot data;
   - JSON helpers such as `ensureCardsCoreDataReady()` do not mutate authoritative
     cards/files state.
   - `preserveProtectedSlicesForLegacySnapshot()` or equivalent policy explicitly
     protects/rejects cards/files after cutover.

7. Projection guard:
   - cards/lifecycle/files commands do not write `card_flow_projection`;
   - production execution remains the sole writer of production flow state,
     flow events and projection updates;
   - cards repository may only read projection for display.

8. Repository boundary:
   - `CardsRepository`, `CardFilesRepository` and lifecycle boundary own SQL
     business commands;
   - `server.js` handlers only handle auth/permissions/request-response
     orchestration;
   - no raw SQL business command for cards/lifecycle/files is implemented
     directly in route handlers.

Проверь failure conditions. Любой пункт означает FAIL/BLOCKED:
- any card critical write still uses snapshot-save;
- `/api/data` can overwrite SQL cards/files;
- `/api/data` POST preserves cards/files as writable snapshot-owned slices instead
  of enforcing SQL-derived read-only/export-only compatibility;
- card/file metadata can diverge silently from SQL;
- attachment contextual metadata is stored only in loose JSON instead of the
  chosen explicit SQL columns;
- file upload keeps DB transaction open during large transfer/decode;
- stale rev does not return the existing 409 contract;
- conflict redirects to dashboard or loses route;
- card commands/files write `card_flow_projection`;
- raw SQL бизнес-команды разбросаны по `server.js` вместо repository boundary.
- `ensureCardsCoreDataReady()` or another compatibility helper can mutate
  authoritative cards/files state after cutover;
- attachment contextual fields are not covered by migration and repository/API
  mapping;
- importer/reconciliation silently drops contextual attachment metadata;
- live events are emitted before SQL commit.

Обязательные проверки:
- SQL integration: card create/update/archive/repeat/delete success and stale
  `expectedRev -> 409`;
- approval: send/approve/reject/return-to-draft success, invalid stage, stale
  conflict;
- input/provision: success, invalid stage, stale conflict, stage combinations to
  `WAITING_INPUT_CONTROL`, `WAITING_PROVISION`, `PROVIDED`;
- files: upload/delete/resync, stale conflict, duplicate PARTS_DOCS,
  input-control file relink/clear, physical missing file behavior;
- compatibility: `/api/data` cannot overwrite SQL cards/files;
- compatibility helper audit: no `JsonDatabase.update()` cards/files authority
  remains in runtime paths;
- route stability: `/cards`, `/cards/:id`, `/card-route/:qr`, `/approvals`,
  `/input-control`, `/provision`, archive/repeat routes after success and after
  409;
- reconciliation: SQL counts and sample equality for cards, logs, approval
  events, attachments, attachment contextual fields, input-control/provision
  records;
- projection guard: card commands/files do not write `card_flow_projection`.
- repository audit: cards/lifecycle/files SQL writes are owned by repositories,
  not raw route-handler SQL.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 5 PASS/FAIL/BLOCKED.
2. Cards/lifecycle SQL source-of-truth proof.
3. Files SQL metadata and physical reconciliation proof.
4. `/api/data` compatibility proof.
5. Conflict/route preservation proof.
6. Projection guard proof.
7. Repository boundary proof.
8. Tests/checks run.
9. Remaining removal path, if any.
10. Можно ли начинать Stage 6.
```

## Ручная проверка после Prompt

Проверить cards list/detail/create/edit/archive/repeat/delete,
approval/input/provision, file upload/delete/resync/download, F5 на `/cards`,
`/cards/:id`, `/card-route/:qr`, `/approvals`, `/input-control`, `/provision`,
Back/Forward, и two-tab stale conflict.
