# MySQL 8.4 Stage 14 Batch 1 Readiness

Status: PARTIALLY READY; NOT READY for production cutover.

This document records the final pre-cutover readiness check. It does not execute
production commands, does not change production config and does not touch VDS
files/data.

## 1. Ready/Not Ready

Stage 14 Batch 1 result: PARTIALLY READY, but NOT READY for production cutover.

Reason:

- Stage 13 acceptance is PASS.
- Technical rehearsal gates passed.
- Production cutover still requires explicit user approval.
- A fresh production source backup set has been created and verified in this
  session.
- A fresh production SQL dump has not been created because the production host
  currently has no `mysql` / `mysqldump` client tools available.
- Maintenance/quiesce owner approval and execution window are not yet recorded.

Therefore production cutover must not start yet.

## 2. Checklist Status

| Check | Status | Proof / blocker |
|---|---|---|
| Stage 13 PASS | PASS | `docs/architecture/mysql-84-stage13-batch3-acceptance.md` |
| Stage 12 JSON authority removal proof in rehearsal | PASS | Stage 13 acceptance section 5; `tests/sql/stage12-snapshot-read-cutover.test.js`; `tests/e2e/28.stage13-removal-path-contract.spec.js` |
| Current backups available | PARTIAL | Fresh production source backup exists: `/root/tspcc-precutover-backups/precutover-20260502T064207Z`; SQL dump is blocked by missing `mysql` / `mysqldump` tools on VDS |
| Cutover runbook complete | PASS | `docs/operations/mysql-84-production-cutover-rehearsal.md`; migration plan Stage 14 section |
| Rollback runbook complete | PASS | `docs/operations/mysql-84-production-cutover-rehearsal.md` rollback decision points; `docs/architecture/mysql-84-migration-plan.md` rollback expectations |
| Maintenance/quiesce plan ready | PARTIAL | Plan exists; concrete window and command still require owner confirmation |
| Smoke checklist ready | PASS | Rehearsal runbook lists route/domain smoke; post-restore smoke passed in Stage 13 |
| Monitoring checklist ready | PARTIAL | PM2/disk/memory baseline checked; alerting validation is not confirmed |
| Owner/decision points clear | PARTIAL | Decision points are documented; concrete cutover owner and go/no-go owner are not recorded |
| Stage 6 blockers | PASS | Stage 13 acceptance section 6 |
| Stage 10 blockers | PASS | Stage 13 acceptance section 8 and `docs/architecture/mysql-84-stage10-batch5-acceptance.md` |
| Stage 11 blockers | PASS | `docs/architecture/mysql-84-stage11-batch4-acceptance.md`; Stage 13 full E2E |
| Stage 12 blockers | PASS | Stage 13 acceptance section 5 |

## 3. Missing Approvals/Blockers

Production cutover is blocked until all items below are explicitly completed:

- explicit user approval to start production cutover;
- named cutover owner and go/no-go decision owner;
- maintenance window or zero-downtime decision;
- write quiesce procedure approved for the site;
- production SQL dump created after `mysql` / `mysqldump` tools or another
  approved SQL backup path are available;
- production backup manifest verified for the SQL dump as well as the source
  JSON/file backup;
- production rollback target and rollback deadline confirmed;
- production monitoring/alert checks confirmed for DB connectivity, pool
  exhaustion, slow queries, deadlocks, lock waits, backup failure and restore
  failure.

These blockers are operational approvals and production-safety gates, not
Stage 6/7/10/11/12 technical blockers.

## 3.1 Closed Readiness Items On 2026-05-02

The following production readiness items were checked without changing site
files, production data or production configuration:

- VDS host reachable: `6172049-ot353868`;
- app directory exists: `/var/www/tspcc.ru`;
- PM2 app `tspcc` is `online`;
- production runtime version at check time: `Alpha 0.16.60`;
- production git commit at check time: `32b82ac`;
- root filesystem free space: about `25G` available;
- memory baseline: about `1.4Gi` available;
- fresh production source backup created outside the site directory:
  `/root/tspcc-precutover-backups/precutover-20260502T064207Z`;
- source backup manifest:
  `/root/tspcc-precutover-backups/precutover-20260502T064207Z/manifest.json`;
- source backup SHA verification passed for:
  `database.json` and `cards.tar.gz`.

Source backup manifest summary:

```json
{
  "backupId": "precutover-20260502T064207Z",
  "createdAtUtc": "2026-05-02T06:42:07Z",
  "appVersion": "Alpha 0.16.60",
  "gitCommit": "32b82ac",
  "sourceType": "production-json-files-precutover",
  "databaseJson": {
    "file": "database.json",
    "size": 3270994,
    "sha256": "43a52c2c3b3ec7645f27e35c5beb17f3da0278b5ea864a85686a37d6377e60f3"
  },
  "cardFiles": {
    "file": "cards.tar.gz",
    "source": "storage/cards",
    "fileCount": 20,
    "size": 2828934,
    "sha256": "9e5e130845ef6276ba422e73c7c1922a0edb9ae1281d055610864b740231c606"
  },
  "sqlDump": null
}
```

Local proof log:

- `artifacts/stage13/stage13-20260501-224313/logs/46-production-source-backup.log`

## 3.2 Remaining Hard Blockers

The following items are still hard blockers before Stage 14 Batch 2:

- production SQL backup is not available yet because the VDS does not have
  `mysql` / `mysqldump` installed or otherwise available in `PATH`;
- no concrete maintenance/quiesce window has been recorded;
- no concrete quiesce command has been approved;
- cutover owner and go/no-go decision owner have not been named;
- production alerting/monitoring validation has not been confirmed;
- explicit production cutover approval has not been given.

## 4. Stage 11 Readiness Proof

Stage 11 readiness remains PASS:

- `docs/architecture/mysql-84-stage11-batch4-acceptance.md` records Stage 11
  Batch 4 PASS;
- `audit_events` and `outbox_events` are runtime tables, not schema-only;
- post-commit dispatch is centralized through
  `server/realtime/postCommitDispatcher.js`;
- rollback no-event behavior is covered by SQL tests;
- realtime/SSE remains a targeted refresh signal and not correctness authority;
- full Stage 13 E2E passed with realtime/domain fallback coverage.

Accepted Stage 13 proof:

- `artifacts/stage13/stage13-20260501-224313/logs/30-full-e2e-after-fixes.log`
- result: `156 passed`, `11 skipped`, `EXIT_CODE=0`

## 5. Stage 12 JSON Authority Removal Proof

Stage 12 readiness remains PASS:

- `POST /api/data` / snapshot authority is covered by
  `tests/sql/stage12-snapshot-read-cutover.test.js`;
- runtime E2E setup uses SQL seed/import through `seedSqlFixture(...)`;
- route-critical E2E passed without full snapshot authority;
- `tests/e2e/28.stage13-removal-path-contract.spec.js` passed in full E2E;
- active `/api/messages/*` routes are absent;
- remaining JSON paths are import, reconciliation, backup/export, diagnostic or
  read-only compatibility.

Accepted Stage 13 proof:

- `artifacts/stage13/stage13-20260501-224313/stage13-batch2-result.md`
- `docs/architecture/mysql-84-stage13-batch3-acceptance.md`

## 6. Exact Cutover Command Sequence

Do not run these commands until the user explicitly approves production
cutover and confirms the production target.

1. Confirm branch and version intended for deployment.

```powershell
git status --short
git log -1 --oneline --decorate
Get-Content app-version.json
```

2. Confirm production/VDS connection and current runtime process status.

```powershell
ssh <production-host> "hostname; date; pm2 ls"
```

3. Quiesce writes according to the approved maintenance plan.

```powershell
ssh <production-host> "<approved-maintenance-command>"
```

4. Create a fresh production backup set outside the production site/data disk.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/new-backup-set.ps1 `
  -OutputRoot "<approved-production-backup-root>" `
  -SchemaMigrationVersion "<latest-production-schema-migration-version>"
```

If the production host uses MySQL login-path instead of environment passwords:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mysql/new-backup-set.ps1 `
  -MysqlDumpLoginPath "<approved-login-path>" `
  -OutputRoot "<approved-production-backup-root>" `
  -SchemaMigrationVersion "<latest-production-schema-migration-version>"
```

5. Verify backup manifest and archive presence.

```powershell
Get-ChildItem "<approved-production-backup-root>\<backup-id>"
Get-Content "<approved-production-backup-root>\<backup-id>\<backup-id>-manifest.json"
```

6. Deploy the approved publish branch through GitHub/deploy pipeline only.

```powershell
git switch -c <publish-branch>
git push origin <publish-branch>
```

Then run the approved GitHub/VDS deploy process. Do not manually edit site
files on VDS.

7. Run production migrations with approved production env.

```powershell
npm run mysql:migrate
```

8. Enable production SQL source flags/config through the approved deployment
config path.

```text
TSPCC_CARDS_SQL_SOURCE=1
TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE=1
TSPCC_DIRECTORIES_SQL_SOURCE=1
TSPCC_SECURITY_SQL_SOURCE=1
TSPCC_PRODUCTION_SQL_SOURCE=1
TSPCC_PRODUCTION_PLANNING_SQL_SOURCE=1
TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE=1
TSPCC_MESSAGING_PROFILE_SQL_SOURCE=1
TSPCC_MESSAGING_SQL_SOURCE=1
```

9. Restart/reload the app through the approved process.

```powershell
ssh <production-host> "pm2 reload <approved-app-name> --update-env"
```

10. Run post-cutover smoke.

```text
- login/session restore
- /dashboard F5/direct URL
- /cards F5/direct URL
- /cards/<id> F5/direct URL
- /profile/<id> or /user/<id> F5/direct URL
- cards list/detail/edit conflict smoke
- file availability smoke
- directories/security smoke
- production planning/workspace smoke
- messaging/profile/chat smoke
- realtime unavailable fallback smoke
- no writable /api/data authority
```

11. Go/no-go decision.

```text
GO: smoke PASS, monitoring normal, no data-loss or route-loss symptom.
NO-GO: rollback inside approved rollback window.
```

12. Rollback if required inside the approved rollback window.

```powershell
ssh <production-host> "<approved-rollback-command>"
```

Rollback target must be the verified pre-cutover backup set and previous app
version/config. Do not back-sync SQL into JSON.
