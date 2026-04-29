# MySQL 8.4 Migration Plan

Status: Active plan.

Этот документ фиксирует обязательный порядок перехода сайта с текущего
persistence-слоя на промышленную MySQL 8.4 модель, описанную в
[MySQL 8.4 Target Architecture](./mysql-84-target-architecture.md).

План не заменяет [Current Architecture](./current-architecture.md). Переход на
MySQL не должен ломать SPA routing/bootstrap, domain writes, revision/conflict
model, realtime-as-signal, security и business-rules.

Цель плана: получить рабочий production-сайт, где MySQL 8.4 InnoDB является
единственным source of truth для in-scope данных, а 20 одновременных
пользователей могут работать без last-write-wins, silent overwrite, route loss,
ручного восстановления данных или зависимости от realtime для correctness.

---

## 1. Source Documents

Обязательные документы:

- `docs/architecture/current-architecture.md`
- `docs/architecture/current-state.md`
- `docs/architecture/mysql-84-target-architecture.md`
- `docs/architecture/change-checklist.md`
- `docs/business-rules/*.md`
- `AGENTS.md`

Исторический `docs/architecture/migration-plan.md` использовать только как
audit trail завершенной SPA/domain migration. Он не является активным планом
MySQL-перехода.

---

## 2. Non-Negotiable Rules

### MUST

- Переход выполняется маленькими stage/batch шагами.
- Один batch меняет один storage-slice, один infrastructure layer или один
  bounded domain.
- Любой cutover домена на SQL выполняется только после:
  - schema migration;
  - importer/dry-run;
  - validation report;
  - reconciliation report;
  - success-path tests;
  - conflict-path tests;
  - route stability tests;
  - documented rollback path.
- Runtime application uses `tspcc_app` DB user with least privileges.
- Schema migrations use separate migration credentials.
- Production/staging/local DB passwords are generated per environment and kept
  only in env/secret storage.
- Every SQL query uses parameterized statements or safe allowlisted identifiers.
- Every critical write remains a server domain command.
- Every critical write is atomic at SQL transaction level.
- Every competitive write enforces `expectedRev`, `expectedPlanningRev`,
  `expectedFlowVersion` or explicit domain equivalent.
- Stale write returns `409 Conflict`.
- After `409`, client stays on current route and performs targeted refresh.
- Realtime works only over committed SQL state and never confirms correctness.
- File metadata and physical files are backed up, restored and reconciled
  together.
- MySQL migration must preserve all business-rules documents.
- Use dry-run import, reconciliation, controlled cutover and rollback instead
  of keeping JSON and MySQL writable at the same time.

### MUST NOT

- Do not replace `database.json` with one `app_data(json)` table.
- Do not move client snapshot-save into SQL.
- Do not make `/api/data` the primary SQL API.
- Do not introduce dual write-authority for a domain.
- Do not use dual-write as migration strategy.
- Do not change router/bootstrap as part of domain SQL cutover.
- Do not change business semantics to fit an easier schema.
- Do not store production credentials in repository.
- Do not run the site as MySQL `root`.
- Do not change production schema manually on VDS.
- Do not count a domain as migrated without conflict-path tests and
  reconciliation.
- Do not cut over production without tested restore of both SQL and files.

---

## 3. In Scope

Persistence migration scope:

- cards
- approvals / input control / provision
- card files metadata
- directories
- users / access levels / sessions / CSRF state where persisted
- production schedule / plan / shifts / gantt
- workspace / production execution / flow history
- delayed / defects / repair / dispose
- workorders / archive / items / ok / oc read models
- messaging / profile / notifications
- webpush / FCM token storage
- user actions / audit trail
- realtime event source over committed SQL state
- SQL migrations
- JSON import and reconciliation
- backup / restore / monitoring
- test fixtures and CI/local test database setup

Out of scope unless explicitly approved:

- redesign of business workflows;
- new UI feature work unrelated to SQL cutover;
- changing route names;
- changing auth/navigation semantics;
- changing file storage provider, unless required for reliable backup and
  restore;
- replacing the entire server framework;
- introducing a heavy ORM as a goal by itself.

---

## 4. Target Production Baseline

Minimum production baseline after completion:

- MySQL version: 8.4 LTS.
- Engine: InnoDB.
- Charset: `utf8mb4`.
- Default collation: `utf8mb4_0900_ai_ci`.
- Exact identifiers/tokens/hashes: binary-safe collation or binary columns.
- Timestamps: UTC, preferably `DATETIME(3)`.
- Runtime DB user: `tspcc_app`.
- Migration DB user: separate user with schema migration privileges.
- Connection pooling with bounded pool size.
- No direct SQL from client.
- Versioned schema migrations stored in repository.
- `schema_migrations` table records applied migrations.
- MySQL dump backup plus file storage backup with matching manifest.
- Tested restore rehearsal before production cutover.
- Monitoring/diagnostics for:
  - connection pool exhaustion;
  - slow queries;
  - deadlocks;
  - lock wait timeouts;
  - failed migrations;
  - failed backups;
  - failed restore rehearsal.

20-user production readiness target:

- 20 authenticated users can perform normal mixed work concurrently.
- No write is lost under concurrent edits.
- Conflict scenarios return controlled `409`.
- UI route remains stable after conflict.
- Critical route refresh does not load the whole site as the default path.
- Connection pool does not exhaust during representative 20-user scenario.
- No long transaction holds locks during file transfer, SSE, upload/download or
  external network call.

---

## 5. Target Repository Layout

The implementation may adjust exact names to current codebase conventions, but
the final structure must preserve these responsibilities.

Required repository areas:

- `server/persistence/mysql/` or equivalent:
  - connection pool;
  - transaction helper;
  - migration runner integration;
  - SQL diagnostics helpers.
- `server/repositories/` or equivalent:
  - cards repository;
  - card files repository;
  - directories repository;
  - security repository;
  - production planning repository;
  - production execution repository;
  - messaging/profile/notifications repository;
  - audit/outbox repository.
- `migrations/mysql/` or equivalent:
  - versioned forward SQL migrations;
  - no production auto-schema mutation on server boot.
- `scripts/mysql/` or equivalent:
  - import from JSON;
  - validation;
  - reconciliation;
  - backup;
  - restore rehearsal helpers.
- `tests/`:
  - SQL integration tests;
  - import/reconciliation tests;
  - post-cutover E2E;
  - conflict tests;
  - 20-user smoke/load scenario.

Forbidden repository shape:

- SQL string fragments scattered randomly through `server.js`.
- Schema stored only in README/comments.
- Test schema that does not use production-like migrations.
- Runtime app requiring `CREATE`, `ALTER`, `DROP` privileges.

---

## 6. Data Ownership Map

This map must be completed in Stage 0 and enforced by all later stages.

| Domain | SQL owner | Notes |
|---|---|---|
| Cards | cards repository | Owns `cards.rev`, card details, approval lifecycle fields if not split into sub-aggregate. |
| Card approval/input/provision | cards repository or card lifecycle repository | Must preserve stage semantics and audit logs. |
| Card files metadata | card files repository | Physical files remain filesystem/object storage; metadata is SQL. |
| Directories | directories repository | Owns departments/centers, operations, areas, employees assignment, shift times. |
| Security | security repository | Owns users, access levels, permissions, sessions/CSRF if persisted. |
| User actions | messaging/profile/audit boundary | Single table/model. Other domains append via shared audit/outbox boundary. |
| Production planning | production planning repository | Owns planning revisions independent from unrelated writes. |
| Production execution | production execution repository | Authoritative source for flow version, flow history, delayed/defect/repair/dispose. |
| Card-facing flow projection | read model/projection | Not a second source of truth. Derived from production execution. |
| Derived views | read model/query layer | Workorders/archive/items/ok/oc derive from cards + production. |
| Messaging/profile/notifications | messaging/profile repository | Owns chat, read states, push subscriptions, FCM tokens. |
| Realtime events | outbox/live event boundary | Events emitted only after commit. |

No domain may have two authoritative SQL owners.

---

## 7. Compatibility Policy

During migration, compatibility is allowed only as bounded infrastructure.

Allowed:

- read-only compatibility adapter for a domain after SQL cutover;
- export endpoint for diagnostics/migration verification;
- temporary compatibility read shape returned by domain endpoint;
- dual-read comparison during dry run, before production authority changes;

Forbidden:

- client snapshot-save as SQL write path;
- `/api/data` as primary SQL endpoint;
- JSON and MySQL both accepting authoritative writes for same domain after
  cutover;
- dual-write as planned migration strategy;
- compatibility adapter without removal path;
- compatibility adapter used for new product features;
- hidden back-sync from SQL to JSON as correctness mechanism.

Every compatibility adapter must declare:

- owner;
- source of truth;
- allowed operations;
- removal condition;
- tests proving it is read-only when applicable;
- diagnostics.

---

## 8. Mandatory Order

1. Stage 0. SQL Readiness Inventory
2. Stage 1. MySQL Platform and Operations Baseline
3. Stage 2. SQL Persistence Foundation
4. Stage 3. Schema Design and Migration Runner
5. Stage 4. JSON Import, Validation and Reconciliation Dry Run
6. Stage 5. Cards, Approval and Card Files SQL Cutover
7. Stage 6. Directories and Security SQL Cutover
8. Stage 7. Production Planning SQL Cutover
9. Stage 8. Production Execution and Workspace SQL Cutover
10. Stage 9. Derived Views SQL Read Model Cutover
11. Stage 10. Messaging, Profile and Notifications SQL Cutover
12. Stage 11. Realtime, Audit and Outbox Finalization
13. Stage 12. Remove JSON Snapshot Authority
14. Stage 13. Production Cutover Rehearsal
15. Stage 14. Production Cutover
16. Stage 15. Post-Cutover Hardening and 20-User Proof

Reasoning:

- Infrastructure and operational safety come before domain cutover.
- Schema/import/reconciliation must exist before any production authority change.
- Cards/files come early because many domains depend on cards.
- Directories/security come before production because production depends on
  areas, operations, users and permissions.
- Planning comes before execution because workspace depends on planned shifts.
- Derived views come after cards and production source domains.
- Messaging/profile can be cut over after security user identity is SQL-backed.
- JSON authority is removed only after all critical domains have SQL authority.
- Production cutover happens only after rehearsal, backup/restore and rollback
  plan are proven.

---

## 9. What Must Not Be Combined

Do not combine in one batch:

- router/bootstrap changes and SQL persistence changes;
- MySQL platform install and domain cutover;
- schema migration runner and cards cutover;
- cards cutover and production execution cutover;
- directories/security cutover and production planning cutover;
- production planning and production execution cutover;
- messaging cutover and realtime/outbox rewrite;
- file upload implementation and long-running backup redesign;
- JSON authority removal and first production SQL cutover;
- performance cache work and correctness migration;
- production cutover and destructive cleanup.

---

## 10. Stage 0. SQL Readiness Inventory

Goal:

- Produce exact current data inventory and migration perimeter.

Inputs:

- current JSON database shape;
- storage/card files tree;
- current domain APIs;
- current E2E fixtures;
- business-rules documents.

Required work:

- Inventory every JSON top-level field and nested domain-relevant field.
- Map each field to:
  - SQL domain/table;
  - owner repository;
  - migration rule;
  - compatibility status;
  - removal condition.
- Inventory physical files:
  - card folder/key;
  - attachment metadata;
  - missing file;
  - orphan file;
  - duplicate name constraints;
  - checksum/size if available.
- Identify duplicate-key anomalies and inconsistent casing.
- Identify broken references:
  - card -> directory;
  - card -> user;
  - production task -> card/operation/area/shift;
  - message -> user/conversation;
  - attachment -> card/file.
- Identify all current read paths that still depend on scoped/full snapshot.
- Identify all compatibility adapters and their removal path.
- Produce domain cutover risk classification:
  - low risk;
  - medium risk;
  - high risk;
  - requires rehearsal before implementation.

Exit criteria:

- Inventory report exists.
- `JSON field -> SQL table/domain` mapping exists.
- File metadata reconciliation baseline exists.
- Broken reference report exists.
- Duplicate/anomaly report exists.
- Business invariant list for importer validation exists.
- No implementation cutover is started in this stage.

Failure conditions:

- Any top-level JSON field lacks owner.
- Files are not inventoried.
- Production flow references are not mapped.
- Messaging/profile compatibility fields are not classified.

---

## 11. Stage 1. MySQL Platform and Operations Baseline

Goal:

- Prepare production-grade MySQL platform without changing application behavior.

Required work:

- Install/provision MySQL 8.4 LTS for local/staging/production-like test.
- Create database `tspcc_bd`.
- Create runtime user `tspcc_app` with least privileges.
- Create separate migration/admin user.
- Configure secrets through env/secret storage:
  - `TSPCC_DB_HOST`
  - `TSPCC_DB_PORT`
  - `TSPCC_DB_NAME`
  - `TSPCC_DB_USER`
  - `TSPCC_DB_PASSWORD`
  - `TSPCC_DB_CONNECTION_LIMIT`
  - `TSPCC_DB_SSL`
  - migration credentials.
- Confirm `.env` and secret files are ignored.
- Configure MySQL defaults:
  - InnoDB;
  - `utf8mb4`;
  - `utf8mb4_0900_ai_ci`;
  - UTC timestamp contract.
- Define connection limit baseline for 20 users.
- Define RPO/RTO.
- Add backup script/process for:
  - `mysqldump`;
  - file storage archive/snapshot;
  - manifest generation.
- Add restore rehearsal procedure for test environment.
- Add operational diagnostics plan for `[DB]` and `[PERF][DB]`.

Exit criteria:

- MySQL 8.4 is reachable in local/test environment.
- Runtime user cannot `CREATE`, `ALTER`, `DROP`.
- Migration user can apply migrations.
- Secrets are not committed.
- Backup and restore rehearsal commands/procedure are documented.
- No application domain reads/writes use MySQL as source of truth yet.

Failure conditions:

- Runtime app requires root/admin DB credentials.
- Password is committed.
- Backup covers SQL but not files.
- Restore procedure is not testable.

---

## 12. Stage 2. SQL Persistence Foundation

Goal:

- Add SQL infrastructure behind a single persistence boundary without domain
  cutover.

Required work:

- Add MySQL driver/pool integration.
- Add connection pool helper.
- Add transaction helper:
  - begin;
  - commit;
  - rollback;
  - deadlock/lock timeout classification;
  - controlled retry only for idempotent operations.
- Add query helper:
  - parameterized values;
  - allowlisted dynamic identifiers;
  - no raw user input interpolation.
- Add repository base pattern.
- Add conflict helper for SQL commands:
  - `409`;
  - `entity`;
  - `id`;
  - `expectedRev`;
  - `actualRev`;
  - user-safe message.
- Add `[DB]` diagnostics:
  - query path;
  - domain;
  - duration bucket;
  - transaction result;
  - deadlock/timeout classification.
- Add test database setup that uses migrations, not hand-written schema drift.

Exit criteria:

- SQL foundation can connect, run a simple health query and close cleanly.
- Integration tests cover transaction commit/rollback.
- SQL injection review passes for helper API shape.
- No domain source of truth changed.

Failure conditions:

- Raw SQL helpers encourage string concatenation with user input.
- Transaction helper allows partial commit inside a business command.
- Server boot silently changes production schema.

---

## 13. Stage 3. Schema Design and Migration Runner

Goal:

- Introduce versioned SQL schema migrations for all target domains.

Required work:

- Add migration runner.
- Add `schema_migrations` table.
- Add initial migrations for:
  - cards;
  - card operations/serials/quantities;
  - card approval/input/provision/logs;
  - card attachments metadata;
  - directories;
  - users/access levels/permissions;
  - sessions/CSRF if persisted;
  - production planning;
  - production execution/flow events;
  - delayed/defects/repair/dispose;
  - messaging/profile/notifications;
  - audit/user actions;
  - outbox/live events.
- Add foreign keys where they represent hard invariants.
- Add application guards where FK would violate historical text preservation.
- Add unique indexes for stable business invariants.
- Add query indexes based on real route/read patterns.
- Add explicit `rev` columns for mutable aggregate roots.
- Add `created_at`, `updated_at` where applicable.
- Add `deleted_at` for soft-delete entities where business semantics require it.
- Add migration descriptions:
  - purpose;
  - domain;
  - business impact;
  - rollback/restore expectation.

Exit criteria:

- Migrations run from empty DB to complete schema.
- Re-running migration runner is idempotent through migration history.
- Test DB schema is created only by migrations.
- Runtime user cannot apply migrations.
- Schema review verifies there is no single big JSON table final model.

Failure conditions:

- `CREATE TABLE IF NOT EXISTS` is the only migration history.
- Cards/users/production/messages are stored as arrays inside one JSON column.
- A destructive migration lacks backup/restore plan.

---

## 14. Stage 4. JSON Import, Validation and Reconciliation Dry Run

Goal:

- Prove repeatable import from current JSON/files into SQL without production
  authority change.

Required work:

- Build importer that reads current JSON database snapshot.
- Build file metadata importer/reconciler.
- Validate before import:
  - required IDs;
  - duplicate IDs;
  - duplicate-key anomalies;
  - encoding issues;
  - invalid statuses/stages;
  - invalid revisions;
  - broken references;
  - orphan attachments metadata;
  - physical file mismatch;
  - production flow consistency.
- Import into clean test SQL DB.
- Preserve IDs unless explicit compatibility mapping exists.
- Preserve business-significant history/logs.
- Generate reconciliation report:
  - counts by table/domain;
  - source JSON counts;
  - SQL counts;
  - sample equality checks;
  - broken references;
  - skipped fields;
  - converted fields;
  - warnings requiring manual decision;
  - file metadata vs physical files summary.
- Add automated pre/post comparison checks.
- Add rollback expectation for dry run.

Exit criteria:

- Import can run repeatedly in test environment.
- Reconciliation report is generated automatically.
- Critical domain counts match or have explicit documented conversion.
- File metadata reconciliation passes or blockers are documented.
- No production source of truth changed.

Failure conditions:

- Unknown fields are silently dropped.
- IDs change without compatibility mapping.
- Import fixes data without report.
- File mismatches are ignored.

---

## 15. Stage 5. Cards, Approval and Card Files SQL Cutover

Goal:

- Move card aggregate, lifecycle and file metadata to SQL source of truth.

Included:

- cards list/detail reads;
- create/update/delete/archive/repeat;
- approval send/approve/reject/return-to-draft;
- input control;
- provision;
- card logs;
- approval thread;
- attachments metadata;
- upload/delete/resync metadata transaction.

Required work:

- Implement cards repository.
- Implement card files repository.
- Move card commands to SQL transaction.
- Enforce `cards.rev` / domain-specific rev.
- Preserve lifecycle:
  `DRAFT -> ON_APPROVAL -> REJECTED/APPROVED -> WAITING_* -> PROVIDED -> PLANNING -> PLANNED`.
- Preserve reject reason and audit logs.
- Preserve archive as soft-state.
- Preserve repeat as new draft card.
- Preserve delete cleanup of dependent production references where allowed by
  business rules.
- Ensure file operations update SQL metadata and card revision in controlled
  command.
- Ensure DB transaction is not held during large file transfer.
- Add read-only compatibility adapter only if needed, with removal path.
- Add tests:
  - create/edit success;
  - stale edit `409`;
  - approval send/approve/reject conflict;
  - input/provision success and conflict;
  - file upload/delete/resync;
  - duplicate `PARTS_DOCS`;
  - route stability after conflict;
  - direct URL/F5 on `/cards/:id`;
  - reconciliation for cards/files.

Exit criteria:

- Cards and card files source of truth is SQL.
- JSON/snapshot cannot overwrite cards.
- Attachments metadata is SQL-backed.
- Physical files reconcile with SQL metadata.
- All card critical writes return controlled result or `409`.
- `/api/data` no longer owns cards.

Failure conditions:

- Any card critical write uses snapshot-save.
- Card file metadata can diverge silently from SQL.
- Conflict redirects user to dashboard or loses route.

---

## 16. Stage 6. Directories and Security SQL Cutover

Goal:

- Move directories, users, access levels and security-related persistent state
  to SQL source of truth.

Included:

- departments/centers;
- operations;
- areas;
- employee assignments;
- shift times;
- users;
- access levels;
- permissions;
- landing tab;
- inactivity timeout;
- sessions/CSRF if persisted.

Required work:

- Implement directories repository.
- Implement security repository.
- Enforce guards:
  - department delete with employees;
  - department/operation used by cards;
  - operation type conflicts with active production;
  - area delete with current planning/execution;
  - historical text preservation.
- Implement user/access level SQL commands.
- Preserve `Abyss` protection.
- Preserve password hash/salt compatibility.
- Preserve password validation and uniqueness.
- Preserve `landingTab`, inactivity timeout and profile access rules.
- Ensure permissions are server-enforced before SQL write.
- Add tests:
  - directory create/edit/delete guards;
  - operation type conflict;
  - area delete guard;
  - users create/edit/delete;
  - access level edit;
  - `Abyss` protection;
  - password validation/uniqueness;
  - landing tab;
  - inactivity timeout;
  - direct URL/F5 on `/users`, `/accessLevels`, `/profile/:id`;
  - conflict-path for mutable entities.

Exit criteria:

- Directories/security source of truth is SQL.
- JSON/snapshot cannot overwrite migrated directories/security slices.
- Permissions and route visibility remain unchanged.
- Business guards pass from SQL state.

Failure conditions:

- Any directory/security critical write uses snapshot-save.
- `Abyss` can be deleted/degraded.
- Historical card text is lost by directory mutation.

---

## 17. Stage 7. Production Planning SQL Cutover

Goal:

- Move production planning source of truth to SQL while preserving current
  planning behavior.

Included:

- production schedule;
- production plan;
- production shifts;
- shift tasks as planning objects;
- gantt read model;
- planning revisions.

Required work:

- Implement production planning repository.
- Define planning aggregate revisions:
  - per aggregate, or
  - `production_planning_rev` updated only by planning mutations.
- Move planning commands into SQL transactions.
- Preserve planning visibility rules:
  - non-archived `MKI`;
  - valid operations;
  - `PROVIDED`/`PLANNING`/`PLANNED` semantics.
- Ensure unrelated users/messages/cards outside planning do not invalidate
  planning expected revision.
- Add route-local production refresh.
- Add tests:
  - schedule changes;
  - plan assignment;
  - shift creation/update;
  - gantt read;
  - stale planning `409`;
  - direct URL/F5 on `/production/plan`, `/production/schedule`,
    `/production/shifts/:key`, `/production/gantt/:...`;
  - unrelated write does not create stale planning conflict;
  - reconciliation for planning tables.

Exit criteria:

- Planning source of truth is SQL.
- Planning revision is SQL-enforced.
- JSON/snapshot cannot overwrite planning.
- Planning route behavior unchanged.

Failure conditions:

- Planning conflict uses global snapshot revision.
- Planning correctness depends on local shadow state.
- Planning writes go through `/api/data`.

---

## 18. Stage 8. Production Execution and Workspace SQL Cutover

Goal:

- Move execution/workspace source of truth to SQL.

Included:

- workspace;
- personal operations;
- start/pause/resume/reset/complete;
- identify;
- transfer;
- material issue/return;
- drying;
- delayed;
- defects;
- repair;
- dispose;
- flow history;
- `expectedFlowVersion`.

Required work:

- Implement production execution repository.
- Make execution tables authoritative for:
  - flow state;
  - flow version;
  - flow events/history;
  - delayed/defect/repair/dispose.
- Ensure card-facing flow fields are projection/read model only.
- Move execution commands to SQL transactions.
- Preserve blocking rules:
  - previous operations;
  - samples;
  - drying;
  - material;
  - OK/OC/items statuses.
- Preserve `expectedFlowVersion -> 409`.
- Add targeted workspace/production refresh.
- Add tests:
  - start/pause/resume/reset/complete;
  - identify;
  - transfer;
  - material issue/return;
  - drying;
  - delayed;
  - defect;
  - repair;
  - dispose;
  - stale flow version `409`;
  - route stability on `/workspace` and `/workspace/:qr`;
  - two-tab conflict;
  - reconciliation for execution history.

Exit criteria:

- Production execution source of truth is SQL.
- Flow version is SQL-enforced.
- Flow history is preserved.
- Workspace conflict behavior unchanged.
- Realtime is not required for correctness.

Failure conditions:

- Flow state has two authoritative models.
- Execution writes update projection without authoritative transaction.
- Any critical execution action bypasses SQL domain command.

---

## 19. Stage 9. Derived Views SQL Read Model Cutover

Goal:

- Move workorders/archive/items/ok/oc reads to SQL source domains/read models.

Included routes:

- `/workorders`
- `/workorders/:qr`
- `/archive`
- `/archive/:qr`
- `/items`
- `/ok`
- `/oc`

Required work:

- Implement SQL query/read model layer for derived views.
- Ensure no derived view has independent write authority.
- Preserve archive semantics.
- Preserve repeat from archive as card command creating new draft.
- Preserve detail route stability.
- Preserve items/ok/oc consistency with production flow.
- Add tests:
  - workorders list/detail;
  - archive list/detail;
  - repeat from archive;
  - items/ok/oc after source domain changes;
  - direct URL/F5 for detail routes;
  - no derived write bypass.

Exit criteria:

- Derived views read from SQL source domains/read models.
- No legacy source-model assumption remains for these routes.
- No new write path is introduced.

Failure conditions:

- Derived view owns separate mutable state.
- Archive repeat mutates archived card instead of creating new draft.
- Detail route loses card context.

---

## 20. Stage 10. Messaging, Profile and Notifications SQL Cutover

Goal:

- Move chat/profile/notifications persistent state to SQL.

Included:

- conversations;
- messages;
- participants;
- delivered/read/unread;
- user actions;
- user visits;
- webpush subscriptions;
- FCM tokens;
- deeplinks.

Required work:

- Implement messaging/profile repository.
- Make `/api/chat/*` SQL-backed primary stack.
- Ensure `/api/messages/*` does not return as parallel stack.
- Make `user_actions` single owner model in profile/audit boundary.
- Store push subscriptions and FCM tokens in SQL with user ownership.
- Preserve profile privacy.
- Preserve no-system-user dialog rule.
- Preserve optimistic send rollback.
- Add tests:
  - open own profile;
  - reject other profile;
  - direct chat send;
  - delivered/read/unread;
  - deeplink `openChatWith` / `conversationId`;
  - webpush subscribe/unsubscribe/test;
  - FCM token subscribe;
  - no `/api/messages/*` parallel write stack;
  - SQL reconciliation for messages/profile.

Exit criteria:

- Messaging/profile/notifications source of truth is SQL.
- Snapshot chat fields are removed or read-only archived with removal criteria.
- Delivered/read/unread behavior preserved.

Failure conditions:

- Two equal messaging stacks exist.
- User can open another user's profile.
- Push tokens are not user-owned.

---

## 21. Stage 11. Realtime, Audit and Outbox Finalization

Goal:

- Ensure realtime and audit behavior runs over committed SQL state.

Required work:

- Implement outbox table or equivalent reliable post-commit signal.
- Ensure domain commands create audit/outbox events inside the same transaction
  where required.
- Emit live events only after commit.
- Standardize live payload:
  - domain;
  - entity;
  - id;
  - rev/version;
  - event type;
  - timestamp.
- Ensure live only signals targeted refresh.
- Preserve `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]` diagnostics.
- Add tests:
  - live event after commit;
  - no live event on rolled back transaction;
  - multi-client refresh;
  - realtime unavailable fallback;
  - no correctness dependency on live.

Exit criteria:

- Realtime reflects committed SQL state.
- Audit/outbox path is consistent across domains.
- No domain requires realtime for correctness.

Failure conditions:

- Live event is sent before commit as write confirmation.
- Failed transaction emits success refresh.
- Client correctness depends on SSE.

---

## 22. Stage 12. Remove JSON Snapshot Authority

Goal:

- Remove remaining authoritative role of `database.json` and snapshot API.

Required work:

- Remove or disable critical writes through `/api/data`.
- Remove `saveData()` as application write path.
- Remove JSON as authoritative storage.
- Keep JSON export only if explicitly non-authoritative diagnostic/export.
- Replace full snapshot fixtures with SQL seed/migration fixtures.
- Remove compatibility adapters whose removal criteria are met.
- Verify post-cutover compatibility adapters are read-only.
- Add tests:
  - no application caller of snapshot-save;
  - `/api/data` not primary read/write API;
  - migrated domains cannot be overwritten by JSON payload;
  - fixtures use SQL seed path;
  - app boots/routes from SQL-backed reads.

Exit criteria:

- MySQL is only source of truth for in-scope data.
- `database.json` is not authoritative.
- `/api/data` is removed or explicitly non-authoritative diagnostic/export.
- Client no longer depends on full snapshot payload.

Failure conditions:

- Any critical write can still persist through JSON snapshot.
- JSON and MySQL both accept authoritative writes.
- Fixture/test setup hides SQL migration failures.

---

## 23. Stage 13. Production Cutover Rehearsal

Goal:

- Prove complete cutover before touching production authority.

Required work:

- Freeze a production-like JSON snapshot and file storage copy.
- Restore into staging/test environment.
- Run full SQL migrations.
- Run importer.
- Run reconciliation.
- Run full E2E suite.
- Run SQL integration tests.
- Run backup and restore rehearsal:
  - SQL dump;
  - file storage backup;
  - manifest;
  - restore into clean environment;
  - smoke tests after restore.
- Run 20-user representative scenario.
- Validate operational runbook:
  - pre-cutover backup;
  - cutover commands;
  - rollback decision point;
  - rollback commands;
  - post-cutover checks;
  - monitoring checks.
- Define cutover window and owner.

Exit criteria:

- Rehearsal completes from clean environment.
- Reconciliation passes.
- Restore rehearsal passes.
- 20-user scenario passes.
- Rollback procedure is executable and documented.
- No unresolved blocker remains.

Failure conditions:

- Manual DB edits are required for rehearsal success.
- Restore works for SQL but not files.
- Load scenario exhausts pool or creates data loss.
- Rollback is not executable.

---

## 24. Stage 14. Production Cutover

Goal:

- Switch production source of truth to MySQL safely.

Required work:

- Announce/prepare maintenance window if needed.
- Stop or quiesce writes according to runbook.
- Take final JSON backup.
- Take final file storage backup.
- Create final backup manifest.
- Apply SQL migrations.
- Run final import.
- Run final reconciliation.
- Start application with MySQL-backed persistence.
- Run post-cutover smoke:
  - login/session restore;
  - direct URL/F5;
  - cards list/detail/edit conflict smoke;
  - files availability smoke;
  - directories/security smoke;
  - production planning smoke;
  - workspace smoke;
  - messaging/profile smoke;
  - realtime fallback smoke.
- Monitor:
  - `[DB]`;
  - slow queries;
  - deadlocks;
  - lock wait timeouts;
  - pool metrics;
  - application errors.
- Keep rollback window until post-cutover acceptance passes.

Exit criteria:

- Production runs on MySQL source of truth.
- JSON is not authoritative.
- Post-cutover smoke passes.
- No data reconciliation blocker.
- Backups and restore point are retained.
- Monitoring shows no critical SQL/pool issue.

Failure conditions:

- Reconciliation fails without approved explanation.
- Core route/auth breaks.
- Critical writes fail broadly.
- Files are unavailable after cutover.
- Rollback criteria are met.

---

## 25. Stage 15. Post-Cutover Hardening and 20-User Proof

Goal:

- Prove stable production readiness after cutover and remove remaining temporary
  compatibility.

Required work:

- Run full E2E after cutover.
- Run 20-user representative scenario against production-like environment.
- Review slow query logs and `[PERF][DB]`.
- Review connection pool metrics.
- Review deadlocks/lock waits.
- Tune indexes only based on measured query patterns.
- Remove remaining read-only compatibility adapters whose removal criteria are
  met.
- Confirm backup schedule and first successful post-cutover restore rehearsal.
- Confirm credential rotation procedure exists.
- Confirm no production schema drift outside migrations.
- Update current-state and architecture docs if implementation decisions changed
  the documented persistence shape.

Exit criteria:

- 20-user scenario passes without pool exhaustion, silent overwrite or route
  loss.
- Slow queries have owner and fix/acceptance decision.
- Backups are automated and restorable.
- Restore rehearsal passes after cutover.
- Remaining compatibility adapters are either removed or documented read-only
  with owner/date/removal criteria.
- MySQL target architecture Definition of Done is satisfied.

Failure conditions:

- Performance issue is masked by client cache instead of SQL/read model fix.
- Compatibility adapter remains writable.
- Backups run but restore is untested.
- SQL schema changes occur manually outside migration history.

---

## 26. Global Test Plan

Required test groups:

- SQL foundation:
  - connection;
  - transaction commit/rollback;
  - deadlock/timeout classification;
  - migration runner.
- Import/reconciliation:
  - JSON validation;
  - SQL import;
  - domain counts;
  - broken references;
  - file metadata/physical file matching.
- Routing/bootstrap:
  - direct URL;
  - F5;
  - Back/Forward;
  - protected render after session restore.
- Cards:
  - create;
  - edit;
  - delete;
  - archive;
  - repeat;
  - approval;
  - input control;
  - provision;
  - files;
  - stale `expectedRev`.
- Directories/security:
  - guards;
  - users/access levels;
  - `Abyss`;
  - password validation;
  - landing tab;
  - inactivity timeout.
- Production:
  - planning;
  - shifts;
  - workspace;
  - execution actions;
  - delayed/defects/repair/dispose;
  - stale `expectedFlowVersion`.
- Derived views:
  - workorders;
  - archive;
  - items;
  - ok;
  - oc.
- Messaging/profile:
  - profile privacy;
  - chat send/read/delivered;
  - deeplink;
  - push/FCM.
- Realtime:
  - committed event;
  - rollback no-event;
  - unavailable fallback.
- Backup/restore:
  - SQL dump restore;
  - file storage restore;
  - manifest verification.
- Load/concurrency:
  - 20-user representative scenario;
  - two-tab conflict;
  - pool metrics;
  - slow query review.

---

## 27. 20-User Representative Scenario

The exact automation tool may be Playwright, k6, Artillery or another agreed
tool, but the scenario must represent real app usage.

Minimum scenario mix:

- 4 users browsing cards and opening card details.
- 3 users editing different cards.
- 2 users attempting concurrent edit on same card to prove `409`.
- 2 users performing approval/input/provision actions.
- 2 users editing directories/security settings with permission checks.
- 3 users using production planning/workspace flows.
- 2 users using workorders/archive/items/ok/oc views.
- 2 users using profile/chat/notifications.

Acceptance:

- no silent overwrite;
- expected conflicts return `409`;
- users remain on current route after conflict;
- no forced redirect to dashboard;
- no pool exhaustion;
- no unbounded full snapshot reload as default refresh;
- no transaction held during file transfer/SSE;
- p95 route/domain refresh is measured and reviewed;
- slow SQL paths have owner before final acceptance.

---

## 28. Rollback Policy

Before production cutover:

- rollback means continue using existing JSON persistence.
- SQL dry-run data can be discarded and recreated.

During production cutover:

- rollback decision must happen inside the defined cutover window.
- rollback restores previous app version/config and JSON/file state from final
  pre-cutover backup.

After MySQL is production source of truth:

- rollback is a restore operation from verified MySQL dump + file storage backup
  manifest, not a silent back-sync to JSON.
- If JSON export is retained, it is diagnostic/export only and not rollback
  authority unless explicitly approved in a separate disaster recovery plan.

Rollback triggers:

- failed final reconciliation;
- auth/session failure across protected routes;
- broad domain write failure;
- file attachments unavailable;
- uncontrolled data corruption;
- inability to restore required backup set;
- severe pool/DB failure that blocks normal work and cannot be fixed inside the
  cutover window.

---

## 29. Global Exit Criteria

MySQL migration is complete only if all conditions hold:

- MySQL 8.4 InnoDB is source of truth for all in-scope data.
- Runtime app uses least-privileged DB user.
- Production/staging/local credentials are env/secret-managed and not committed.
- Schema migrations are versioned and recorded in migration history.
- Server boot does not silently mutate production schema.
- Critical writes are server domain commands.
- Critical writes are SQL-transactional.
- Critical mutable entities/aggregates have revision/version control.
- Stale writes return `409`.
- Route remains stable after conflict.
- Realtime depends on committed SQL state and is not required for correctness.
- `/api/data` is not authoritative.
- `database.json` is not authoritative.
- File metadata is SQL-backed and reconciled with physical files.
- Backup/restore covers SQL and files.
- Restore rehearsal has passed.
- 20-user representative scenario has passed.
- Business-rules are preserved.
- Current architecture invariants are preserved.
- No unresolved compatibility adapter remains writable.
- Monitoring/diagnostics exist for SQL production operation.

---

## 30. Definition Of Failure

Migration is not complete if any condition below exists:

- Any critical write uses snapshot-save.
- Any domain has JSON and SQL as equal write-authority.
- MySQL stores the whole site as one JSON blob final model.
- `/api/data` is primary SQL API.
- Runtime app requires root/admin DB credentials.
- Production schema is changed manually outside migration history.
- Conflict writes silently merge or overwrite.
- Realtime is required for correctness.
- Files can exist without SQL metadata or SQL metadata can exist without
  detected file availability.
- Backup excludes file storage.
- Restore has not been tested.
- 20 concurrent representative users cause data loss, uncontrolled errors or
  pool exhaustion.
- Business semantics are changed only to simplify SQL schema.
