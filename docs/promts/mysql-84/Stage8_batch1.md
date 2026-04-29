# MySQL 8.4 Stage 8 Batch 1

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
- Batch 1 является audit/design.
- Нельзя менять code в этом batch.
- Нельзя менять derived views или messaging.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 1: audit/design production execution/workspace
SQL cutover.

Проверь:
1. workspace routes and commands.
2. execution actions: start/pause/resume/reset/complete, identify, transfer,
   material issue/return, drying.
3. delayed/defect/repair/dispose flows.
4. flow version/history source.
5. blocking rules.
6. relationship with card-facing flow projection.
7. tests needed for SQL cutover.

Что нельзя делать:
- не менять code/docs;
- не переносить derived views;
- не создавать second authoritative flow state.

Формат ответа:
1. Execution SQL cutover map.
2. Authoritative flow state plan.
3. Command/revision map.
4. Risks/blockers.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
