# MySQL 8.4 Stage 7 Batch 4

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
- Это MySQL 8.4 Stage 7: Production Planning SQL Cutover.
- Batch 4 закрывает shifts lifecycle, shift-close и production compatibility
  read/export после Batch 2/3.
- Начинать можно только после Stage 7 Batch 3 PASS.
- Нельзя переносить workspace/execution.
- Нельзя зависеть от global snapshot revision.
- Нельзя возвращать authority к JSON planning slices.
- `/api/data?scope=production` после этого batch должен быть SQL-backed
  compatibility read/export only.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 7 Batch 4: перевести shifts lifecycle, shift-close и
production compatibility read/export на SQL source.

Что сделать:
1. Перевести `POST /api/production/planning/shifts/lifecycle/commit` на SQL
   transaction:
   - write authority: `production_shifts` plus logs/snapshots;
   - revision lock/compare/increment через
     `production_planning_revisions.slice_key = 'production.planning'`;
   - return `{ revision: { entity, rev, source } }`.
2. Перевести `POST /api/production/planning/shift-close/*/commit` на SQL
   transaction:
   - close draft/snapshots/archive rows;
   - task transfer/replan effects через planning SQL repository;
   - planning rev bump only after successful mutation.
3. Перевести shift-close read slices на SQL source:
   - shifts/logs/archives;
   - tasks;
   - schedule;
   - Stage 6 SQL dependencies.
4. Перевести `/api/data?scope=production` на SQL-backed compatibility
   read/export:
   - assemble production planning data from SQL source;
   - keep POST `/api/data` overwrite protection for planning slices;
   - no JSON preserved planning slice may become authority.
5. Проверить `PUT /api/production/planning/areas-layout`:
   - move/read from SQL security/user settings if still JSON-owned;
   - this route must not bump planning revision.
6. Сохранить route-local refresh metadata and diagnostics.

Что нельзя делать:
- не использовать snapshot-save для shifts/shift-close;
- не bump planning rev от unrelated writes или areas-layout;
- не менять execution/workspace source of truth;
- не добавлять fallback на stale JSON `productionSchedule`,
  `productionShiftTasks`, `productionShifts`, close draft/snapshot/history.

Проверки:
- shifts lifecycle success and stale `409`;
- shift-close draft/finalize success and stale `409`;
- `/api/data?scope=production` returns SQL-backed planning data;
- POST `/api/data` cannot overwrite planning SQL state;
- areas-layout does not bump planning rev;
- direct URL/F5 for planning routes after shift/close changes.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 7 Batch 4 PASS/FAIL/BLOCKED.
2. Shifts/shift-close write cutover proof.
3. `/api/data?scope=production` compatibility proof.
4. Areas-layout revision proof.
5. Tests/checks run.
6. Remaining blockers for Batch 5 acceptance.
```

## Ручная проверка после Prompt

Проверить `/production/shifts`, shift-close screen if available, `/api/data?scope=production`,
F5/direct URL and one safe shift/close action where safe.
