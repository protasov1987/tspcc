# MySQL 8.4 Stage 10 Batch 5 Acceptance

Status: PASS.

This document records the explicit `Stage 10 Batch 5 PASS` artifact required
before MySQL 8.4 Stage 11 outbox/audit/realtime finalization work can start.

It is based on local source review and focused SQL/E2E checks for Stage 5-10.
It does not implement Stage 11 and does not wire realtime/outbox to domains.

## Required Prerequisites

Result: PASS.

The following prerequisite stages are accepted for Stage 11 Batch 2 entry:

| Required gate | Result | Proof summary |
|---|---|---|
| Stage 5 Batch 3 | PASS | Cards and card files use `CardsRepository` / `CardFilesRepository`, revision-safe API contracts, and guarded legacy snapshot compatibility. |
| Stage 6 Batch 3 | PASS | Directories/security use `DirectoriesRepository` / `SecurityRepository`, revision/conflict contracts, and protected snapshot overwrite behavior. |
| Stage 7 Batch 5 | PASS | Production planning uses `ProductionPlanningRepository`, domain planning revisions, targeted planning endpoints, and ignores legacy snapshot planning mutations. |
| Stage 8 Batch 9 | PASS | Production execution/workspace use `ProductionExecutionRepository`, SQL flow versions, command-family SQL boundary, and protected execution compatibility fields. |
| Stage 9 Batch 5 | PASS | Derived views use `DerivedViewsRepository`, read-only Stage 9 endpoints, SQL source guards, and no authoritative `/api/data?scope=production` read path in the repository/client source scan. |
| Stage 10 Batch 5 | PASS | Messaging/profile/notifications use `MessagingProfileRepository`; `/api/chat/*` is the primary messaging stack; `/api/messages/*` is absent; WebPush/FCM/profile actions are SQL-owned. |

## Source-Of-Truth Proof

Result: PASS.

Runtime repository boundaries are present in `server.js`:

- `CardsRepository`
- `CardFilesRepository`
- `DirectoriesRepository`
- `SecurityRepository`
- `ProductionPlanningRepository`
- `ProductionExecutionRepository`
- `DerivedViewsRepository`
- `MessagingProfileRepository`

SQL source guards are present for dependent stages:

- production execution requires production, planning, cards and
  directories/security SQL source flags;
- derived views require accepted cards, directories/security, planning and
  execution SQL source domains;
- messaging/profile requires Stage 6 security SQL state.

Legacy snapshot protection is present through
`preserveProtectedSlicesForLegacySnapshot(...)` and keeps migrated slices from
being overwritten by `POST /api/data`.

## Checks Run

Result: PASS.

Focused SQL suite:

```text
npm run test:sql
```

Observed result:

- `72` passed;
- `0` failed;
- `2` skipped optional local/live MySQL checks.

Focused E2E suite for Stage 5-10 and snapshot guards:

```text
npx playwright test tests/e2e/05.cards-core-routes.spec.js tests/e2e/06.cards-core-conflict.spec.js tests/e2e/13.card-files-revision.spec.js tests/e2e/15.directories-domain-api.spec.js tests/e2e/16.security-domain-foundation.spec.js tests/e2e/17.security-users-routes.spec.js tests/e2e/18.security-access-levels-routes.spec.js tests/e2e/19.security-landing-timeout-propagation.spec.js tests/e2e/20.production-planning-foundation.spec.js tests/e2e/21.production-execution-contract.spec.js tests/e2e/22.workorders-derived-view.spec.js tests/e2e/23.messaging-profile-deeplink.spec.js tests/e2e/24.notification-contracts.spec.js tests/e2e/28.stage13-removal-path-contract.spec.js
```

Observed result:

- `80` passed;
- `0` failed;
- `7` skipped.

The skipped tests were the Stage 9 derived route UI suite in
`tests/e2e/22.workorders-derived-view.spec.js`. They are intentionally gated by
SQL-source environment flags for cards, directories/security, planning and
execution.

The gated Stage 9 suite was then run separately with the required SQL-source
flags:

```text
TSPCC_CARDS_SQL_SOURCE=1
TSPCC_DIRECTORIES_SECURITY_SQL_SOURCE=1
TSPCC_PRODUCTION_PLANNING_SQL_SOURCE=1
TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE=1
TSPCC_PRODUCTION_SQL_SOURCE=1
npx playwright test tests/e2e/22.workorders-derived-view.spec.js
```

Observed result:

- `7` passed;
- `0` failed;
- `0` skipped.

Stage 9 repository/source-guard proof is also covered by
`tests/sql/derived-views-repository.test.js`, including:

- derived read model repository uses SELECT/read-only queries;
- derived server endpoints use `DerivedViewsRepository`;
- derived endpoint guard requires accepted SQL source domains;
- client derived route loader source scan avoids production snapshot authority.

## Stage 10 Acceptance Decision

Stage 10 Batch 5 PASS.

Messaging, profile and notifications are accepted as SQL-backed for Stage 11
entry:

- `/api/chat/*` is the single active messaging write stack;
- active `/api/messages/*` routes are absent;
- chat users, conversations, messages, delivered/read/unread states and unread
  counts are served through `MessagingProfileRepository`;
- profile actions are owned by the profile/audit boundary;
- WebPush subscriptions and FCM tokens are owned by the current authenticated
  SQL user identity;
- messaging/profile compatibility snapshot is read-only export from SQL-backed
  tables;
- realtime remains a signal and is not required for correctness.

## Stage 11 Readiness Decision

Stage 11 Batch 2 may proceed to shared audit/outbox foundation work, limited to
repository/helpers, transaction integration, post-commit dispatcher boundary
and focused tests.

Stage 11 must still preserve the Stage 11 constraints:

- do not wire all domains in Batch 2;
- do not emit success live events before SQL commit;
- do not use live/SSE as write confirmation;
- do not make failed dispatch roll back an already committed domain write;
- do not make realtime a source of correctness.
