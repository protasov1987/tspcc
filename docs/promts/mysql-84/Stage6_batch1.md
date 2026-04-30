# MySQL 8.4 Stage 6 Batch 1

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
- Это MySQL 8.4 Stage 6: Directories and Security SQL Cutover.
- Batch 1 является audit/design.
- Нельзя менять код в этом batch.
- Нельзя начинать production planning cutover.
- Учитывай Stage 3 schema decision: current JSON `centers[]` target table is
  `work_centers`; historical text preservation is an application guard, not a
  cascade rewrite.
```

## Промт

```text
Нужно выполнить Stage 6 Batch 1: audit/design directories/security SQL cutover.

Проверь:
1. Departments/`work_centers`, operations, areas, employees, shift times
   commands and mapping from current JSON `centers[]`.
2. Users/access levels/permissions/session related persistence.
3. Current guards:
   department delete, operation type, area delete, historical text.
4. `Abyss`, password validation/uniqueness, landingTab, inactivity timeout.
5. Conflict/revision paths.
6. Snapshot compatibility and removal path.
7. Tests required for SQL cutover.

Что нельзя делать:
- не менять code/docs;
- не переносить production;
- не менять permission semantics.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Directories SQL cutover map.
2. Security SQL cutover map.
3. Guard preservation plan.
4. Risks/blockers.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
