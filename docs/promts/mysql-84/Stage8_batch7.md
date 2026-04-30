# MySQL 8.4 Stage 8 Batch 7

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
- Batch 7 можно начинать только после Stage 8 Batch 6 PASS.
- Batch 7 переносит repair/dispose flows.
- Нельзя переносить derived views or messaging.
- Repair card creation must remain atomic with source flow update.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 7: repair and dispose SQL cutover.

Scope этого batch:
- `/api/production/flow/repair/check`;
- `/api/production/flow/repair/options`;
- `/api/production/flow/repair`;
- `/api/production/flow/dispose`;
- repair card creation / attach-to-existing behavior;
- dispose state and related required files/context.

Что сделать:
1. Move repair state to SQL-owned tables:
   - `production_repairs`;
   - related `production_defects`;
   - related `production_flow_states`;
   - related `production_flow_events`;
   - repair-card links through cards SQL boundary.
2. Move dispose state to SQL-owned tables:
   - `production_disposals`;
   - related defect/flow state/events.
3. Preserve repair business model:
   - `МК-РЕМ` creation is an explicit business action;
   - create-new and attach-to-existing repair paths must remain atomic;
   - source defect flow and repair card projection must be updated in the same
     authoritative transaction;
   - required files/context must be preserved.
4. Preserve dispose semantics:
   - required confirmation/files remain required;
   - disposed item/sample state must not be lost from history.
5. Preserve `expectedFlowVersion -> 409` and route-safe refresh.
6. Add reconciliation:
   - repair/dispose SQL rows match compatibility projection;
   - source card, repair card and flow events remain consistent.

Что нельзя делать:
- не create repair card through JSON/snapshot authority;
- не split source flow update and repair card update into separate
  non-atomic writes;
- не make repair/dispose derived views authoritative;
- не use `/api/data` for repair/dispose writes;
- не rely on realtime for correctness.

Проверки:
- successful and stale `409` for repair check/options/repair;
- successful and stale `409` for dispose;
- repair create-new and attach-to-existing atomicity;
- required file/context validation;
- source card and repair card reconciliation;
- `/production/defects` and `/production/defects/:qr` route-safe refresh;
- no planning revision bump.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 8 Batch 7 PASS/FAIL/BLOCKED.
2. Repair SQL cutover proof.
3. Dispose SQL cutover proof.
4. Atomic repair-card proof.
5. Conflict/reconciliation proof.
6. Tests/checks run.
7. Remaining blockers for Batch 8.
```

## Ручная проверка после Prompt

Проверить `/production/defects`, `/production/defects/:qr`, one safe repair or
dispose path where possible, F5/direct URL and conflict.
