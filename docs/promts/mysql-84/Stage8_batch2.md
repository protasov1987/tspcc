# MySQL 8.4 Stage 8 Batch 2

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
- Можно менять только execution/workspace SQL cutover scope.
- Нельзя переносить derived views or messaging.
- Нельзя обновлять projection отдельно от authoritative transaction.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 2: реализовать production execution/workspace SQL
source of truth.

Что сделать:
1. Implement production execution repository.
2. Make execution tables authoritative for flow state/version/history,
   delayed/defect/repair/dispose.
3. Move execution commands to SQL transactions.
4. Preserve blocking rules.
5. Preserve `expectedFlowVersion -> 409`.
6. Keep card-facing flow fields as projection/read model only.
7. Preserve targeted workspace/production refresh.
8. Ensure realtime not required for correctness.

Что нельзя делать:
- не create two authoritative flow models;
- не use snapshot-save for execution;
- не change planning revision model;
- не start Stage 9 derived views.

Проверки:
- workspace actions;
- material/drying;
- delayed/defect/repair/dispose;
- stale flow version `409`;
- `/workspace` and `/workspace/:qr` route stability;
- two-tab conflict;
- reconciliation for execution history.

Формат ответа:
1. SQL execution repository implemented.
2. Flow source of truth.
3. Commands moved.
4. Tests/checks run.
5. Remaining compatibility/projection.
```

## Ручная проверка после Prompt

Проверить `/workspace`, одно безопасное execution-действие, F5, conflict if
possible.
