# MySQL 8.4 Stage 4 Acceptance

Status: PASS WITH WARNINGS.

This document records Stage 4 Batch 3 acceptance for JSON Import, Validation
and Reconciliation Dry Run. It does not change runtime source of truth, does
not start Stage 5 cutover, and does not make SQL dry-run data authoritative.

## Scope

Checked artifacts:

- `scripts/mysql/import-json-dry-run.js`
- `tests/sql/mysql-import-dry-run.test.js`
- `package.json` script `mysql:import:dry-run`
- `migrations/mysql/*.sql`
- `server/persistence/mysql/*`
- `artifacts/mysql-import/stage4-batch3-sql-final/import-reconciliation.json`
- `artifacts/mysql-import/stage4-batch3-sql-final/import-reconciliation.md`

## Stage 3 Gate

Result: PASS.

- Stage 3 migrations exist under `migrations/mysql/`.
- Migration runner exists under
  `server/persistence/mysql/migrations/runner.js`.
- Local environment now provides `TSPCC_DB_MIGRATION_USER` and
  `TSPCC_DB_MIGRATION_PASSWORD` outside Git.
- `npm run test:sql` passed with 25 tests passed.
- Optional local MySQL health and migration-runner tests executed instead of
  being skipped.

## SQL Dry Run Repeatability

Result: PASS WITH WARNINGS.

The importer was executed against the safe fixture
`tests/e2e/fixtures/baseline-core.database.json` and `storage/cards` with:

```text
npm run mysql:import:dry-run -- --execute --reset-import --json tests\e2e\fixtures\baseline-core.database.json --files-root storage\cards --report-dir artifacts\mysql-import\stage4-batch3-sql-final
```

Because the local disposable schema is named `tspcc_bd`, the run used the
explicit local/test guard `TSPCC_ALLOW_TSPCC_BD_IMPORT=1` together with
`TSPCC_SQL_TEST=1`.

The SQL dry run:

- applied/verified 5 Stage 3 migrations through the migration runner;
- reset only the importer-owned SQL tables in the local/test schema;
- completed a full SQL import transaction;
- generated JSON and Markdown reconciliation reports;
- was repeated successfully with `--reset-import`, proving repeatability.

Final report summary:

- status: `WARN`
- mode: `sql-import`
- target DB: `tspcc_bd` local/test
- fatal validation errors: `0`
- warnings: `2`
- manual decisions required: `0`
- converted fields: `135`
- skipped fields: `220`

## Reconciliation Summary

Source domain counts:

| Domain/table target | Source count |
|---|---:|
| `work_centers` | 8 |
| `operations` | 39 |
| `production_areas` | 12 |
| `users` | 16 |
| `access_levels` | 8 |
| `cards` | 21 |
| `card_operations` | 60 |
| `card_attachments` | 24 |
| `production_schedule` | 639 |
| `production_shift_tasks` | 47 |
| `production_shifts` | 136 |
| `production_flow_states` | 60 |
| `card_flow_projection` | 21 |
| `chat_conversations` | 3 |
| `chat_messages` | 400 |
| `user_actions` | 1334 |

SQL reconciliation counts:

| SQL table | Row count |
|---|---:|
| `work_centers` | 8 |
| `operations` | 39 |
| `production_areas` | 12 |
| `users` | 16 |
| `access_levels` | 8 |
| `cards` | 21 |
| `card_operations` | 60 |
| `card_attachments` | 24 |
| `production_schedule` | 420 |
| `production_shift_tasks` | 47 |
| `production_shifts` | 136 |
| `production_flow_states` | 60 |
| `card_flow_projection` | 21 |
| `chat_conversations` | 3 |
| `chat_messages` | 400 |
| `user_actions` | 1334 |
| `card_initial_snapshots_archive` | 21 |
| `production_shift_close_snapshots` | 9 |

The `production_schedule` difference is explicitly reported:

- 219 rows are skipped with `decision: skip-broken-reference`;
- reason: required SQL FK references are missing;
- each skipped row is listed in `import.skippedFields`.

The importer also reports duplicate source `card_logs.id` values as explicit
stable import-ID conversions instead of silently dropping logs or failing on a
primary-key collision.

Coverage explicitly includes:

- `centers[] -> work_centers`;
- single `userActions[] -> user_actions` owner;
- production execution authority tables, including `production_flow_states`;
- card-facing `card_flow_projection` as projection/read model;
- archive/read-only snapshot tables, including card initial snapshots and
  production shift close snapshots.

## File Reconciliation Summary

Result: WARN.

- metadata rows: `24`
- physical files: `38`
- missing physical files for metadata: `2`
- physical files without metadata: `16`
- size mismatches: `0`
- checksum policy: `unavailable`

The mismatches are reported explicitly and are not repaired by the importer.

## Runtime And Source-Of-Truth Review

Result: PASS.

- Importer is an offline CLI script under `scripts/mysql/`.
- Normal `server.js` startup does not import or run the importer.
- Runtime code is not wired to `mysql:import:dry-run`.
- SQL execution mode requires `--execute`.
- Destructive reset requires local/test DB guards.
- Production JSON and `storage/cards` were not mutated by Stage 4 checks.
- SQL dry-run data is not treated as live authoritative runtime data.
- No SQL -> JSON back-sync was added.
- Compatibility/archive fields are not introduced as write authority.
- `card_flow_projection` remains projection/read model, not production
  execution authority.

## Acceptance Decision

Stage 4 status: PASS WITH WARNINGS.

The previous environment blocker is resolved: migration credentials are present
in the local command environment and the SQL dry run now executes.

Remaining warnings before cutover:

1. `production_schedule` contains 219 rows that cannot be inserted because
   required user/area FK references are missing.
2. Card file reconciliation has 2 missing metadata files and 16 orphan
   physical files.
3. One chat conversation contains `system` as a compatibility participant; it
   is reported and not imported as a normal user.

Stage 5 design/planning may start from this Stage 4 dry-run baseline. Stage 5
production cutover must not treat these warnings as resolved until the owner
explicitly accepts or fixes the reported data/file mismatches.
