# MySQL 8.4 Stage 8 Execution Compatibility Removal Path

Status: active removal path after Stage 8 Batch 8.

This document records the read-only compatibility boundary for production
execution/workspace after the Stage 8 SQL cutover. It does not authorize new
legacy writes.

## Compatibility Fields

The following legacy JSON/snapshot fields remain compatibility/export fields
only after production execution SQL source is enabled:

- `cards[].flow`
- `cards[].personalOperations`
- `cards[].materialIssues`
- `cards[].materialReturns`
- `cards[].operations[].flowStats`
- `cards[].operations[].comments`
- delayed/defect/repair/dispose state represented through `cards[].flow`
- `meta.revision` and `meta.domainRevisions.*` as snapshot metadata, not
  execution concurrency authority

Authoritative source:

- `production_flow_states`
- `production_flow_events`
- `production_flow_item_states`
- `personal_operations`
- `production_material_issues`
- `production_material_returns`
- `production_drying_records`
- `production_delayed_items`
- `production_defect_items`
- `production_repairs`
- `production_disposals`
- `card_flow_projection` as a read projection, not an independent owner

## Current Boundary

- Client production workspace refresh uses `GET /api/production/execution/scope`.
- Legacy `GET /api/data?scope=production` remains SQL-backed read/export
  compatibility.
- Legacy `POST /api/data` must preserve SQL-owned execution compatibility
  fields from server truth. It must not initialize, repair, reverse-sync or
  overwrite execution SQL state.
- Realtime/SSE may schedule refreshes, but correctness comes from committed SQL
  state and targeted refresh.

## Removal Checks

Before removing execution compatibility fields from `/api/data` and the client
store, all checks below must pass:

- No client production/workspace route uses `/api/data?scope=production` for
  normal refresh.
- Direct URL/F5/Back/Forward pass for `/workspace`, `/workspace/:qr`,
  `/production/delayed/:qr` and `/production/defects/:qr`.
- Conflict refresh after stale `expectedFlowVersion` preserves the current
  route and refreshes through `/api/production/execution/scope`.
- Legacy `POST /api/data` cannot overwrite SQL-owned execution fields.
- `/api/data?scope=production` is still SQL-backed if it remains exposed.
- SQL reconciliation passes for flow state/events, delayed/defect queues,
  repair/dispose, material and drying rows.
- Realtime unavailable fallback passes for workspace/execution routes.
- Derived views in Stage 9 no longer depend on legacy execution projection as
  an authority source.

## Owner And Sequence

Owner: production execution repository owner.

Removal sequence:

1. Stage 9: keep compatibility read-only while derived views move to SQL read
   models.
2. Stage 13: after rehearsal proves domain reads, conflicts and route fallback,
   remove client dependence on execution compatibility fields from full
   snapshot hydration.
3. Stage 15: delete remaining `/api/data?scope=production` execution
   compatibility payload fields or keep them only as explicitly named
   diagnostic/export output.
4. Remove `LEGACY_SNAPSHOT_EXECUTION_COMPATIBILITY_FIELDS` and the POST
   `/api/data` execution guard only after POST `/api/data` is removed or cannot
   accept snapshot payloads.

Rollback before removal is the existing read-only compatibility export. After
removal, rollback is restore from verified SQL/file backup, not snapshot
reverse-sync.
