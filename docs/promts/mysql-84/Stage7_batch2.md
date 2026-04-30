# MySQL 8.4 Stage 7 Batch 2

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
- Batch 2 закрывает только repository/read-foundation и Stage 6 dependency
  blocker из Stage 7 Batch 1 audit.
- Нельзя переносить workspace/execution.
- Нельзя переносить planning writes полностью в этом batch, кроме минимальных
  read-only helper/transaction primitives, если они нужны для repository.
- Нельзя зависеть от global snapshot revision.
- Начинать implementation можно только если Stage 6 Batch 3 разрешил Stage 7:
  directories/security source of truth is SQL, `rev` conflict model работает,
  `/api/data` не может overwrite migrated slices.
- Если Stage 6 Batch 3 PASS не подтвержден, этот batch должен завершиться
  BLOCKED без compensating snapshot fallback.
- Нельзя добавлять planning fallback, который снова делает `ops`, `centers`,
  `areas`, `users`, `accessLevels` или `productionShiftTimes` authoritative
  JSON dependencies.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 7 Batch 2: реализовать foundation для production planning
SQL cutover: repository, SQL read slices, dependency boundary и revision
primitive.

Что сделать:
1. Подтвердить Stage 6 Batch 3 PASS или явно завершить batch как BLOCKED.
2. Проверить SQL schema coverage для активных planning fields:
   `plannedPartMinutes`, `plannedTotalMinutes`, subcontract chain fields,
   shift-close preview/source fields и другие поля, которые реально участвуют
   в текущих routes.
   Если поля не покрыты, добавить миграцию/колонки или зафиксировать
   BLOCKED до write-cutover.
3. Implement `ProductionPlanningRepository` для SQL-owned reads:
   - `production_planning_revisions`;
   - `production_schedule`;
   - `production_shift_tasks`;
   - `production_shifts`;
   - shift close archive tables;
   - `production_shift_masters`.
4. Реализовать единый SQL revision aggregate:
   `production_planning_revisions.slice_key = 'production.planning'`.
   В этом batch допустимо добавить compare/read/lock/increment primitives,
   но actual mutation cutover выполняется в Batch 3/4.
5. Добавить planning read composer на server side:
   - `GET /api/production/planning/slice?slice=schedule` читает SQL schedule,
     shift masters и Stage 6 SQL users/areas/shift times;
   - `slice=plan|gantt` читает SQL shift tasks, SQL cards/card operations и
     Stage 6 SQL ops/centers/areas;
   - `slice=shifts|shift-close` читает SQL shifts/logs/archives, tasks,
     schedule и SQL dependencies.
6. Убрать read authority от прямого `database.getData()` в planning endpoints.
   Compatibility read может существовать только как оболочка над SQL source.
7. Preserve planning visibility:
   non-archived MKI, valid operations, PROVIDED/PLANNING/PLANNED semantics.
   Valid operations/areas/users/shift times должны читаться через Stage 6
   SQL-backed directories/security boundary.
8. Preserve route-local production refresh metadata and `[ROUTE]`/`[BOOT]`
   diagnostics where affected.

Что нельзя делать:
- не use global `meta.revision` as actual planning rev;
- не делать `meta.domainRevisions.productionPlanning` или `db.js` signature
  bump concurrency authority;
- не transfer execution/workspace actions;
- не depend on heavy local shadow state;
- не менять planning business rules.

Проверки:
- SQL-backed dependency source proof для users/areas/ops/centers/shift times;
- schedule/plan/shifts/shift-close/gantt read payload shape;
- direct URL/F5 planning routes;
- `/api/data?scope=production` пока не становится write authority;
- no JSON read authority for planning dependencies.

Формат ответа:
1. Stage 7 Batch 2 PASS/FAIL/BLOCKED.
2. SQL planning repository/read composer implemented.
3. Schema coverage result.
4. Revision primitive.
5. Tests/checks run.
6. Remaining compatibility and blockers for Batch 3.
```

## Ручная проверка после Prompt

Проверить `/production/schedule`, `/production/plan`, `/production/shifts`,
`/production/gantt` или ближайший доступный gantt route, а также F5/direct URL.
