# MySQL 8.4 Stage 13 Batch 1 Production Cutover Rehearsal Runbook

Status: PASS for rehearsal planning.

Этот runbook готовит production-like rehearsal для MySQL 8.4 Stage 13. Он не
запускает production cutover, не меняет production authority и не разрешает
destructive actions вне clean staging/test environment.

## 1. Rehearsal Runbook

### Goal

Доказать, что production cutover можно выполнить из чистой staging/test среды по
воспроизводимому сценарию:

- production-like JSON snapshot и file storage copy используются только как
  import source;
- после SQL seed/import runtime authority принадлежит MySQL;
- reconciliation, backup, restore, smoke, E2E и 20-user сценарий проходят без
  ручных правок БД;
- rollback decision points и rollback команды исполнимы до Stage 14.

### Non-Goals

- Не менять production data.
- Не переключать production source of truth.
- Не выполнять production schema changes.
- Не восстанавливать backup в production или VDS.
- Не использовать `database.json` как runtime authority после SQL import.

### Rehearsal Phases

| Phase | Owner | Entry gate | Exit gate |
|---|---|---|---|
| 0. Freeze inputs | Cutover lead + data owner | Stage 12 Batch 6 PASS | Immutable JSON/file copy and input manifest exist |
| 1. Clean staging/test | Ops owner | Inputs frozen | Empty staging DB and isolated card storage ready |
| 2. Migrations/import | DB owner | Staging env ready | Migrations and import complete with reconciliation report |
| 3. Runtime smoke | QA owner | Import PASS/WARN accepted | Route/domain smoke PASS |
| 4. Full E2E/SQL | QA owner | Smoke PASS | SQL + E2E suites PASS |
| 5. Backup/restore | Ops owner | Reconciliation PASS | SQL dump + files restore rehearsal PASS |
| 6. 20-user scenario | QA + cutover lead | Restore rehearsal PASS | No pool exhaustion, data loss or route loss |
| 7. Acceptance pack | Cutover lead | All checks complete | Stage 13 Batch 2 artifacts ready for Batch 3 acceptance |

## 2. Required Inputs

### Stage Gates

| Gate | Status | Required proof |
|---|---|---|
| Stage 6 Batch 3 directories/security SQL cutover | PASS | `DirectoriesRepository` / `SecurityRepository`; no JSON/snapshot overwrite for `ops`, `centers`, `areas`, `productionShiftTimes`, `users`, `accessLevels`; smoke covers guards, users/access levels, `Abyss`, passwords, `landingTab`, inactivity timeout and profile route. |
| Stage 10 Batch 5 messaging/profile/notifications SQL cutover | PASS | `docs/architecture/mysql-84-stage10-batch5-acceptance.md`; `/api/chat/*` primary stack; `/api/messages/*` absent; WebPush/FCM user-owned; compatibility snapshot read-only. |
| Stage 11 Batch 4 realtime/audit/outbox finalization | PASS | `docs/architecture/mysql-84-stage11-batch4-acceptance.md`; `audit_events` / `outbox_events` runtime paths active; post-commit live events only; no SSE correctness dependency. |
| Stage 12 Batch 6 JSON authority removal | PASS | Current repository proof: versions `0.17.35`-`0.17.38`, `tests/sql/stage12-snapshot-read-cutover.test.js`, `tests/e2e/28.stage13-removal-path-contract.spec.js`, and `tests/e2e/SQL_SEED.md`. Batch 2 must re-run these checks in clean rehearsal runtime. |

If any gate cannot be re-proven in clean staging/test, Stage 13 Batch 2 is
`BLOCKED`.

### Production-Like Inputs

- Frozen JSON snapshot copy: `rehearsal-inputs/<rehearsalId>/database.json`.
- Frozen card file storage copy: `rehearsal-inputs/<rehearsalId>/cards/`.
- Input manifest: app version, git commit, source timestamp, JSON SHA256, file
  count, total bytes, aggregate SHA256, owner sign-off.
- Env/secrets for staging/test only:
  - `TSPCC_SQL_TEST=1`
  - `TSPCC_DB_HOST`
  - `TSPCC_DB_PORT`
  - `TSPCC_DB_NAME`
  - `TSPCC_DB_USER`
  - `TSPCC_DB_PASSWORD`
  - `TSPCC_DB_MIGRATION_USER`
  - `TSPCC_DB_MIGRATION_PASSWORD`
  - `TSPCC_DB_RESTORE_USER`
  - `TSPCC_DB_RESTORE_PASSWORD`
  - `TSPCC_STORAGE_DIR`
- Runtime SQL source flags for rehearsal app:
  - `TSPCC_CARDS_SQL_SOURCE=1`
  - `TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE=1`
  - `TSPCC_DIRECTORIES_SQL_SOURCE=1`
  - `TSPCC_SECURITY_SQL_SOURCE=1`
  - `TSPCC_PRODUCTION_SQL_SOURCE=1`
  - `TSPCC_PRODUCTION_PLANNING_SQL_SOURCE=1`
  - `TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE=1`
  - `TSPCC_MESSAGING_PROFILE_SQL_SOURCE=1`
  - `TSPCC_MESSAGING_SQL_SOURCE=1`

## 3. Required Commands/Checks

Commands below are staging/test examples. Production/VDS execution requires a
separate Stage 14 approval.

### Prepare Clean Staging/Test

```powershell
$env:TSPCC_SQL_TEST = '1'
$env:TSPCC_DB_NAME = 'tspcc_bd_stage13_rehearsal'
$env:TSPCC_STORAGE_DIR = 'C:\tmp\tspcc-stage13-storage'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/bootstrap-local-test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/validate-runtime-grants.ps1
```

Acceptance:

- staging/test DB is disposable and isolated;
- runtime user has no DDL/admin grants;
- staging card storage is isolated from production and local developer storage.

### Run Migrations

```powershell
npm run mysql:migrate
```

Acceptance:

- `schema_migrations` records all files from `migrations/mysql/`;
- no manual SQL edits are required;
- `[DB] migrations complete` is present in logs.

### Import And Reconciliation

```powershell
node scripts/mysql/import-json-dry-run.js `
  --json rehearsal-inputs\<rehearsalId>\database.json `
  --files-root rehearsal-inputs\<rehearsalId>\cards `
  --report-dir artifacts\stage13\<rehearsalId>\import `
  --execute `
  --reset-import `
  --checksum `
  --strict-validation
```

Acceptance:

- `import-reconciliation.json` and `import-reconciliation.md` exist;
- report status is `PASS`;
- any `WARN` is an explicit manual decision by cutover lead and data owner;
- file metadata and physical files are reconciled;
- JSON is classified as import input only.

### SQL Integration

```powershell
npm run test:sql
```

Acceptance:

- SQL migration, repository, import, Stage 12 snapshot-removal and audit/outbox
  tests pass;
- optional tests may be skipped only when they are documented local/live MySQL
  gates and not required for the rehearsal environment.

### Focused Smoke/E2E

Run focused rehearsal smoke before the full suite:

```powershell
npx playwright test `
  tests/e2e/00.auth-routes.spec.js `
  tests/e2e/15.directories-domain-api.spec.js `
  tests/e2e/16.security-domain-foundation.spec.js `
  tests/e2e/17.security-users-routes.spec.js `
  tests/e2e/18.security-access-levels-routes.spec.js `
  tests/e2e/19.security-landing-timeout-propagation.spec.js `
  tests/e2e/20.production-planning-foundation.spec.js `
  tests/e2e/21.production-execution-contract.spec.js `
  tests/e2e/22.workorders-derived-view.spec.js `
  tests/e2e/23.messaging-profile-deeplink.spec.js `
  tests/e2e/24.notification-contracts.spec.js `
  tests/e2e/25.realtime-production-workspace-contract.spec.js `
  tests/e2e/26.realtime-cards-live-contract.spec.js `
  tests/e2e/27.realtime-directories-security-contract.spec.js `
  tests/e2e/28.stage13-removal-path-contract.spec.js `
  tests/e2e/29.diagnostics-prefix-contract.spec.js
```

Then run the full E2E suite:

```powershell
npm run test:e2e
```

Required coverage:

- Direct URLs/F5/Back/Forward for `/dashboard`, `/cards`, `/cards/<id>`,
  `/profile/<id>` or `/user/<id>`, production planning routes and chat
  deeplinks.
- Stage 6 directories/security: directory guards, users/access levels, `Abyss`,
  passwords, `landingTab`, inactivity timeout, profile route and `/api/data`
  overwrite protection.
- Stage 10 messaging/profile/notifications: `/api/chat/*`, `/profile/:id`,
  foreign profile denial, delivered/read/unread, `openChatWith`,
  `conversationId`, WebPush/FCM ownership, no `/api/messages/*`, and snapshot
  overwrite protection.
- Stage 11 realtime/outbox: committed live event, rollback no-event,
  multi-client refresh, realtime unavailable fallback and diagnostics `[LIVE]`,
  `[DATA]`, `[CONFLICT]`, `[DB]`.
- Stage 12 removal: no `saveData()` network POST, no route-critical full
  snapshot read, no runtime SQL failure fallback to `JsonDatabase`, no E2E
  reset by copying `database.json`.

### Backup

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/new-backup-set.ps1 `
  -OutputRoot artifacts\stage13\<rehearsalId>\backup `
  -DataPath rehearsal-inputs\<rehearsalId>\database.json `
  -CardsStoragePath rehearsal-inputs\<rehearsalId>\cards `
  -SchemaMigrationVersion "<latest schema_migrations version>"
```

Acceptance:

- SQL dump exists;
- card file archive exists;
- checksum file exists;
- manifest exists and includes app version, git commit, schema version,
  hashes, file counts and retention/RPO/RTO baseline.

### Restore Rehearsal

```powershell
$env:TSPCC_RESTORE_ENV = 'test'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/restore-backup-rehearsal.ps1 `
  -ManifestPath artifacts\stage13\<rehearsalId>\backup\<backupId>\<backupId>-manifest.json `
  -TargetDbName tspcc_bd_stage13_restore `
  -DropAndRecreateTargetDb `
  -ClearTargetCardsStorage
```

Post-restore smoke:

```powershell
node scripts/mysql/health-check.js
npx playwright test tests/e2e/00.auth-routes.spec.js tests/e2e/05.cards-core-routes.spec.js tests/e2e/23.messaging-profile-deeplink.spec.js
```

Acceptance:

- SQL restore imports without error;
- restored tables exist;
- file archive restores and matches manifest checksums;
- smoke after restore passes.

### 20-User Scenario

The rehearsal may use Playwright, k6, Artillery or another approved runner, but
the scenario must represent this mix:

| Users | Scenario |
|---:|---|
| 4 | Browse `/cards` and card details |
| 3 | Edit different cards |
| 2 | Concurrent edit of same card, expected `409` |
| 2 | Approval/input/provision actions |
| 2 | Directories/security edits with permission checks |
| 3 | Production planning/workspace flows |
| 2 | Workorders/archive/items/ok/oc views |
| 2 | Profile/chat/notifications |

Acceptance:

- no silent overwrite;
- expected conflicts return `409`;
- route remains stable after conflict;
- no forced redirect to `/dashboard`;
- no pool exhaustion;
- no unbounded full snapshot reload as default refresh;
- no transaction is held during file transfer, SSE, upload/download or external
  network call;
- p95 route/domain refresh is recorded and reviewed.

## 4. Rollback Decision Points

| Point | Continue criteria | Rollback/stop action |
|---|---|---|
| Before import | Frozen inputs complete and staging clean | Stop rehearsal; rebuild inputs/env |
| After migrations | Migrations applied from repo history only | Drop/recreate staging DB; fix migration blocker in later batch |
| After import/reconciliation | Reconciliation `PASS` or approved `WARN` | Stop; do not run runtime checks on invalid import |
| After smoke | Auth/routes/domain smoke PASS | Stop; collect logs; do not continue to full E2E |
| After full E2E/SQL | Required suites PASS | Stop; classify failing domain as cutover blocker |
| After backup | Complete backup set exists | Stop; backup is mandatory and cannot be skipped |
| After restore | SQL and files restore PASS | Stop; restore failure blocks Stage 14 |
| After 20-user | No data loss, pool exhaustion or route loss | Stop; performance/correctness blocker before Batch 3 |

Rollback during Stage 13 means discard/recreate staging/test SQL state and
restore the rehearsal input copy. It must not back-sync SQL into JSON and must
not touch production authority.

## 5. Stage 11 Outbox/Live Proof

Required proof during rehearsal:

- `audit_events` receives domain audit rows from runtime write paths.
- `outbox_events` receives post-commit event rows from accepted SQL domains.
- Live dispatch happens only after SQL commit through
  `server/realtime/postCommitDispatcher.js`.
- Rolled back transaction creates no success live event.
- Multi-client refresh uses live/SSE only as targeted refresh signal.
- Realtime unavailable fallback still reads committed SQL state through domain
  endpoints.
- Diagnostics include `[LIVE]`, `[DATA]`, `[CONFLICT]` and `[DB]`.

Stage 11 failure examples:

- success live event emitted before commit;
- rollback emits refresh success;
- client accepts live payload as correctness source without server refresh;
- domain write correctness depends on SSE availability.

## 6. Stage 12 JSON Authority Removal Proof

Required proof during rehearsal:

- `POST /api/data` returns disabled/read-only compatibility response and cannot
  persist application writes.
- `database.json` is import/reconciliation input only, not runtime authority.
- Route-critical boot/read path does not call full snapshot `/api/data`.
- Live/conflict fallback uses targeted domain refresh, not full snapshot.
- E2E runtime setup uses SQL seed/import path and does not reset by copying
  `database.json`.
- Missing/misconfigured SQL source fails closed for accepted SQL domains instead
  of falling back to `JsonDatabase`.
- Any remaining `/api/data` or `database.json` path is classified as one of:
  import, reconciliation, backup/export or diagnostic read-only compatibility.

Protected migrated slices that must not be overwritten by JSON/snapshot:

- Stage 6: `ops`, `centers`, `areas`, `productionShiftTimes`, `users`,
  `accessLevels`;
- Stage 10: `messages`, `chatConversations`, `chatMessages`, `chatStates`,
  `userActions`, `userVisits`, `webPushSubscriptions`, `fcmTokens`;
- Stage 12 full in-scope authority: cards, card files metadata, production
  planning/execution and derived read models.

## 7. Required Logs/Artifacts

Store all artifacts under `artifacts/stage13/<rehearsalId>/`:

- input manifest with JSON/file hashes;
- migration output with `[DB]` logs;
- `import-reconciliation.json`;
- `import-reconciliation.md`;
- SQL test output;
- focused E2E and full E2E reports;
- smoke checklist with routes and domains;
- backup set: SQL dump, card file archive, checksum file, manifest;
- restore rehearsal report;
- post-restore smoke output;
- 20-user scenario report with pool metrics and p95 refresh timings;
- diagnostics extract for `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]`;
- blocker log with owner, decision and required next batch.

## 8. Blockers Before Batch 2

Stage 13 Batch 2 is `BLOCKED` if any item below is unresolved:

- Stage 12 Batch 6 proof cannot be reproduced in current repo/test setup.
- Frozen production-like JSON/file inputs are missing hashes or owner sign-off.
- Clean staging/test DB cannot be created without manual production-like edits.
- Runtime DB user has DDL/admin grants or app requires migration/root grants.
- Import/reconciliation has fatal errors.
- Backup cannot include both SQL dump and file storage archive.
- Restore rehearsal cannot be run in a safe test target.
- Smoke/E2E plan does not cover Stage 6, Stage 10, Stage 11 and Stage 12
  contracts listed above.
- 20-user scenario runner and metrics collection are not defined.
