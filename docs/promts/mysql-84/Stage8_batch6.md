# MySQL 8.4 Stage 8 Batch 6

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
- Batch 6 можно начинать только после Stage 8 Batch 5 PASS.
- Batch 6 переносит только delayed/defect queue commands.
- Нельзя переносить repair/dispose в этом batch.
- Нельзя переносить derived views or messaging.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 6: delayed and defect queue SQL cutover.

Scope этого batch:
- `/api/production/flow/return`;
- `/api/production/flow/defect`;
- delayed/defect queue state used by `/production/delayed` and
  `/production/defects`;
- route-safe conflict refresh for delayed/defects list and detail routes.

Что сделать:
1. Move delayed state to SQL-owned tables:
   - `production_delays`;
   - related `production_flow_item_states`;
   - related `production_flow_states`;
   - related `production_flow_events`.
2. Move defect state to SQL-owned tables:
   - `production_defects`;
   - related item/flow state/events.
3. Preserve queue semantics:
   - delayed and defect states are business queues, not decorative views;
   - item/sample status transitions must preserve current business meaning;
   - required context/files must stay attached through the existing card/file
     boundary without making files metadata a second execution owner.
4. Preserve `expectedFlowVersion -> 409` and route-safe refresh.
5. Update compatibility projection after authoritative SQL mutation only.
6. Add reconciliation:
   - delayed/defect SQL rows match compatibility queue projection;
   - queue detail routes can be rebuilt from SQL state.

Что нельзя делать:
- не touch repair/dispose;
- не create independent mutable delayed/defect queues outside SQL;
- не use `card.flow.items/samples` as authority after cutover;
- не use `/api/data` or snapshot-save for queue writes;
- не rely on realtime for correctness.

Проверки:
- successful and stale `409` for `/api/production/flow/return`;
- successful and stale `409` for `/api/production/flow/defect`;
- `/production/delayed`, `/production/delayed/:qr`,
  `/production/defects`, `/production/defects/:qr` route stability;
- direct URL/F5 and Back/Forward for delayed/defects routes;
- queue reconciliation from SQL state;
- no planning revision bump.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 8 Batch 6 PASS/FAIL/BLOCKED.
2. Delayed SQL cutover proof.
3. Defect SQL cutover proof.
4. Queue/route stability proof.
5. Conflict/reconciliation proof.
6. Tests/checks run.
7. Remaining blockers for Batch 7.
```

## Ручная проверка после Prompt

Проверить `/production/delayed`, `/production/delayed/:qr`,
`/production/defects`, `/production/defects/:qr`, F5/direct URL and conflict if
possible.
