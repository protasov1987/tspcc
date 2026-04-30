# MySQL 8.4 Stage 8 Batch 9

## Общий префикс

```text
Работай строго по:
- AGENTS.md
- docs/architecture/current-architecture.md
- docs/architecture/current-state.md
- docs/architecture/change-checklist.md
- docs/architecture/mysql-84-target-architecture.md
- docs/architecture/mysql-84-migration-plan.md
- docs/business-rules/*.md

Важно:
- Это финальная acceptance-проверка MySQL Stage 8.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 9.
- Acceptance должна подтвердить, что Stage 8 не откатил Stage 6 Batch 3 и
  Stage 7 Batch 5:
  execution/workspace reads and commands не используют directories/security
  или planning JSON slices как authoritative fallback.
- Acceptance должна подтвердить, что риски Stage 8 Batch 1 устранены:
  execution write path SQL-owned, workspace refresh не зависит от
  `/api/data?scope=production`, execution SQL нельзя включить с stale planning
  snapshot source.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 9: приемку Production Execution and Workspace SQL
Cutover.

Проверь exit criteria:
- production execution source of truth is SQL;
- execution SQL cutover requires SQL planning source;
- flow version is SQL-enforced through `production_flow_states.flow_version`;
- flow history is preserved in `production_flow_events`;
- normalized flow slices are SQL-owned:
  `production_flow_item_states`, `personal_operations`,
  `production_material_issues`, `production_material_returns`,
  `production_drying_records`, `production_delays`, `production_defects`,
  `production_repairs`, `production_disposals`;
- card-facing `card.flow` and `card_flow_projection` are projection/read model,
  not write authority;
- workspace conflict behavior unchanged and route-safe;
- realtime is not required for correctness;
- `/api/production/execution/scope` is the production workspace refresh
  endpoint;
- `/api/data?scope=production` is SQL-backed compatibility read/export only.

Проверь failure conditions:
- flow state has two authoritative models;
- execution writes update projection without authoritative SQL transaction;
- any critical execution action bypasses SQL domain command;
- execution/workspace reintroduced JSON/snapshot authority for operations,
  areas, users, access levels, shift times or planning state;
- execution/workspace reads planning state from `/api/data` or preserved JSON
  slices instead of Stage 7 SQL planning repository/query layer;
- stale `expectedFlowVersion` can be accepted as success;
- POST `/api/data` can overwrite SQL-owned execution state;
- successful execution command bumps planning revision;
- workspace refresh correctness depends on realtime.

Required checks:
- SQL success/stale `409` for start/pause/resume/reset/complete;
- SQL success/stale `409` for identify and flow commit/transfer;
- SQL success/stale `409` for material issue/return;
- SQL success/stale `409` for drying start/finish/complete;
- SQL success/stale `409` for delayed return/defect;
- SQL success/stale `409` for repair check/options/repair and dispose;
- personal operations success/stale `409`;
- SQL dependency source proof for users/accessLevels/areas/ops/centers/shift
  times/planning tasks/open shifts;
- `/api/data` cannot overwrite execution;
- `/api/data?scope=production` assembled from SQL source;
- `/api/production/execution/scope` used by client production refresh;
- direct URL/F5 for workspace/delayed/defects routes;
- Back/Forward remains compatible with SPA routing contract;
- reconciliation of SQL execution history/projection for representative cards.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 8 PASS/FAIL/BLOCKED.
2. Execution source proof.
3. Flow version/conflict proof.
4. Normalized flow/history proof.
5. Stage 6/7 dependency preservation proof.
6. Compatibility read/write protection proof.
7. Refresh/realtime proof.
8. Tests/checks run.
9. Можно ли начинать Stage 9.
```

## Ручная проверка после Prompt

Проверить workspace, delayed/defects where safe, route stability, F5/direct URL,
Back/Forward and conflict.
