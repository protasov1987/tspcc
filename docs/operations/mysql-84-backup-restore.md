# MySQL 8.4 Backup And Restore Runbook

Этот runbook фиксирует Stage 1 Batch 3 baseline для проверяемого backup set:
`mysqldump` + архив файлов карточек + manifest. Он не меняет source of truth
приложения и не начинает domain SQL cutover.

## Scope

- Backup set включает SQL dump, архив `storage/cards` и manifest.
- Файлы карточек являются обязательной частью restore point.
- `database.json` не считается заменой SQL backup после MySQL cutover.
- Production/VDS команды выполняются только после отдельного явного approval.
- Restore rehearsal выполняется только в local/test environment.

## Source Paths

Скрипты используют тот же Stage 1 contract, что и приложение:

- DB env: `TSPCC_DB_HOST`, `TSPCC_DB_PORT`, `TSPCC_DB_NAME`,
  `TSPCC_DB_USER`, `TSPCC_DB_PASSWORD`.
- Data baseline: `TSPCC_DATA_DIR/database.json`, если `TSPCC_DATA_DIR` задан,
  иначе `data/database.json`.
- Card files: если `TSPCC_STORAGE_DIR/cards` существует, используется он;
  иначе `TSPCC_STORAGE_DIR` считается explicit card-file root; без env
  используется `storage/cards`.

## Backup Set Command

Local/test example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/new-backup-set.ps1
```

Production-like usage must pass an output root outside the production disk that
contains the site and MySQL data directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/new-backup-set.ps1 `
  -OutputRoot "D:\tspcc-mysql-backups"
```

The script creates one directory per backup set under `data/mysql-backups` by
default. That default is for local/test only.

Artifacts:

- `<backupId>.sql` - logical MySQL dump from `mysqldump`.
- `<backupId>-card-files.zip` - archive of physical card files.
- `<backupId>-file-checksums.json` - per-file SHA256 list and aggregate
  summary.
- `<backupId>-manifest.json` - restore-point manifest.

## Manifest Contract

The manifest includes:

- UTC timestamp and backup set id.
- App version from `app-version.json`.
- Git commit and dirty-worktree flag.
- MySQL host, port and database name, without secrets.
- Schema migration version placeholder until the Stage 3 migration runner
  exists.
- Domain counts placeholder until SQL schema/import reconciliation exists.
- SQL dump filename, size and SHA256.
- File archive filename, size and SHA256.
- File count, total bytes and aggregate SHA256 summary.
- Source `TSPCC_DATA_DIR` / `TSPCC_STORAGE_DIR` resolution and explicit paths.
- Retention and RPO/RTO baseline.

Backup is incomplete if any of the SQL dump, file archive, checksum file or
manifest is missing.

## Restore Rehearsal

Restore rehearsal is intentionally guarded. Before running it, set:

```powershell
$env:TSPCC_RESTORE_ENV = 'test'
```

Use a separate test database name. The default is `tspcc_bd_restore`.
Restore credentials are read from `TSPCC_DB_RESTORE_USER` /
`TSPCC_DB_RESTORE_PASSWORD`, falling back to migration credentials for
local/test only.

Example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/restore-backup-rehearsal.ps1 `
  -ManifestPath "data\mysql-backups\mysql84-YYYYMMDDTHHMMSSZ\mysql84-YYYYMMDDTHHMMSSZ-manifest.json" `
  -DropAndRecreateTargetDb `
  -ClearTargetCardsStorage
```

The script:

- refuses to run unless `TSPCC_RESTORE_ENV` is `local` or `test`;
- refuses to restore into the source DB name unless explicitly overridden for
  an isolated local/test server;
- restores SQL into the target test DB;
- extracts the file archive into `data/restore-rehearsals/<backupId>/cards`
  by default;
- recomputes file count, total bytes and aggregate SHA256;
- writes `restore-rehearsal-report.json`.

## Restore Verification

Minimum successful rehearsal checks:

- SQL dump imports without error.
- Restored test DB has tables after import.
- File archive extracts without error.
- Restored physical files match manifest file count, total bytes and aggregate
  SHA256.
- File metadata vs physical files reconciliation remains pending until Stage 4
  introduces SQL attachment metadata import/reconciliation. Until then, the
  checksum file is the physical-file baseline.

After Stage 4, rehearsal acceptance must also compare SQL attachment metadata
against restored physical files by card/attachment path, size and checksum.

## Retention Baseline

Minimum production baseline:

- daily full logical `mysqldump`;
- matching card file archive for the same restore point;
- matching manifest;
- retention not less than 14 days unless a later operations decision changes
  it;
- backup archives copied outside the production disk.

## RPO/RTO Baseline

Initial values from the Stage 1 audit baseline:

- RPO: 24h until a stricter operational schedule is approved.
- RTO target: 2-4h until restore rehearsal gives measured numbers.

Measured rehearsal duration must replace the initial RTO estimate before
production cutover.

## Approval Or Environment Access Required Later

These commands are intentionally left for manual/local-test or approved ops
stage:

- installing MySQL 8.4;
- installing MySQL client tools (`mysql`, `mysqldump`) if missing;
- running backup/restore against VDS or staging;
- copying backup archives outside the production disk;
- scheduling production backup through cron, Task Scheduler, systemd timer or
  another scheduler;
- running destructive restore against any non-test environment.

## Non-Goals

- No production data is changed by this runbook.
- No real secrets are committed.
- No Stage 2 schema/import/domain cutover starts here.
- Git history, JSON export and SQL dump alone are not complete backups for the
  card-file workflows.
