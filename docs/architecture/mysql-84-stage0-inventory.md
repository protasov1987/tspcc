# MySQL 8.4 Stage 0 Inventory

Status: Stage 0 Batch 2 inventory artifact.

This document records the current JSON/runtime inventory after Stage 0 Batch 1
cleanup. It is input for SQL schema design and importer planning only. It does
not start MySQL implementation and does not change runtime behavior.

Authoritative architecture contracts remain:

- `docs/architecture/current-architecture.md`
- `docs/architecture/current-state.md`
- `docs/architecture/mysql-84-target-architecture.md`
- `docs/architecture/mysql-84-migration-plan.md`
- `docs/business-rules/*.md`

## Source Snapshot

Inventory source:

- runtime database: `data/database.json`
- physical card storage: `storage/cards/`
- cleanup proof baseline: Stage 0 Batch 1d PASS after residual production
  snapshot refs cleanup

Current runtime top-level counts:

| JSON field | Count / shape |
|---|---:|
| `cards` | 30 |
| `ops` | 41 |
| `centers` | 8 |
| `areas` | 12 |
| `users` | 16 |
| `accessLevels` | 6 |
| `messages` | 0 |
| `chatConversations` | 4 |
| `chatMessages` | 422 |
| `chatStates` | 5 |
| `webPushSubscriptions` | 2 |
| `fcmTokens` | 0 |
| `userVisits` | 699 |
| `userActions` | 1539 |
| `productionSchedule` | 457 |
| `productionShiftTimes` | 3 |
| `productionShiftTasks` | 68 |
| `productionShifts` | 148 |
| `meta` | object, 2 keys |

Runtime top-level shape contains only expected normalized fields. Removed
fixture-only field `productionScheduleSlotRevisions` is absent.

## Domain Ownership

| Domain | Current JSON fields | Target owner | Target SQL area |
|---|---|---|---|
| Cards aggregate | `cards[]` base fields, `operations[]`, `logs[]`, `approvalThread[]`, lifecycle fields, `rev` | cards repository | `cards`, `card_operations`, `card_logs`, `card_approval_events`, lifecycle sub-tables or columns |
| Card files metadata | `cards[].attachments[]`, `inputControlFileId` | card files repository | `card_attachments`, file category/linkage tables if needed |
| Card flow projection | `cards[].flow`, `personalOperations`, `materialIssues`, `materialReturns`, operation flow counters | production execution repository owns source; cards read model may expose projection | production execution tables plus derived card-facing projection |
| Directories | `ops`, `centers`, `areas`, `productionShiftTimes` | directories repository | `operations`, `work_centers`, `production_areas`, `production_shift_times` |
| Security | `users`, `accessLevels` | security repository | `users`, `access_levels`, permission tables or JSON columns with owner |
| Production planning | `productionSchedule`, `productionShiftTasks`, planning fields on cards | production planning repository | `production_schedule`, `production_shift_tasks`, planning aggregate revision tables |
| Production shifts / close | `productionShifts`, `closePageDraft`, `closePageSnapshot`, `closePageSnapshotHistory`, `initialSnapshot`, `logs` | production planning or shift-close repository | `production_shifts`, `production_shift_logs`, close snapshot/history archive tables |
| Production execution | `cards[].flow`, flow events/items/samples, delayed/defect/repair/dispose state, material/drying rows | production execution repository | flow state, flow events/history, item/sample state, material/drying tables |
| Derived views | workorders/archive/items/ok/oc are derived from `cards` and production fields | read model/query layer | read-only SQL views/query models, no write authority |
| Messaging/profile | `chatConversations`, `chatMessages`, `chatStates`, `userActions`, `userVisits` | messaging/profile/audit repository | conversations, messages, delivery/read state, user actions, visits |
| Notifications | `webPushSubscriptions`, `fcmTokens` | messaging/profile/notifications repository | push subscriptions, FCM tokens |
| Legacy messaging compatibility | `messages` | no new owner; read-only/removal compatibility | remove or archive after `/api/chat/*` SQL cutover |
| Meta/revision compatibility | `meta` | persistence boundary / migration diagnostics | not a global concurrency model; use domain revisions |

## JSON Field To SQL Mapping

### Cards

| JSON field | Target table/domain | Notes |
|---|---|---|
| `cards[].id` | `cards.id` | Preserve IDs. Primary key candidate. |
| `cards[].rev` | `cards.rev` | Required optimistic revision. Starts from imported value. |
| `cards[].qrId`, `barcode`, `routeCardNumber` | `cards` unique/business identifiers | Preserve exact values; use binary-safe/canonical comparison where needed. |
| `cardType`, `status`, `productionStatus`, `archived` | `cards` lifecycle/status columns | Validate allowed values during import. |
| `approvalStage`, `approvalProductionStatus`, `approvalSKKStatus`, `approvalTechStatus` | card lifecycle / approval columns | Preserve stage semantics from business rules. |
| `approvalThread[]` | `card_approval_events` | Append-style history; preserve `ts`, `userName`, `actionType`, `roleContext`, `comment`. |
| `rejectionReason`, `rejectionReadByUserName`, `rejectionReadAt` | card lifecycle columns/events | Reject reason must not be lost. |
| `inputControl*`, `provision*`, responsible chief fields | card lifecycle columns/events | Preserve input-control/provision transitions. |
| base descriptive fields such as `name`, `itemName`, `itemDesignation`, `document*`, `mainMaterials`, `quantity`, `batchSize`, serial arrays | `cards`, `card_serials`, optional JSON-owned attributes | Normalize serials where used by flow; document any JSON column owner. |
| `operations[]` | `card_operations` | Preserve `id` as route operation ID and `opId`/`centerId` references. |
| `operations[].comments`, counters, blocking flags | card operation projection or execution read model | Source authority must be production execution after cutover if flow-owned. |
| `logs[]` | `card_logs` / audit | Preserve audit trail. |
| `attachments[]` | `card_attachments` | See file baseline. |
| `flow`, `personalOperations`, `materialIssues`, `materialReturns` | production execution tables | Must not become second authority under cards. |
| `initialSnapshot` | compatibility/archive snapshot | Read-only compatibility or archive. Do not use as write authority. |
| `__expectedRevAtOpen`, `__liveFilesCount`, `__liveOpsCount`, `__serialRouteBase` | compatibility/transient fields | Import only if needed for compatibility; not SQL authority. |

### Directories And Security

| JSON field | Target table/domain | Notes |
|---|---|---|
| `ops[].id`, `code`, `name`, `operationType`, `recTime`, `allowedAreaIds`, `rev` | `operations`, operation-area relation | Preserve operation type guards and allowed areas. |
| `centers[].id`, `name`, `desc`, `rev` | `work_centers` | Historical card text must remain readable if directory changes later. |
| `areas[].id`, `name`, `type`, `desc`, `rev` | `production_areas` | Area delete guards depend on planning/execution history. |
| `productionShiftTimes[].shift`, `timeFrom`, `timeTo`, `lunchFrom`, `lunchTo`, `rev` | `production_shift_times` | Production setting, not cosmetic data. |
| `users[].id`, `name`, `role`, `status`, `departmentId`, `accessLevelId`, `rev` | `users` | Preserve `Abyss` and profile/privacy behavior. |
| `users[].passwordHash`, `passwordSalt` | `users` auth fields | Never log or expose raw values. Preserve hash semantics. |
| `users[].printSettings`, `productionSettings` | user preference/settings tables or owned JSON columns | Owner: security/profile. |
| `accessLevels[].id`, `name`, `description`, `permissions`, `rev` | `access_levels`, permission tables or owned JSON | Must preserve `landingTab`, tabs, special roles, inactivity timeout. |

### Production Planning And Shifts

| JSON field | Target table/domain | Notes |
|---|---|---|
| `productionSchedule[]` | `production_schedule` | Validate `employeeId`, `areaId`, date, shift, time fields. |
| `productionShiftTasks[]` | `production_shift_tasks` | Planning object linked to card, route op, area, date/shift. |
| `productionShiftTasks[].planned*`, `remainingQtySnapshot`, `effectiveDeadlineSnapshot` | planning task columns | Snapshot fields may become read model attributes. |
| `productionShiftTasks[].subcontract*` | planning/execution extension tables | Preserve subcontract chain semantics. |
| `productionShifts[].id`, `date`, `shift`, `status`, `opened*`, `closed*`, `locked*`, `fixed*`, `rev` | `production_shifts` | Shift aggregate with revision. |
| `productionShifts[].logs[]` | `production_shift_logs` | Preserve shift audit/history. |
| `productionShifts[].initialSnapshot.tasks` | shift snapshot archive | Archive/read-only. Must not reference missing cards after cleanup. |
| `productionShifts[].closePageDraft` | shift-close draft compatibility | If retained, owner: shift-close domain; do not use as global snapshot write. |
| `productionShifts[].closePageSnapshot`, `closePageSnapshotHistory` | shift-close archive/history | Preserve close rows/facts as historical records; validate card refs. |

### Messaging, Profile And Notifications

| JSON field | Target table/domain | Notes |
|---|---|---|
| `chatConversations[]` | `chat_conversations`, participants table | Preserve direct chat model and participant IDs. |
| `chatMessages[]` | `chat_messages` | Preserve `seq`, `clientMsgId`, `senderId`, `conversationId`, `createdAt`, text. |
| `chatStates[]` | `chat_message_states` | Delivered/read state by user and conversation. |
| `userActions[]` | `user_actions` audit/profile table | Single owner in messaging/profile/audit boundary. |
| `userVisits[]` | `user_visits` | Profile/activity read model. |
| `webPushSubscriptions[]` | `web_push_subscriptions` | User-owned notification data. |
| `fcmTokens[]` | `fcm_tokens` | Currently empty but in migration scope. |
| `messages` | legacy compatibility | Currently empty. Do not reintroduce parallel messaging stack. |

### Meta

| JSON field | Target table/domain | Notes |
|---|---|---|
| `meta` | migration diagnostics / export metadata | `meta.revision` must not become SQL concurrency model for all domains. |

## Compatibility Fields

Compatibility fields that may be imported only as read-only history/export or
with an explicit removal path:

- `cards[].initialSnapshot`
- `cards[].__expectedRevAtOpen`
- `cards[].__liveFilesCount`
- `cards[].__liveOpsCount`
- `cards[].__serialRouteBase`
- `productionShifts[].initialSnapshot`
- `productionShifts[].closePageDraft`
- `productionShifts[].closePageSnapshot`
- `productionShifts[].closePageSnapshotHistory`
- `messages`
- `meta.revision` as snapshot compatibility metadata

Removed/obsolete compatibility field:

- `productionScheduleSlotRevisions` is absent in runtime and fixture after
  Stage 0 cleanup. Do not recreate it.

## File Metadata Reconciliation Baseline

Current runtime file baseline:

| Metric | Value |
|---|---:|
| `storage/cards/<qrId>` dirs | 28 |
| physical files under `storage/cards` | 38 |
| attachment metadata rows | 38 |
| orphan storage dirs | 0 |
| physical files without attachment metadata | 0 |
| broken or empty attachment `relPath` | 0 |
| attachment metadata without physical file | 0 |
| cards with attachments but missing storage folder | 0 |
| attachment `size` availability | present for current metadata |
| attachment checksum/hash availability | not present |

Expected file relation:

- Card attachment metadata is currently embedded in `cards[].attachments[]`.
- Physical file path is derived from card storage key (`qrId` or barcode folder)
  plus `attachments[].relPath`.
- SQL target must store enough metadata to reconcile:
  - card ID;
  - attachment ID;
  - storage key/folder;
  - relative path;
  - category/scope/linkage;
  - original/display name;
  - MIME/type;
  - size;
  - created timestamp.
- Checksums are unavailable in the current metadata and must be either generated
  during import/reconciliation or explicitly marked unavailable in reports.

Missing/orphan categories for importer reports:

- storage folder without card by normalized `qrId`/barcode;
- physical file under valid card folder without attachment metadata;
- attachment metadata with empty/invalid `relPath`;
- attachment metadata whose physical file is missing;
- attachment metadata on card without a resolvable storage folder;
- duplicate attachment IDs or duplicate special-category filenames where domain
  rules require uniqueness.

## Broken Reference Categories

Current runtime reference baseline after cleanup:

| Category | Current count |
|---|---:|
| card operation refs to missing `ops` | 0 |
| card operation refs to missing `centers` | 0 |
| `productionShiftTasks.cardId` missing cards | 0 |
| `productionShiftTasks.areaId` missing areas | 0 |
| `productionShiftTasks.routeOpId` missing card route op | 0 |
| `productionSchedule.employeeId` missing users | 0 |
| `chatMessages.conversationId` missing conversation | 0 |
| `chatMessages.senderId` missing user, excluding `system` | 0 |
| conversation participants missing users, excluding `system` | 0 |
| close-page rows missing cards | 0 |
| shift `initialSnapshot.tasks` missing cards | 0 |

Importer must still report these categories even when current count is zero:

- card -> operation directory reference;
- card -> center directory reference;
- card -> user text/reference where explicit user ID is present;
- production task -> card;
- production task -> operation/route operation;
- production task -> area;
- production schedule -> user/area/shift time;
- production shift close snapshot/history -> card/task/route operation;
- message -> conversation/user;
- chat state -> conversation/user;
- push/FCM subscription -> user;
- attachment -> card and physical file.

## Duplicate And Anomaly Categories

Current duplicate baseline:

| Duplicate category | Current count |
|---|---:|
| `cards.id` | 0 |
| `cards.qrId` | 0 |
| `cards.barcode` | 0 |
| `ops.id` | 0 |
| `centers.id` | 0 |
| `areas.id` | 0 |
| `users.id` | 0 |
| `chatConversations.id` | 0 |
| `chatMessages.id` | 0 |

Current card status distribution:

| Field | Values |
|---|---|
| `cardType` | `MK`: 1, `MKI`: 29 |
| `approvalStage` | `APPROVED`: 4, `DRAFT`: 3, `ON_APPROVAL`: 2, `PLANNED`: 6, `PLANNING`: 3, `PROVIDED`: 10, `WAITING_INPUT_CONTROL`: 2 |
| `status` | `IN_PROGRESS`: 2, `NOT_STARTED`: 26, `PAUSED`: 2 |
| `archived` | `false`: 27, `true`: 3 |

Importer anomaly categories:

- duplicate primary IDs in every top-level collection;
- duplicate or conflicting exact identifiers (`qrId`, barcode, route card
  numbers, message IDs, attachment IDs);
- invalid or unknown lifecycle/status/stage values;
- missing required `rev` on mutable entities where current domain contract
  requires conflict control;
- invalid timestamps or mixed timestamp formats requiring boundary conversion;
- sensitive auth fields missing or malformed (`passwordHash`, `passwordSalt`);
- compatibility/transient fields present in runtime authority paths;
- fixture-only fields present in runtime;
- empty legacy fields that must not become new authority (`messages`).

## Importer Business Invariants

The importer must validate at minimum:

### Cards, Approval And Files

- New/editable card lifecycle stages keep current semantics.
- Reject reason and approval thread are preserved.
- Full approval, input control and provision state are preserved.
- Archive remains soft; repeat creates a new draft card, not unarchive.
- `card.rev` is imported and future writes use `expectedRev`.
- Card logs and business audit trail are preserved.
- Card attachments reconcile with physical files.
- Duplicate `PARTS_DOCS` filename rule remains enforceable.
- `inputControlFileId` must not point to a missing attachment.

### Directories And Security

- Directory IDs used by cards/production remain resolvable or historical text is
  explicitly preserved.
- Department/center/operation/area delete guards remain enforceable after SQL
  cutover.
- Operation type and allowed area rules remain available to planning/execution.
- Users always have valid access levels.
- `Abyss` protection, password validation/uniqueness, `landingTab` and
  `inactivityTimeoutMinutes` remain intact.

### Production And Workspace

- Planning queue eligibility remains based on non-archived `MKI` cards with
  valid operations and allowed stages.
- Workspace eligibility remains tied to actual planned shift operations.
- `productionShiftTasks` link to valid cards, route operations and areas.
- Shift close snapshots/history do not contain missing-card references.
- Flow execution history and `expectedFlowVersion` source data are preserved.
- Delayed, defect, repair, material and drying data retain business meaning.
- Production planning revision must be domain-specific in SQL, not global
  `meta.revision`.

### Messaging, Profile And Notifications

- `/api/chat/*` remains the single messaging write path.
- Direct chat participants, message order, delivered/read state and unread state
  are preserved.
- Dialog with `system` cannot become user-initiated direct chat.
- Profile privacy and deeplink query behavior remain valid.
- Push/FCM tokens remain user-owned.

### Derived Views

- Workorders, archive, items, OK and OC remain read models over cards and
  production source data.
- Archive lists only archived cards.
- Workorders do not become an independent mutable domain.

### Routing/Auth Guardrails

- SQL migration must not change SPA route/bootstrap behavior.
- URL remains source of truth.
- Protected pages render only after session restore.
- Browser Back/Forward and direct URL/F5 behavior remain unchanged.

## Open Questions For Later Stages

- Whether to normalize every card descriptive field immediately or keep some
  low-risk descriptive payload in explicitly owned JSON columns.
- Whether attachment checksums should be generated during Stage 4 import dry run
  or in a separate file reconciliation helper before import.
- Exact SQL ownership split between production planning, shift-close archive and
  production execution for close snapshots and flow projections.
- Whether `cards[].initialSnapshot` and production shift snapshots are retained
  as historical archive tables or exported then removed after reconciliation.
- Exact retention and indexing strategy for high-volume audit/profile data:
  `userActions`, `userVisits`, `chatMessages`.

## Stage 0 Readiness

Stage 0 has enough inventory for the next proof batch when these artifacts are
accepted:

- `JSON field -> SQL domain/table` mapping exists in this document.
- Domain owner and compatibility field classifications exist in this document.
- File metadata reconciliation baseline exists in this document.
- Broken reference and duplicate/anomaly categories exist in this document.
- Importer business invariants are listed and tied to current business rules.

No MySQL implementation, migrations or runtime behavior changes are included in
this batch.
