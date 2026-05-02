# MySQL 8.4 Stage 14 Batch 2

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
- Это MySQL 8.4 Stage 14: Production Cutover execution.
- Выполнять только после:
  - Stage 13 Batch 3 PASS;
  - Stage14_batch1a PASS;
  - Stage14_batch1b PASS;
  - явного подтверждения пользователя на production cutover.
- Нельзя импровизировать вне runbook.
- Production DB должна быть построена из текущих VDS production inputs:
  `/var/www/tspcc.ru/data/database.json` и `/var/www/tspcc.ru/storage/cards`.
- Локальную rehearsal DB на VDS НЕ переносить.
- При failed import/reconciliation остановиться и перейти к rollback decision.
- Production smoke must include Stage 12 checks before accepting cutover:
  no writable `/api/data` / `saveData()`, no runtime `database.json`
  authority, no route-critical full snapshot read, and any JSON/export path is
  non-authoritative.
- Production smoke must include Stage 6 directories/security scenarios before
  accepting cutover: directory/security reads, protected writes, auth/profile,
  `Abyss`, landingTab/inactivity timeout and snapshot overwrite protection.
- Production smoke must include Stage 10 messaging/profile/notifications
  scenarios before accepting cutover: profile privacy, chat send/read,
  deeplink, WebPush/FCM ownership, no `/api/messages/*`, and Stage 10 snapshot
  overwrite protection.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 2: production cutover строго по runbook.

Перед началом:
- запроси явное подтверждение пользователя;
- назови target state:
  production app version/commit -> MySQL-backed runtime on VDS;
- назови rollback point:
  latest verified source backup JSON+files + previous app version/config;
- назови hard stop rules:
  failed backup, failed migration, failed import, failed reconciliation,
  missing files, failed core smoke.

Что сделать после подтверждения:
1. Quiesce/stop writes according to approved runbook.
2. Take final production source backup:
   - `/var/www/tspcc.ru/data/database.json`;
   - `/var/www/tspcc.ru/storage/cards`;
   - manifest with SHA256/file count/app version/git commit.
3. Deploy approved publish branch through GitHub/deploy pipeline only.
   - Do not manually edit site files on VDS.
   - Confirm deployed app version/commit.
4. Ensure production env secrets are present on VDS:
   - `TSPCC_DB_HOST`;
   - `TSPCC_DB_PORT`;
   - `TSPCC_DB_NAME`;
   - `TSPCC_DB_USER`;
   - `TSPCC_DB_PASSWORD`;
   - `TSPCC_DB_MIGRATION_USER`;
   - `TSPCC_DB_MIGRATION_PASSWORD`.
5. Apply SQL migrations to the production DB using repo migrations.
6. Run final import from VDS production source backup:
   - JSON source: final backed up `database.json`;
   - files root: final backed up/extracted `cards`;
   - mode: execute;
   - target DB: production `tspcc_bd`;
   - report dir: production cutover artifact dir.
7. Run final reconciliation.
   - If `FAIL`: stop and rollback/decision.
   - If `WARN`: continue only if warning is explicitly approved and documented.
8. Create first production SQL restore point after successful import:
   - `mysqldump`;
   - card file archive;
   - checksum file;
   - manifest.
9. Enable production SQL source flags through approved env/deploy config:
   - `TSPCC_CARDS_SQL_SOURCE=1`;
   - `TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE=1`;
   - `TSPCC_DIRECTORIES_SQL_SOURCE=1`;
   - `TSPCC_SECURITY_SQL_SOURCE=1`;
   - `TSPCC_PRODUCTION_SQL_SOURCE=1`;
   - `TSPCC_PRODUCTION_PLANNING_SQL_SOURCE=1`;
   - `TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE=1`;
   - `TSPCC_MESSAGING_PROFILE_SQL_SOURCE=1`;
   - `TSPCC_MESSAGING_SQL_SOURCE=1`.
10. Restart/reload app through approved process.
11. Run immediate production smoke:
    - login/session restore;
    - `/dashboard` F5/direct URL;
    - `/cards` F5/direct URL;
    - `/cards/<id>` F5/direct URL;
    - `/profile/<id>` or `/user/<id>` F5/direct URL;
    - cards list/detail;
    - file availability;
    - directories/security read;
    - production planning/workspace read;
    - messaging/profile/chat read;
    - no active `/api/messages/*`;
    - `/api/data` read-only/non-authoritative.
12. Monitor DB/app metrics:
    - PM2 status/logs;
    - `[DB]`;
    - slow queries;
    - deadlocks/lock waits;
    - pool usage/exhaustion;
    - app errors.
13. Produce cutover artifact:
    `docs/architecture/mysql-84-stage14-batch2-cutover-result.md`.

Что нельзя делать:
- не skip source backup;
- не skip first SQL restore point after import;
- не continue after failed reconciliation;
- не manually patch production schema/data outside migrations/importer;
- не deploy by direct VDS file copy;
- не push local backup branches unless requested;
- не переносить локальную rehearsal DB на VDS.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы
`PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не
переводить.
1. Cutover result.
2. Source backup manifest.
3. Migration/import/reconciliation summary.
4. First SQL restore point manifest.
5. Smoke result.
6. Stage 12 JSON authority smoke result.
7. Rollback window status.
8. Whether Stage14_batch2b may start.
```

## Ручная проверка после Prompt

Обязательна: login, F5/direct URL, cards, files, production, workspace,
messaging/profile, realtime fallback.
