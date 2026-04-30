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
- Batch 5 переносит только material issue/return and drying commands.
- Нельзя переносить delayed/defect/repair/dispose в этом batch.
- Нельзя переносить derived views or messaging.
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
- reset behavior for material/drying operations only where it is directly
  required by these flows.

Что сделать:
1. Move material issue/return writes to SQL-owned tables:
   - `production_material_issues`;
   - `production_material_returns`;
   - related `production_flow_states`;
   - related `production_flow_events`.
2. Move drying writes to SQL-owned table:
   - `production_drying_records`;
   - related flow state/events.
3. Preserve material/drying blocking rules:
   - material must be issued before dependent operations;
   - material return must respect available quantities;
   - drying cannot start without valid powder/source rows;
   - drying completion cannot bypass active/done row rules.
4. Preserve `expectedFlowVersion -> 409` and route-safe refresh.
5. Update card-facing projection only after successful authoritative SQL
   transaction.
6. Add reconciliation:
   - material/drying SQL state equals compatibility projection;
   - event history is append-only and survives updates.

Что нельзя делать:
- не touch delayed/defect/repair/dispose;
- не use JSON `card.materialIssues` as authoritative state after cutover;
- не update projection without SQL material/drying transaction;
- не change planning revision model;
- не rely on realtime for correctness.

Проверки:
- successful and stale `409` for material issue;
- successful and stale `409` for material issue complete;
- successful and stale `409` for material return;
- successful and stale `409` for drying start/finish/complete;
- reset edge cases for material/drying;
- blocking rules for material and drying;
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
