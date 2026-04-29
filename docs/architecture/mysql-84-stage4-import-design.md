# MySQL 8.4 Stage 4 Import Design

Status: Stage 4 Batch 1 design/audit artifact.

This document defines the JSON/files import, validation and reconciliation dry
run pipeline for MySQL 8.4. It is a design contract for later Stage 4
implementation batches. It does not add importer code, does not change runtime
behavior, does not write to production MySQL and does not change production
JSON or files.

Authoritative inputs:

- `docs/architecture/current-architecture.md`
- `docs/architecture/current-state.md`
- `docs/architecture/change-checklist.md`
- `docs/architecture/mysql-84-target-architecture.md`
- `docs/architecture/mysql-84-migration-plan.md`
- `docs/architecture/mysql-84-stage0-inventory.md`
- `docs/business-rules/*.md`
- `migrations/mysql/*.sql`
- `server/persistence/mysql/migrations/runner.js`

## Stage 3 Readiness Gate

Stage 4 implementation may start only after Stage 3 schema and migration runner
acceptance is PASS or after a blocker is explicitly documented as not blocking
importer design.

Current Stage 3 design basis:

- Stage 3 migrations exist under `migrations/mysql/`.
- Migration runner exists under `server/persistence/mysql/migrations/runner.js`.
- Runtime entry point remains `server.js`; migration command is separate:
  `npm run mysql:migrate`.
- Stage 3 schema decisions are represented in migrations:
  - current `centers[]` target table is `work_centers`;
  - cards are normalized across `cards`, `card_operations`, lifecycle/log,
    serial/quantity and attachment tables;
  - `card_initial_snapshots_archive` is archive/read-only compatibility;
  - production shift initial/close snapshots are archive/read-only tables;
  - `production_flow_states` and `production_flow_events` are authoritative for
    execution flow state/history/version;
  - `card_flow_projection` is a projection/read model, not flow authority;
  - `user_actions` exists as the single profile/audit-owned action table.

If a later implementation run cannot execute the migrations on an empty local
test DB because MySQL credentials are unavailable, that is an environment
blocker for implementation verification, not a reason to change the design.

## 1. Import Pipeline Design

The importer is a controlled offline dry-run tool under `scripts/mysql/` or an
equivalent migration tooling area. It must use the existing Stage 2/3 MySQL
boundary and migration runner; it must not create a second raw SQL connection
pipeline and must not be imported by normal server boot.

Pipeline phases:

1. Resolve explicit inputs:
   - JSON snapshot path, defaulting to a copied `data/database.json` snapshot;
   - card file storage copy path, defaulting to a copied `storage/cards/`;
   - target test DB connection through migration/test env only;
   - output report directory.
2. Assert target DB is a clean test database:
   - database name must match an allowlisted test pattern or an explicit
     dry-run flag;
   - production DB name `tspcc_bd` may be used only when the connection is
     explicitly marked local/test and never as production write target;
   - destructive setup is forbidden unless the tool proves it is connected to
     the allowed test target.
3. Apply Stage 3 migrations through the existing migration runner.
4. Read JSON and file storage as read-only inputs.
5. Build source inventory:
   - counts by top-level field;
   - JSON field paths seen;
   - duplicate ID maps;
   - reference maps;
   - file manifest.
6. Run pre-import validation. Fatal validation errors stop before SQL writes.
7. Import into SQL in deterministic FK order inside bounded transactions.
8. Generate projections/read models from authoritative imported source rows
   only after source-domain imports complete.
9. Run post-import reconciliation:
   - JSON/source counts vs SQL counts;
   - reference checks;
   - sample entity equality;
   - file metadata vs physical files;
   - compatibility/unknown field decisions.
10. Write a machine-readable report and a human-readable summary. The importer
    exits non-zero on fatal validation or reconciliation blockers.

The importer must not:

- mutate production JSON;
- mutate or move production files;
- write to production MySQL;
- back-sync SQL data into JSON;
- treat `/api/data` as a SQL endpoint;
- import the whole site into one final JSON table;
- make compatibility fields writable authority.

### Deterministic Import Order

Import order must respect hard FKs and current domain ownership:

1. `access_levels`, `access_level_permissions`
2. `work_centers`, `production_areas`, `operations`,
   `operation_allowed_areas`, `production_shift_times`
3. `users`, `user_sessions` only if persisted snapshot/session data is in
   scope for the selected import
4. `cards`
5. `card_operations`, `card_serials`, `card_quantities`
6. card lifecycle/log/approval/input/provision tables
7. `card_attachments`
8. card archive compatibility: `card_initial_snapshots_archive`
9. production planning: `production_planning_revisions`,
   `production_schedule`, `production_shift_tasks`
10. production shifts/logs and close archive compatibility tables
11. production execution authority: `production_flow_states`,
    `production_flow_events`, item/material/drying/delay/defect/repair/dispose
    tables
12. `card_flow_projection`, derived strictly from authoritative execution rows
13. messaging/profile/notifications: conversations, participants, messages,
    states, visits, web push, FCM
14. `user_actions`, `audit_events`, optional import audit/outbox seed records
    only when explicitly needed for dry-run diagnostics

Each phase should be restartable by recreating the clean test DB, not by
patching partially imported production data.

### Field Mapping Completeness

The importer must begin with the Stage 0 top-level field contract:

| JSON field | Import target |
|---|---|
| `cards` | card aggregate, lifecycle, attachment metadata, execution source fields and compatibility archive |
| `ops` | `operations`, `operation_allowed_areas` |
| `centers` | `work_centers` |
| `areas` | `production_areas` |
| `users` | `users` and owned settings JSON columns |
| `accessLevels` | `access_levels`, `access_level_permissions` |
| `messages` | legacy compatibility report; archive only if non-empty and explicitly approved |
| `chatConversations` | `chat_conversations`, participants |
| `chatMessages` | `chat_messages` |
| `chatStates` | `chat_message_states` and participant read state where applicable |
| `webPushSubscriptions` | `web_push_subscriptions` |
| `fcmTokens` | `fcm_tokens` |
| `userVisits` | `user_visits` |
| `userActions` | `user_actions` only |
| `productionSchedule` | `production_schedule` |
| `productionShiftTimes` | `production_shift_times` |
| `productionShiftTasks` | `production_shift_tasks` |
| `productionShifts` | `production_shifts`, logs and close archive/read-only compatibility tables |
| `meta` | import diagnostics/source metadata only; not a concurrency model |

Any top-level or nested field not present in the Stage 0 inventory must be
reported as an unknown field with owner/removal/conversion decision. Unknown
fields must not be silently ignored. Unknown fields are fatal only when they
belong to authority data or cannot be classified without risking data loss.

### `centers[] -> work_centers`

Current JSON `centers[]` imports into `work_centers`:

- `centers[].id -> work_centers.id`
- `centers[].rev -> work_centers.rev`
- `centers[].name -> work_centers.name`
- `centers[].desc -> work_centers.description`

Card operation references must preserve both machine references and historical
text:

- `cards[].operations[].centerId -> card_operations.work_center_id` when the
  referenced center exists;
- center names/descriptions visible at card creation time must be preserved in
  `work_center_name_snapshot` or an explicitly owned descriptive field;
- missing historical center references are reported. They may be imported with
  `work_center_id = NULL` only if the operation has preserved historical text
  and the report records the broken reference.

### Compatibility Field Handling

Compatibility data is imported only into explicit archive/read-only tables or
reported as transient/removed. It must not become a new write authority.

| Field | Handling |
|---|---|
| `cards[].initialSnapshot` | Import to `card_initial_snapshots_archive` when present. Report count and JSON size. Read-only archive only. |
| `productionShifts[].initialSnapshot` | Import to `production_shift_initial_snapshot_archive`. Validate task/card refs before import. |
| `productionShifts[].closePageDraft` | Import to `production_shift_close_draft_archive` only as shift-close compatibility data. Not global snapshot authority. |
| `productionShifts[].closePageSnapshot` | Import to `production_shift_close_snapshots` as historical close facts. |
| `productionShifts[].closePageSnapshotHistory` | Import to `production_shift_close_snapshot_history`. Preserve event order. |
| transient `__*` card fields | Do not import as authority. Report path/count/sample and classify as transient compatibility. |
| legacy `messages` | If empty, report as empty legacy field. If non-empty, block for owner decision or import to an explicit read-only legacy archive added by a later schema batch. Do not write to `chat_messages` as a parallel stack without mapping. |
| `meta.revision` | Store only in import report/source metadata. It must not initialize domain revisions except where a domain-specific mapping is explicitly documented. |

### Production Execution Authority

Execution flow data currently embedded in cards or production structures must be
imported into production execution authority tables first:

- `production_flow_states`
- `production_flow_events`
- `production_flow_item_states`
- material issue/return tables
- drying/delay/defect/repair/dispose tables

`card_flow_projection` is populated after authoritative execution rows exist.
The projection may preserve card-facing compatibility fields for reads, but it
must be derived and replaceable. Importer implementation must not use projection
rows as the source for execution commands.

### Single `user_actions` Owner

`userActions[]` imports only through `user_actions`. Other domains may reference
or later append actions through a shared audit/profile boundary, but importer
implementation must not create separate per-domain action tables or duplicate
user action authority.

## 2. Validation List By Domain

Validation runs before import and again after SQL import where SQL constraints
or derived checks can catch additional issues.

### Global Snapshot Validation

- JSON parses without duplicate-key ambiguity according to the selected parser
  policy.
- Required top-level fields exist or are explicitly optional for the snapshot.
- All top-level fields have a Stage 0 owner.
- String encoding is valid UTF-8.
- Timestamps are parseable and convertible to UTC `DATETIME(3)` or explicitly
  reported as legacy boundary values.
- Primary IDs are present, non-empty and unique in every collection.
- Exact identifiers use binary-safe comparison rules where the schema expects
  exact identity.
- Unknown fields are reported with owner/removal/conversion decision.

### Cards, Approval, Input Control, Provision

- Required card fields: `id`, `rev`, `cardType`, `approvalStage`, `archived`
  and business identifiers where the current object requires them.
- Duplicate `cards.id`, `qrId`, `barcode`, `routeCardNumber`.
- Valid `cardType`, lifecycle stage, production/status values.
- `rev` is a positive integer.
- Operations have stable IDs, deterministic sequence, valid operation refs and
  valid center/work center refs or preserved historical text.
- Approval thread/event rows keep role context, action type, timestamp, actor
  snapshot and comments.
- Reject reason is present where rejected state requires it.
- Input-control file reference points to an imported attachment or is reported.
- Provision/input-control flags and stage combinations match current business
  semantics.
- Archive remains soft; repeat semantics are not imported as mutation of the
  archived source card.
- Card logs preserve actor, message, action and time where available.
- Transient card fields are classified and not made authoritative.

### Card Files

- Every attachment metadata row has card ID, attachment ID, storage key/folder,
  relative path and display/original name.
- `relPath` is normalized and cannot escape the storage root.
- Duplicate attachment IDs and duplicate `(card_id, rel_path)` are reported.
- Duplicate `PARTS_DOCS` filename rule can be checked from imported metadata.
- Attachment metadata points to an existing physical file in the read-only file
  copy.
- Physical file without metadata is reported as orphan.
- Metadata without physical file is reported as missing file.
- File size matches metadata when metadata has size.
- Checksum is generated or marked unavailable according to the implementation
  policy.

### Directories And Security

- `ops`, `centers`, `areas`, `productionShiftTimes`, `users` and
  `accessLevels` IDs are present and unique.
- `centers[]` maps only to `work_centers`.
- Operation codes are unique under binary-safe comparison.
- Operation type values are valid for planning/execution rules.
- Allowed area IDs exist.
- Area IDs used by planning/execution exist or are reported with guard impact.
- Users have valid access levels.
- `Abyss` exists and is not degraded.
- Password hash/salt fields are present where required and never logged in raw
  form.
- Access level permissions preserve edit-implies-view.
- `landingTab` and `inactivityTimeoutMinutes` are parseable and compatible with
  current route/security rules.

### Production Planning And Shifts

- Production schedule rows reference existing users, areas, dates and shifts.
- Shift time codes exist for referenced shifts or are reported as compatibility
  values requiring owner decision.
- Production shift tasks reference existing cards, route operations, operations
  and areas.
- Planning status/stage combinations preserve non-archived `MKI` and
  `PROVIDED`/`PLANNING`/`PLANNED` visibility rules.
- Planning revisions are domain-specific and not derived from `meta.revision`.
- Production shifts have valid status, date, shift code and positive `rev`.
- Shift logs preserve actor/action/time.
- Close draft/snapshot/history rows preserve order and do not contain missing
  card/task/route operation refs without report entries.

### Production Execution And Workspace

- Every imported flow state has card and route operation identity.
- Flow status and item/quality statuses are valid.
- `flow_version` is positive and reflects the current expected flow version
  where the JSON source has one.
- Flow events/history preserve ordering, actor, expected/resulting version and
  payload.
- Material issue/return quantities are valid and internally consistent.
- Drying rows have valid status and timestamp order.
- Delay/defect/repair/dispose rows preserve reason, status, actor and linked
  item/defect/repair card when available.
- Blocking-rule source data for previous operations, samples, drying, material
  and quality statuses is present or reported.
- Card-facing projection is populated only after authoritative execution import.

### Derived Views

- Workorders, archive, items, OK and OC are validated as read models over
  imported cards and production execution.
- Archive view contains only archived cards.
- Workorders excludes deleted/archived data according to current semantics.
- Items/OK/OC rows match source flow item and defect state.
- No derived view import creates independent mutable state.

### Messaging, Profile, Notifications

- Conversations have stable IDs and valid participants.
- Direct conversation keys are unique.
- System user behavior is preserved; user-initiated direct chat with `system`
  is blocked by validation or reported.
- Messages reference existing conversations.
- Message sender references existing users or explicit `system` sender kind.
- Message `seq` is unique per conversation and preserves ordering.
- Client message IDs are unique per conversation/sender when present.
- Delivered/read state references existing messages and users.
- User visits reference existing users and valid route paths.
- WebPush subscriptions and FCM tokens are user-owned and imported without
  logging raw secrets/tokens.
- `userActions[]` imports only to `user_actions`.

### Routing/Auth Guardrails

Importer design must not change SPA routing/bootstrap. Validation reports must
include route-sensitive domains so later cutover checks can prove direct URL,
F5 and conflict route stability, but Stage 4 dry run itself does not render
pages or alter router code.

## 3. Reconciliation Report Shape

Each dry run produces both:

- `import-reconciliation.json` for automated checks;
- `import-reconciliation.md` or `.html` for human review.

Minimum machine-readable shape:

```json
{
  "run": {
    "startedAt": "UTC datetime",
    "finishedAt": "UTC datetime",
    "appVersion": "from app-version.json",
    "gitCommit": "optional",
    "sourceJsonPath": "path",
    "sourceFilesRoot": "path",
    "targetDbName": "test db",
    "migrationVersions": ["001...", "002..."],
    "status": "PASS|WARN|FAIL|BLOCKED"
  },
  "source": {
    "topLevelCounts": {},
    "fieldPaths": {},
    "unknownFields": []
  },
  "validation": {
    "fatal": [],
    "warnings": [],
    "byDomain": {}
  },
  "import": {
    "insertedRowsByTable": {},
    "convertedFields": [],
    "skippedFields": [],
    "compatibilityArchives": []
  },
  "reconciliation": {
    "countsByDomain": {},
    "sqlCountsByTable": {},
    "sampleEquality": [],
    "brokenReferences": [],
    "projectionChecks": [],
    "manualDecisionsRequired": []
  },
  "files": {
    "metadataRows": 0,
    "physicalFiles": 0,
    "missingFiles": [],
    "orphanFiles": [],
    "sizeMismatches": [],
    "checksumPolicy": "generated|unavailable|mixed"
  }
}
```

Unknown field entries must include:

- JSON path;
- sample count and first safe sample value or redacted marker;
- proposed owner;
- decision: `import`, `archive`, `convert`, `skip-transient`,
  `remove-later`, `block`;
- reason;
- target table/field when applicable.

Skipped fields are allowed only when explicitly classified. Skipping an
unknown authority field is a FAIL.

Automated pre/post comparison must include:

- collection count equality for all source domains;
- SQL row counts by table;
- primary ID set equality for major entities;
- sample deep equality after canonicalization for cards, operations, users,
  access levels, planning rows, shift tasks, shifts, messages and user actions;
- projection checks proving `card_flow_projection` and derived views can be
  rebuilt from authoritative imported tables;
- file metadata/physical file consistency;
- broken reference counts with Stage 0 baseline categories.

## 4. File Reconciliation Approach

File reconciliation reads from a copied file storage root. It never moves,
deletes, renames or repairs production files.

Required manifest fields:

- normalized storage key/folder;
- relative path;
- absolute source path in the copied root;
- file size;
- modified time;
- optional SHA-256 checksum;
- matched card ID;
- matched attachment ID;
- mismatch classification.

Matching rules:

- resolve card storage key from `card.qrId` first, then documented legacy
  fallback such as barcode only if the current file layout requires it;
- normalize separators and reject `..` traversal;
- match attachment metadata by `(card_id, rel_path)` and by attachment ID;
- compare size when present in metadata;
- generate checksum when enabled, otherwise report checksum unavailable.

Mismatch classes:

- storage folder without matching card;
- card with attachment metadata but missing storage folder;
- physical file without metadata;
- metadata without physical file;
- duplicate attachment ID;
- duplicate `(card_id, rel_path)`;
- invalid/escaping `relPath`;
- size mismatch;
- checksum mismatch when checksums are generated;
- duplicate category filename where business rules require uniqueness.

Importer implementation may insert `card_attachments.checksum_sha256` only for
files it actually hashed during dry run. If checksum generation is skipped, the
report must say so and `checksum_sha256` remains NULL.

## 5. Test DB And Migration Setup

The dry-run importer must create/use a clean test SQL DB through Stage 3
migrations:

1. Load env through existing MySQL env helpers.
2. Require migration/test credentials, not runtime credentials.
3. Refuse to run destructive setup unless the target DB is allowlisted as test.
4. Apply migrations via the existing runner.
5. Verify `schema_migrations` contains every migration used by the report.
6. Run import transactions.
7. Run reconciliation queries.
8. Dispose the test DB or leave it intact only when `--keep-db` is explicitly
   supplied for manual inspection.

Server boot must not be involved. `npm start` must not require migration
credentials, run migrations or run the importer.

Implementation tests for later batches:

- SQL unit/integration tests for validation helpers;
- dry-run fixture import from `tests/e2e/fixtures/baseline-core.database.json`;
- optional local MySQL run gated by env, same pattern as current SQL tests;
- idempotent setup proof: clean DB plus migration history, then importer;
- negative tests for duplicate IDs, broken refs, unknown fields, invalid
  statuses, invalid file paths and production flow version mismatches.

## 6. Blockers Before Implementation

These items must be resolved or explicitly accepted before writing importer
code in Stage 4 Batch 2:

- Confirm Stage 3 acceptance with `npm run test:sql`; run real empty-DB
  migration if local/test MySQL credentials are available.
- Finalize exact allowlists for card lifecycle, production planning/execution,
  quality and shift statuses from current code/business rules.
- Decide checksum policy for Stage 4 dry run: always generate SHA-256, generate
  only on demand, or leave unavailable with a report warning.
- Define redaction rules for report samples containing password hashes, salts,
  push subscription payloads, FCM tokens, session IDs or CSRF/session material.
- Decide whether non-empty legacy `messages` blocks import or receives a
  dedicated read-only archive schema in a later migration.
- Define exact timestamp canonicalization for mixed millisecond and string
  timestamp fields.
- Define large report retention path and cleanup owner for dry-run artifacts.
- Confirm test DB naming/allowlist policy so production DB cannot be used as a
  destructive target by mistake.
- Decide whether import audit rows are needed in `audit_events` or whether the
  reconciliation report is the only audit artifact for dry runs.

Stage 4 Batch 1 result: DESIGN PASS for importer implementation planning. It
does not constitute Stage 4 implementation PASS because no importer code or
dry-run reconciliation has been executed in this batch.
