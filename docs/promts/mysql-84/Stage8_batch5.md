# MySQL 8.4 Stage 8 Batch 5

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
- Это MySQL 8.4 Stage 8: Production Execution and Workspace SQL Cutover.
- Batch 5 можно начинать только после Stage 8 Batch 4 PASS.
- Stage 8 Batch 4 PASS уже перенес core workspace execution commands на
  `ProductionExecutionRepository.persistCoreWorkspaceExecutionCommand(...)`:
  `/api/production/operation/start|pause|resume|reset|complete|comment`,
  `/api/production/flow/identify|commit`,
  `/api/production/personal-operation/select|action`.
- Batch 4 уже держит `production_flow_states.flow_version`,
  `production_flow_item_states`, `personal_operations`,
  `production_flow_events`, `card_flow_projection` и card-facing projection
  внутри одной SQL transaction для core command family.
- Batch 5 переносит только material issue/return and drying commands.
- Нельзя переносить delayed/defect/repair/dispose в этом batch.
- Нельзя переносить derived views or messaging.
- Нельзя заново переносить или переписывать уже закрытые Batch 4 core commands;
  можно только использовать/расширять тот же repository transaction boundary.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 5: material issue/return and drying SQL cutover.

Scope этого batch:
- `/api/production/operation/material-issue`;
- `/api/production/operation/material-issue-complete`;
- `/api/production/operation/material-return`;
- `/api/production/operation/drying-start`;
- `/api/production/operation/drying-finish`;
- `/api/production/operation/drying-complete`;
- material/drying reset edge cases only as validation/reconciliation work,
  because `/api/production/operation/reset` was already moved to the Batch 4
  core SQL transaction path.

Что сделать:
1. Reuse the Batch 4 authoritative transaction boundary:
   - no second flow-state authority;
   - no duplicate command pipeline;
   - material/drying writes must extend `ProductionExecutionRepository`
     transaction methods instead of adding raw SQL in `server.js`.
2. Move material issue/return writes to SQL-owned tables:
   - `production_material_issues`;
   - `production_material_returns`;
   - related `production_flow_states`;
   - related `production_flow_events`.
3. Move drying writes to SQL-owned table:
   - `production_drying_records`;
   - related flow state/events.
4. Preserve material/drying blocking rules:
   - material must be issued before dependent operations;
   - material return must respect available quantities;
   - drying cannot start without valid powder/source rows;
   - drying completion cannot bypass active/done row rules.
5. Preserve `expectedFlowVersion -> 409` and route-safe refresh:
   - stale writes fail before material/drying mutation;
   - success increments flow version only;
   - planning revision must not change.
6. Update card-facing projection only after successful authoritative SQL
   transaction.
7. Add reconciliation:
   - material/drying SQL state equals compatibility projection;
   - event history is append-only and survives updates.
8. Audit Batch 4 `reset` behavior for material/drying operations:
   - if reset already keeps material/drying SQL state and projection consistent,
     leave command wiring unchanged and prove it with tests;
   - if reset needs material/drying row cleanup/update, add it inside the same
     repository transaction without moving delayed/defect/repair/dispose.

Что нельзя делать:
- не touch Batch 4 core command behavior beyond the minimum needed to keep
  material/drying SQL state consistent;
- не touch delayed/defect/repair/dispose;
- не use JSON `card.materialIssues` as authoritative state after cutover;
- не update projection without SQL material/drying transaction;
- не add raw material/drying SQL directly to endpoint handlers;
- не change planning revision model;
- не rely on realtime for correctness.

Проверки:
- successful and stale `409` for material issue;
- successful and stale `409` for material issue complete;
- successful and stale `409` for material return;
- successful and stale `409` for drying start/finish/complete;
- material/drying reset edge cases prove SQL state/projection consistency
  without re-cutting `/api/production/operation/reset`;
- blocking rules for material and drying;
- no planning revision bump after successful material/drying command;
- `/workspace` and `/workspace/:qr` route-safe conflict refresh;
- SQL reconciliation for material/drying state and events.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 8 Batch 5 PASS/FAIL/BLOCKED.
2. Material SQL cutover proof.
3. Drying SQL cutover proof.
4. Blocking/conflict proof.
5. Projection/reconciliation proof.
6. Tests/checks run.
7. Remaining blockers for Batch 6.
```

## Ручная проверка после Prompt

Проверить material issue/return and drying where safe, `/workspace`, F5/direct
URL and conflict if possible.
