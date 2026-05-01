# E2E SQL Seed Contract

Post-cutover E2E setup uses the versioned MySQL migrations and the JSON importer
as an explicit seed step. The running app must not read copied
`data/database.json` as fixture authority.

Required local/test env:

- `TSPCC_E2E_SQL_SEED=1`
- `TSPCC_SQL_TEST=1`
- `TSPCC_DB_HOST`, `TSPCC_DB_PORT`, `TSPCC_DB_NAME`, `TSPCC_DB_USER`,
  `TSPCC_DB_PASSWORD`
- `TSPCC_DB_MIGRATION_USER`, `TSPCC_DB_MIGRATION_PASSWORD`

The target DB must be local/test-safe according to
`scripts/mysql/import-json-dry-run.js`: the schema name must contain
`test`, `local`, `dev`, `dry`, `tmp`, `fixture` or `stage4`, unless the
explicit local disposable override is used.

`tests/e2e/helpers/sqlSeed.js` runs:

```text
node scripts/mysql/import-json-dry-run.js --execute --reset-import
```

and starts the E2E server with SQL source flags for cards,
directories/security, production planning/execution, derived views and
messaging/profile. JSON fixtures remain seed/import input and reconciliation
fixtures only; test lookups read `tests/e2e/.runtime/sql-seed-manifest.json`.
