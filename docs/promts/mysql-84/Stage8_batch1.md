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
- Начинать Stage 8 audit/design можно только после Stage 6 Batch 3 PASS и
  Stage 7 Batch 5 PASS. Если directories/security или planning SQL cutover не
  PASS, зафиксируй blocker вместо проектирования snapshot fallback.
- Stage 7 PASS должен включать proof, что planning reads/writes используют SQL,
  `/api/data?scope=production` является SQL-backed compatibility read/export,
  а JSON planning slices не являются authoritative fallback.
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
   - blocking rules должны опираться на SQL-owned cards, planning,
     directories/security dependencies, а не на stale JSON slices.
   - planning state должен приходить из `ProductionPlanningRepository` /
     SQL-backed planning query layer, а не из legacy snapshot.
6. relationship with card-facing flow projection.
7. tests needed for SQL cutover.

Что нельзя делать:
- не менять code/docs;
- не переносить derived views;
- не создавать second authoritative flow state.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Execution SQL cutover map.
2. Authoritative flow state plan.
3. Command/revision map.
4. Risks/blockers.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
