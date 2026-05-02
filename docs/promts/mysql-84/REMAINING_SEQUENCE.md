# MySQL 8.4 Remaining Batch Sequence

This file is the active step-by-step order from the current repository state to
final MySQL 8.4 migration acceptance.

## Current State

Last verified state:

- Stage 13 Batch 2 rehearsal: PASS.
- Stage 13 Batch 3 acceptance: PASS.
- Stage 14 Batch 1 readiness: PARTIALLY READY; NOT READY for production
  cutover.
- VDS app at readiness check: JSON runtime, `Alpha 0.16.60`, commit `32b82ac`.
- VDS source backup exists:
  `/root/tspcc-precutover-backups/precutover-20260502T064207Z`.
- VDS source backup contains current production `database.json` and
  `storage/cards`.
- VDS did not have `mysql`, `mysqldump`, `pwsh` in `PATH` at readiness check.

Important correction for production cutover:

- Do not copy any local rehearsal DB to VDS.
- Production MySQL DB must be created from VDS production source data:
  `/var/www/tspcc.ru/data/database.json` and `/var/www/tspcc.ru/storage/cards`.
- Before first MySQL cutover, the valid rollback source is the production
  JSON+files backup plus previous app version/config.
- The first production SQL restore point is created after production DB
  migrations/import/reconciliation succeed.

Current shadow-site decision:

- Before production cutover, create a separate VDS shadow site:
  `sql.tspcc.ru`.
- `sql.tspcc.ru` must run from a separate app directory, PM2 process, port,
  Nginx server block and MySQL runtime env.
- `sql.tspcc.ru` must use local workstation MySQL data from local DB
  `tspcc_bd`.
- Existing `tspcc.ru` must remain unchanged and continue using its current JSON
  runtime.
- The local DB copy on `sql.tspcc.ru` is for validation only. It is not the
  future production import source for `tspcc.ru` cutover.

## Strict Order

### 1. Stage14_batch1a

File: `Stage14_batch1a.md`

Purpose:

- Prepare VDS MySQL platform/tooling.
- Install or verify MySQL 8.4 server/client tools.
- Create/verify DB/users/grants/env path.
- Do not switch the app to MySQL.

Entry gate:

- User explicitly approves VDS infrastructure changes.
- Fresh source backup exists or is created before changes.

Exit gate:

- `mysql` and `mysqldump` available.
- MySQL server/service ready.
- `tspcc_bd`, `tspcc_app`, migration user and grants ready.
- Secrets are outside Git.
- Production app still runs without SQL source flags.

Stop if:

- MySQL tools/server cannot be installed or verified.
- Least-privilege runtime grants cannot be established.
- Secrets would need to be committed.

### 2. Stage14_batch1c

File: `Stage14_batch1c.md`

Purpose:

- Deploy and validate a separate shadow MySQL site on VDS:
  `sql.tspcc.ru`.
- Copy local workstation MySQL DB `tspcc_bd` into VDS MySQL DB `tspcc_bd` for
  this shadow site.
- Keep existing `tspcc.ru` untouched on JSON runtime.

Entry gate:

- User explicitly approves creating `sql.tspcc.ru` shadow infrastructure.
- Stage14_batch1a PASS, or MySQL platform is already ready on VDS.
- DNS `sql.tspcc.ru` points to the VDS IP, or HTTP/local-port validation is
  accepted until DNS is added.

Exit gate:

- Publish branch for current site code exists in GitHub.
- `/var/www/sql.tspcc.ru` is deployed from GitHub/deploy pipeline.
- PM2 app `tspcc-sql` runs on its own port.
- Nginx routes `sql.tspcc.ru` to the shadow app.
- VDS MySQL DB `tspcc_bd` contains local workstation DB data.
- `sql.tspcc.ru` smoke PASS.
- `tspcc.ru` PM2 app, port, data files and JSON runtime remain unchanged.

Stop if:

- DNS/SSL cannot be made ready and user does not accept temporary HTTP/local
  validation.
- publish branch cannot be created/pushed.
- VDS MySQL import from local `tspcc_bd` fails.
- shadow app cannot start.
- any action would require modifying `/var/www/tspcc.ru` or its runtime data.

### 3. Stage14_batch1b

File: `Stage14_batch1b.md`

Purpose:

- Close operational gate.
- Confirm owners, go/no-go, maintenance/quiesce, rollback, monitoring and
  publish/deploy readiness.

Entry gate:

- Stage14_batch1a PASS, or documented proof that platform was already ready.
- Stage14_batch1c PASS if the shadow-site validation path is being used.

Exit gate:

- Fresh production source backup is verified.
- MySQL platform ready.
- Maintenance/quiesce window or zero-downtime decision recorded.
- Exact quiesce command/procedure approved.
- Cutover owner, go/no-go owner, rollback owner and smoke owner named.
- Rollback point and rollback deadline recorded.
- Publish branch/target commit/version identified.

Stop if:

- Any owner/approval/window is missing.
- No rollback point exists.
- Monitoring cannot be checked during cutover.

### 4. Stage14_batch2

File: `Stage14_batch2.md`

Purpose:

- Execute production cutover.
- Build production MySQL DB from VDS production JSON/files.
- Deploy approved code through GitHub/deploy pipeline.
- Enable SQL source flags only after successful import/reconciliation and SQL
  restore point creation.

Entry gate:

- Stage14_batch1b PASS.
- User explicitly approves production cutover.

Execution summary:

1. Quiesce writes.
2. Take final production source backup.
3. Deploy approved publish branch through GitHub/deploy pipeline.
4. Apply migrations to production DB.
5. Import final VDS `database.json` + `storage/cards`.
6. Run reconciliation.
7. Create first production SQL restore point.
8. Enable SQL source flags.
9. Restart/reload app.
10. Run immediate smoke and monitoring.

Stop if:

- backup fails;
- migration fails;
- import fails;
- reconciliation fails without explicit accepted `WARN`;
- first SQL restore point cannot be created;
- core smoke fails.

### 5. Stage14_batch2b

File: `Stage14_batch2b.md`

Purpose:

- Extended production smoke and go/no-go during rollback window.

Entry gate:

- Stage14_batch2 produced cutover result artifact.

Exit gate:

- Stage 12 smoke PASS.
- Stage 6 smoke PASS.
- Stage 7/8/9 production/planning/execution smoke PASS.
- Stage 10 smoke PASS.
- File availability PASS.
- Monitoring has no critical SQL/pool/app issue.
- Go/no-go decision recorded.

Stop if:

- any critical route/auth/data/file issue appears;
- production runtime still has writable JSON/snapshot authority;
- rollback criteria are met.

### 6. Stage14_batch3

File: `Stage14_batch3.md`

Purpose:

- Final Stage 14 acceptance.
- Decide whether rollback window can close and Stage 15 can start.

Entry gate:

- Stage14_batch2 PASS or accepted `WARN`;
- Stage14_batch2b PASS or accepted `WARN`;
- rollback window still open or explicitly ready for closure decision.

Exit gate:

- Production runs on MySQL source of truth.
- JSON is not authoritative.
- Backups and first SQL restore point retained.
- Smoke/monitoring PASS.
- Stage 12/6/10 production proof PASS.
- Stage 15 may start.

Stop if:

- first SQL restore point missing;
- monitoring has critical issue;
- rollback criteria remain active;
- any Stage 12/6/10 production proof fails.

### 7. Stage15_batch1

File: `Stage15_batch1.md`

Purpose:

- Post-cutover audit and measurement plan.

Entry gate:

- Stage14_batch3 PASS.

Exit gate:

- Full post-cutover audit report.
- Measurement plan for E2E, 20-user scenario, slow queries, pool, deadlocks,
  backup schedule and restore rehearsal.

### 8. Stage15_batch2

File: `Stage15_batch2.md`

Purpose:

- Measured hardening, compatibility cleanup and 20-user proof.

Entry gate:

- Stage15_batch1 audit result and measurement plan.

Exit gate:

- Full E2E after cutover PASS.
- 20-user scenario PASS.
- SQL/pool/perf findings handled or documented.
- Backup schedule and post-cutover restore rehearsal confirmed.
- Cleanup done only where criteria are proven.

### 9. Stage15_batch3

File: `Stage15_batch3.md`

Purpose:

- Final MySQL 8.4 migration acceptance.

Entry gate:

- Stage15_batch2 PASS.

Exit gate:

- Global MySQL migration PASS.
- Definition of failure table has no active failure.
- Stage 12 final state preserved.
- Stage 6 and Stage 10 business rules preserved.
- Backup/restore and 20-user proof accepted.

## Absolute Stop Rules

Stop immediately and do not continue to the next batch if any of these happen:

- production backup cannot be created;
- MySQL tooling/server cannot be verified;
- migrations fail;
- import fails;
- reconciliation is `FAIL`;
- SQL restore point cannot be created after import;
- app cannot start;
- login/session smoke fails;
- files are unavailable;
- `/api/data` is writable or authoritative;
- `/api/messages/*` active write stack returns;
- monitoring shows pool exhaustion, repeated DB errors or critical app errors;
- rollback owner calls `NO-GO`.
