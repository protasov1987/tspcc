# MySQL 8.4 Local/Test Platform Bootstrap

Этот документ фиксирует безопасный local/test bootstrap для MySQL 8.4 Stage 1
Batch 2. Он не меняет runtime source of truth приложения: текущие domain
reads/writes сайта остаются на существующем persistence-слое до отдельного SQL
cutover batch.

## Scope

- Создается local/test database `tspcc_bd`.
- Создается runtime user `tspcc_app` с least privilege grants.
- Создается отдельный migration user для controlled migration runner.
- Реальные пароли не хранятся в Git.
- `/api/data`, domain repositories и production schema в этом batch не
  меняются.

## Env Contract

Local/test значения задаются через `.env` или shell environment вне Git:

```text
TSPCC_DB_HOST=127.0.0.1
TSPCC_DB_PORT=3306
TSPCC_DB_NAME=tspcc_bd
TSPCC_DB_USER=tspcc_app
TSPCC_DB_PASSWORD=<secret>
TSPCC_DB_CONNECTION_LIMIT=10
TSPCC_DB_SSL=disabled|required|custom
TSPCC_DB_MIGRATION_USER=<migration user>
TSPCC_DB_MIGRATION_PASSWORD=<secret>
```

Tracked template: [mysql-84-local.env.example](./mysql-84-local.env.example).
Copy its values into a local `.env` file or shell environment and replace the
placeholder secrets outside Git.

Rules:

- `TSPCC_DB_PASSWORD` and `TSPCC_DB_MIGRATION_PASSWORD` must be generated per
  environment.
- `TSPCC_DB_MIGRATION_USER` must not equal `tspcc_app`.
- `TSPCC_DB_SSL=disabled` is acceptable only for local/test loopback. Use
  `required` or `custom` where TLS is required by the environment.
- `.env`, `.env.*`, `data/`, `storage/*` and `fcm-service-account.json` are
  ignored by Git.

## Secret Delivery Pattern

Local/test:

- Put the values above into a local `.env` file or export them in the shell
  before running bootstrap/validation commands.
- Do not commit `.env` or generated secret files.

PM2/VDS later:

- Use an external secret file or host-level environment variables.
- Do not add DB credentials as literal values in `ecosystem.config.js`.
- Migration credentials must be available only to the controlled migration
  step, not to the runtime PM2 process.

Admin/root bootstrap access:

- Prefer a local MySQL login path created outside Git, for example:

```powershell
mysql_config_editor set --login-path=tspcc-local-admin --host=127.0.0.1 --port=3306 --user=root --password
```

- Alternatively run `mysql` with host-local admin credentials supplied by the
  operator. Admin credentials are not part of the application env contract.

Codex/local agent access:

- Do not write real MySQL passwords into tracked repository files, prompts or
  documentation.
- To let Codex run local/test MySQL checks in the current session, provide the
  runtime env variables in the shell where Codex commands run:
  `TSPCC_DB_HOST`, `TSPCC_DB_PORT`, `TSPCC_DB_NAME`, `TSPCC_DB_USER`,
  `TSPCC_DB_PASSWORD`, `TSPCC_DB_CONNECTION_LIMIT`, `TSPCC_DB_SSL` and
  `TSPCC_SQL_TEST=1`.
- To let Codex bootstrap or change local/test schema/users, provide one
  operator-approved admin path outside Git:
  - either create `mysql_config_editor` login path `tspcc-local-admin`;
  - or set `TSPCC_DB_ADMIN_PASSWORD` only in the current shell before running
    the bootstrap command and remove it immediately after.
- Full local/test schema changes should use the separate migration/admin user,
  not the runtime `tspcc_app` user. The runtime user remains least-privileged.
- Codex does not have persistent memory of local secrets across independent
  sessions. If a new session needs MySQL access, re-provide the local env or
  login-path.

## Bootstrap Commands

1. Set local/test application and migration env values outside Git.

2. Run the bootstrap script with a MySQL admin login path:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/bootstrap-local-test.ps1 -LoginPath tspcc-local-admin
```

Or with explicit admin user and an operator-supplied password in the current
shell only:

```powershell
$env:TSPCC_DB_ADMIN_PASSWORD='<admin secret>'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/bootstrap-local-test.ps1 -AdminUser root
Remove-Item Env:TSPCC_DB_ADMIN_PASSWORD
```

The script creates:

- database `tspcc_bd` with `utf8mb4` / `utf8mb4_0900_ai_ci`;
- runtime user `tspcc_app`;
- migration user from `TSPCC_DB_MIGRATION_USER`;
- database-local grants only.

## Users And Grants

Runtime user `tspcc_app`:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON `tspcc_bd`.* TO 'tspcc_app'@'127.0.0.1';
```

Runtime user explicitly must not have:

- `CREATE`
- `ALTER`
- `DROP`
- `INDEX`
- `REFERENCES`
- `GRANT OPTION`
- global `*.*` grants

Migration user:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, CREATE, ALTER, DROP, INDEX, REFERENCES ON `tspcc_bd`.* TO '<migration user>'@'127.0.0.1';
```

The migration user is separate from `tspcc_app`. Runtime cannot apply schema
migrations because it does not receive DDL privileges.

## Runtime Grant Validation

After bootstrap, validate runtime grants:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/validate-runtime-grants.ps1
```

This command connects as `TSPCC_DB_USER`, reads `SHOW GRANTS`, and fails if the
runtime user has DDL/admin privileges or global grants. It also verifies that
the migration user name is configured and differs from the runtime user.

For a local/test database where destructive probes are acceptable, the operator
may additionally run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/validate-runtime-grants.ps1 -ProbeDdl
```

`-ProbeDdl` expects runtime DDL attempts to fail. Use it only against
throwaway local/test databases.

## Current Source Of Truth

This batch does not introduce a MySQL source-of-truth path. The application
does not connect to MySQL for domain reads/writes yet, no MySQL driver is
installed in this batch, and `/api/data` is unchanged.

The next persistence batches must continue to use the existing SPA/domain
architecture: server domain commands remain the only write authority, with no
return to critical snapshot-save writes.

## Backup/Restore

Backup/restore is documented in
[mysql-84-backup-restore.md](./mysql-84-backup-restore.md). That Stage 1
runbook covers:

- `mysqldump` logical backup procedure;
- file storage archive/snapshot procedure;
- shared manifest with app version/git commit, schema migration version,
  counts/checksums and file summary;
- restore rehearsal on test environment;
- documented RPO/RTO and retention.
