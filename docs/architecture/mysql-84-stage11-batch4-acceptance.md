# MySQL 8.4 Stage 11 Batch 4 Acceptance

Status: PASS.

This document records the explicit `Stage 11 Batch 4 PASS` artifact required
before MySQL 8.4 Stage 12 JSON snapshot authority removal planning can start.

It is based on local source review, mandatory SQL checks and focused E2E checks
for realtime, audit and outbox finalization. It does not start Stage 12 and does
not remove JSON snapshot authority.

## Required Prerequisites

Result: PASS.

| Required gate | Result | Proof summary |
|---|---|---|
| Stage 10 Batch 5 | PASS | `docs/architecture/mysql-84-stage10-batch5-acceptance.md` explicitly accepts messaging/profile/notifications as SQL-backed for Stage 11 entry. |
| Stage 11 Batch 2 foundation | PASS | `docs/version-log.html` records `0.17.33`: shared audit/outbox foundation and post-commit live dispatcher. `npm run test:sql` covers the foundation tests. |
| Stage 11 Batch 3 domain wiring | PASS | `docs/version-log.html` records `0.17.34`: SQL domain commands wired to audit/outbox and post-commit live events. `tests/sql/audit-outbox-domain-wiring.test.js` passed. |

## Outbox And Audit Proof

Result: PASS.

Runtime writes to `audit_events` and `outbox_events` are present and are not
unused schema-only tables:

- `server/repositories/auditOutboxRepository.js` inserts into `audit_events`;
- `server/repositories/auditOutboxRepository.js` inserts into `outbox_events`;
- `server/repositories/auditOutboxRepository.js` marks `outbox_events`
  processed or failed after dispatch.

Source scan found other references only in schema migration, importer table
inventory and tests:

- `migrations/mysql/005_read_models_messaging_audit.sql`;
- `scripts/mysql/import-json-dry-run.js`;
- `tests/sql/audit-outbox-foundation.test.js`;
- `tests/sql/mysql-migrations.test.js`.

The SQL test suite verified:

- `appendAuditAndOutbox(...)` writes audit and outbox rows inside the SQL
  transaction;
- rollback does not run the post-commit dispatch hook;
- outbox dispatch failure marks the outbox row failed without rolling back the
  committed domain write.

## Realtime Post-Commit Proof

Result: PASS.

Post-commit dispatch is centralized through:

- `server/realtime/postCommitDispatcher.js`;
- `createPostCommitDispatchHook(...)` in `server.js`;
- transaction post-commit events in `server/persistence/mysql/transaction.js`;
- repository wiring through `BaseRepository.appendDomainEvent(...)`.

The Stage 11 envelope contract was verified by SQL tests:

- `domain`;
- `entity`;
- `id`;
- `rev` or `version`;
- `eventType`;
- `timestamp`.

Existing SSE compatibility event names remain targeted refresh signals only:

- card and planning/execution compatibility can dispatch through
  `cards:changed` or structured card event names;
- chat/profile compatibility dispatches targeted messaging events to user
  recipients;
- client source scan verifies card live events are refresh hints and chat live
  events call `scheduleChatLiveRefresh(...)` instead of trusting payloads as
  authoritative state.

No checked path requires realtime for correctness. Focused E2E covers live
unavailable fallback for cards, directories/security, production planning and
workspace. Messaging/profile E2E covers route refresh, invalid command rollback
and F5 without realtime dependency.

## Representative Domain Event Coverage

Result: PASS.

Accepted SQL domains covered by source scan and focused E2E:

- cards and card files:
  `card.created`, `card.updated`, `card.deleted`, `card.files-updated`;
- directories and security:
  departments, operations, areas, employees, shift times, users and access
  levels;
- production planning and production execution:
  planning slice refresh, schedule fallback, workspace flow/comment refresh and
  flow commit propagation;
- messaging/profile/notifications:
  chat message created, delivered/read updates, profile actions/visits,
  WebPush and FCM ownership events.

Messaging/profile/notifications are counted as accepted because
`docs/architecture/mysql-84-stage10-batch5-acceptance.md` records explicit
`Stage 10 Batch 5 PASS`.

## Diagnostics Proof

Result: PASS.

Diagnostics are preserved:

- `[LIVE]` in `server/realtime/postCommitDispatcher.js`,
  `js/app.00.state.js`, `js/app.95.messenger.js` and related live refresh
  handlers;
- `[DATA]` in server domain writes and client targeted refresh paths;
- `[CONFLICT]` in conflict responses and conflict refresh paths;
- `[DB]` in SQL query, transaction, pool, migration and outbox failure paths.

`tests/e2e/29.diagnostics-prefix-contract.spec.js` passed and scans normalized
application diagnostics prefixes.

## Checks Run

Result: PASS.

Mandatory SQL suite:

```text
npm run test:sql
```

Observed result:

- `78` passed;
- `0` failed;
- `2` skipped optional local/live MySQL checks.

Focused E2E suite:

```text
npx playwright test tests/e2e/26.realtime-cards-live-contract.spec.js tests/e2e/27.realtime-directories-security-contract.spec.js tests/e2e/25.realtime-production-workspace-contract.spec.js tests/e2e/23.messaging-profile-deeplink.spec.js tests/e2e/24.notification-contracts.spec.js tests/e2e/29.diagnostics-prefix-contract.spec.js
```

Observed result:

- `35` passed;
- `0` failed;
- `2` skipped.

The two skipped tests are workorders detail live refresh scenarios gated by
`hasDerivedSqlSourceEnv()` in
`tests/e2e/25.realtime-production-workspace-contract.spec.js`. They are not a
Stage 11 blocker because the required representative production planning and
workspace live/fallback scenarios passed in the same focused run.

## Stage 11 Acceptance Decision

Stage 11 Batch 4 PASS.

Realtime, audit and outbox finalization is accepted for the current MySQL 8.4
migration stage:

- realtime reflects committed SQL state;
- audit/outbox path is consistent across accepted SQL domains;
- failed transactions do not emit success live/outbox dispatch;
- live events follow the Stage 11 envelope contract;
- SSE compatibility names remain targeted refresh hints;
- no checked domain requires realtime for correctness;
- `[LIVE]`, `[DATA]`, `[CONFLICT]` and `[DB]` diagnostics are preserved.

Stage 12 may start after this PASS artifact. Stage 12 must still preserve the
current SPA/domain architecture and must not use JSON authority removal to mask
future realtime, audit or outbox regressions.
