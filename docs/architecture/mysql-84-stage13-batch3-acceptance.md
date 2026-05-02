# MySQL 8.4 Stage 13 Batch 3 Acceptance

Status: PASS.

This document records the final Stage 13 Production Cutover Rehearsal
acceptance. It does not authorize production cutover by itself and does not
change production authority.

## 1. Stage 13 PASS/FAIL/BLOCKED

Stage 13 Batch 3 result: PASS.

Accepted rehearsal:

- Rehearsal ID: `stage13-20260501-224313`
- Result artifact:
  `artifacts/stage13/stage13-20260501-224313/stage13-batch2-result.md`
- Version snapshot after fixes: `0.17.40`
- Local backup branch/commit:
  `0.17.40-02052026-0200` / `22f7be9`

No unresolved Stage 13 blockers remain.

## 2. Rehearsal Proof

The rehearsal completed from a clean local/test environment:

- target DB: `tspcc_bd_stage13_rehearsal_224313_test`;
- runtime user grants validated for `tspcc_app`;
- migrations applied from repository history;
- importer and reconciliation completed without fatal validation errors;
- production-like JSON/file inputs were used only as import/reconciliation
  inputs.

Primary proof:

- `artifacts/stage13/stage13-20260501-224313/inputs/input-manifest.json`
- `artifacts/stage13/stage13-20260501-224313/inputs/sanitization-report.json`
- `artifacts/stage13/stage13-20260501-224313/import/import-reconciliation.md`
- `artifacts/stage13/stage13-20260501-224313/logs/03-mysql-migrate.log`
- `artifacts/stage13/stage13-20260501-224313/logs/04-import-json-reconciliation.log`

Reconciliation result:

- Status: PASS
- Mode: `sql-import`
- Target DB: `tspcc_bd_stage13_rehearsal_224313_test`
- Fatal validation errors: 0
- Warnings: 0
- Missing physical files: 0 after sanitized input cleanup

## 3. Backup/Restore Proof

Backup/restore result: PASS.

Backup set:

- backup id: `mysql84-stage13-20260502T015651`
- manifest:
  `artifacts/stage13/stage13-20260501-224313/backup/mysql84-stage13-20260502T015651/mysql84-stage13-20260502T015651-manifest.json`
- SQL dump:
  `artifacts/stage13/stage13-20260501-224313/backup/mysql84-stage13-20260502T015651/mysql84-stage13-20260502T015651.sql`
- file archive:
  `artifacts/stage13/stage13-20260501-224313/backup/mysql84-stage13-20260502T015651/mysql84-stage13-20260502T015651-card-files.zip`

Restore target:

- DB: `tspcc_bd_stage13_restore_224313_test`
- restored files:
  `data/restore-rehearsals/mysql84-stage13-20260502T015651/cards`
- restore report:
  `data/restore-rehearsals/mysql84-stage13-20260502T015651/restore-rehearsal-report.json`

Accepted logs:

- backup PASS:
  `artifacts/stage13/stage13-20260501-224313/logs/34-backup-login-path-pwsh.log`
- restore PASS:
  `artifacts/stage13/stage13-20260501-224313/logs/36-restore-rehearsal-utf8.log`
- post-restore DB health PASS:
  `artifacts/stage13/stage13-20260501-224313/logs/41-post-restore-health-pass.log`
- post-restore HTTP smoke PASS:
  `artifacts/stage13/stage13-20260501-224313/logs/45-post-restore-http-smoke-pass.log`

The restore rehearsal restored SQL and file storage into a separate test target.
No production data or VDS files were touched.

## 4. 20-User Proof

20-user representative scenario result: PASS.

The accepted 20-client scenario ran in full E2E:

- spec: `tests/e2e/02.workspace-realtime.spec.js`;
- scenario: `supports 20 concurrent live clients observing one confirmed change`;
- log:
  `artifacts/stage13/stage13-20260501-224313/logs/30-full-e2e-after-fixes.log`.

Full E2E result:

- `156 passed`;
- `11 skipped`;
- `EXIT_CODE=0`.

No pool exhaustion, route loss, forced redirect to `/dashboard` or silent data
overwrite was observed in the accepted full E2E run.

## 5. Stage 12 JSON Removal Rehearsal Proof

Result: PASS.

Stage 12 Batch 6 did not have a separate tracked acceptance document in this
repository. The Stage 13 acceptance therefore relies on the Stage 12 prompt
contract, version-log history, SQL/E2E proof and rehearsal proof below.

Rehearsal proof:

- production-like JSON snapshot was import/reconciliation input only;
- E2E runtime used `TSPCC_E2E_SQL_SEED=1` and `seedSqlFixture(...)`;
- `tests/e2e/helpers/sqlSeed.js` runs
  `scripts/mysql/import-json-dry-run.js --execute --reset-import`;
- runtime E2E did not copy `data/database.json` as authority;
- `tests/sql/stage12-snapshot-read-cutover.test.js` was included in
  `npm run test:sql`;
- `tests/e2e/28.stage13-removal-path-contract.spec.js` passed in full E2E;
- active `/api/messages/*` routes are absent;
- remaining JSON paths are import, reconciliation, backup/export, diagnostic or
  read-only compatibility paths.

Accepted logs:

- SQL tests:
  `artifacts/stage13/stage13-20260501-224313/logs/05-test-sql.log`
- focused E2E:
  `artifacts/stage13/stage13-20260501-224313/logs/20-focused-e2e-full-rerun.log`
- full E2E:
  `artifacts/stage13/stage13-20260501-224313/logs/30-full-e2e-after-fixes.log`

## 6. Stage 6 Rehearsal Proof

Result: PASS.

Directories/security SQL source of truth and overwrite protection were covered
in the full rehearsal by:

- `tests/e2e/15.directories-domain-api.spec.js`
- `tests/e2e/16.security-domain-foundation.spec.js`
- `tests/e2e/17.security-users-routes.spec.js`
- `tests/e2e/18.security-access-levels-routes.spec.js`
- `tests/e2e/19.security-landing-timeout-propagation.spec.js`
- `tests/e2e/28.stage13-removal-path-contract.spec.js`

The accepted full E2E run passed over SQL runtime state.

## 7. Stage 7 Planning Rehearsal Proof

Result: PASS.

Planning/execution SQL source, stale conflict handling, production read/export
status, planning overwrite protection and route stability were covered by:

- `tests/e2e/20.production-planning-foundation.spec.js`
- `tests/e2e/21.production-execution-contract.spec.js`
- `tests/e2e/22.workorders-derived-view.spec.js`
- `tests/e2e/25.realtime-production-workspace-contract.spec.js`
- `tests/e2e/30.stage14-domain-conflict-coverage.spec.js`

The accepted full E2E run passed over SQL runtime state.

## 8. Stage 10 Messaging/Profile Rehearsal Proof

Result: PASS.

Messaging/profile/notifications SQL source, profile privacy, WebPush/FCM
ownership, delivered/read/unread handling, deeplinks and absence of the legacy
`/api/messages/*` stack were covered by:

- `tests/e2e/23.messaging-profile-deeplink.spec.js`
- `tests/e2e/24.notification-contracts.spec.js`
- `tests/e2e/28.stage13-removal-path-contract.spec.js`

Additional prerequisite proof remains recorded in
`docs/architecture/mysql-84-stage10-batch5-acceptance.md`.

## 9. Stage 14 Entry Decision

Stage 14 Batch 1 readiness check may start.

Production cutover itself must not start without a separate explicit user
approval. Stage 14 Batch 1 is limited to readiness verification, command
sequence review and blocker/approval status.
