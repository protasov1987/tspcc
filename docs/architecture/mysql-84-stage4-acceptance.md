# MySQL 8.4 Stage 4 Acceptance

Status: PASS.

This document records Stage 4 Batch 3 acceptance for JSON Import, Validation
and Reconciliation Dry Run after the cutover-warning hardening batch. It does
not change runtime source of truth, does not start Stage 5 cutover, and does
not make SQL dry-run data authoritative.

## Scope

Checked artifacts:

- `scripts/mysql/import-json-dry-run.js`
- `tests/sql/mysql-import-dry-run.test.js`
- `tests/sql/mysql-migrations.test.js`
- `migrations/mysql/*.sql`
- `server/persistence/mysql/*`
- `artifacts/mysql-import/current-sql-final-hardening/import-reconciliation.json`
- `artifacts/mysql-import/current-sql-final-hardening/import-reconciliation.md`

## Stage 3/4 Gate

Result: PASS.

- Stage 3 migrations exist under `migrations/mysql/`.
- Migration runner exists under
  `server/persistence/mysql/migrations/runner.js`.
- Migration credentials are provided by local environment outside Git:
  `TSPCC_DB_MIGRATION_USER` and `TSPCC_DB_MIGRATION_PASSWORD`.
- `npm run test:sql` passed with 27 tests passed.
- Optional local MySQL health and migration-runner tests executed.
- New forward-only migration `006_cutover_warning_resolution` is applied by
  the migration runner and is idempotent on rerun.

## SQL Dry Run

Result: PASS.

The importer was executed against the current local snapshot:

```text
npm run mysql:import:dry-run -- --execute --reset-import --json data\database.json --files-root storage\cards --report-dir artifacts\mysql-import\current-sql-final-hardening
```

Because the local disposable schema is named `tspcc_bd`, the run used the
explicit local/test guard `TSPCC_ALLOW_TSPCC_BD_IMPORT=1` together with
`TSPCC_SQL_TEST=1`.

Final report summary:

- status: `PASS`
- mode: `sql-import`
- fatal validation errors: `0`
- warnings: `0`
- manual decisions required: `0`
- skipped fields: `2`
- converted fields: `146`
- missing files: `0`
- orphan files: `0`
- size mismatches: `0`
- size corrections: `1`

The two skipped fields are explicitly classified compatibility skips:

- transient card field `__expectedRevAtOpen`;
- empty legacy `messages`.

They are not authority data and do not require manual owner decisions.

## Reconciliation Summary

| Domain/table target | Source count | SQL count |
|---|---:|---:|
| `work_centers` | 8 | 8 |
| `operations` | 41 | 41 |
| `production_areas` | 12 | 12 |
| `users` | 16 | 16 |
| `access_levels` | 6 | 6 |
| `cards` | 30 | 30 |
| `card_operations` | 92 | 92 |
| `card_attachments` | 38 | 38 |
| `production_schedule` | 448 | 448 |
| `production_shift_masters` | 9 | 9 |
| `production_shift_tasks` | 68 | 68 |
| `production_shifts` | 148 | 148 |
| `production_flow_states` | 92 | 92 |
| `card_flow_projection` | 30 | 30 |
| `chat_conversations` | 4 | 4 |
| `chat_messages` | 422 | 422 |
| `user_actions` | 1539 | 1539 |

Cutover-warning hardening results:

- `SHIFT_MASTER` planning rows are imported into
  `production_shift_masters`, not into a fake production area.
- `system` chat participant context is preserved in
  `chat_conversations.system_context_json`, not imported as a user FK row.
- One attachment metadata size mismatch is canonicalized to the physical file
  size for `card_attachments.size_bytes` and recorded in
  `files.sizeCorrections` / `import.convertedFields`.
- Duplicate source `card_logs.id` values are preserved with stable import IDs
  and explicit conversion entries.

## File Reconciliation Summary

Result: PASS.

- metadata rows: `38`
- physical files: `38`
- missing physical files for metadata: `0`
- physical files without metadata: `0`
- size mismatches: `0`
- size corrections: `1`
- checksum policy: `unavailable`

The size correction is explicit and uses the physical file size as canonical
SQL metadata for import.

## Runtime And Source-Of-Truth Review

Result: PASS.

- Importer is an offline CLI script under `scripts/mysql/`.
- Normal `server.js` startup does not import or run the importer.
- Runtime code is not wired to `mysql:import:dry-run`.
- SQL execution mode requires `--execute`.
- Destructive reset requires local/test DB guards.
- Production JSON and `storage/cards` are not mutated by Stage 4 checks.
- SQL dry-run data is not treated as live authoritative runtime data.
- No SQL -> JSON back-sync was added.
- Compatibility/archive fields are not introduced as write authority.
- `card_flow_projection` remains projection/read model, not production
  execution authority.

## Acceptance Decision

Stage 4 status: PASS.

The previous cutover warnings are resolved in the import target model:

1. `production_schedule` no longer loses `SHIFT_MASTER` rows; they import as
   `production_shift_masters`.
2. File reconciliation has no missing/orphan/mismatched files for the current
   snapshot.
3. `system` chat participant is preserved as system conversation context, not
   as a fake user.

Stage 5 design/planning may start from this Stage 4 dry-run baseline.
