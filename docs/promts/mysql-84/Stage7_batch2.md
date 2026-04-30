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
- Можно менять только planning SQL cutover scope.
- Нельзя переносить workspace/execution.
- Нельзя зависеть от global snapshot revision.
- Начинать implementation можно только если Stage 6 Batch 3 разрешил Stage 7:
  directories/security source of truth is SQL, `rev` conflict model работает,
  `/api/data` не может overwrite migrated slices.
- Нельзя добавлять planning fallback, который снова делает `ops`, `centers`,
  `areas`, `users`, `accessLevels` или `productionShiftTimes` authoritative
  JSON dependencies.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 7 Batch 2: реализовать production planning SQL source of
truth.

Что сделать:
1. Implement production planning repository.
2. Move schedule/plan/shifts/gantt reads and planning writes to SQL.
3. Define SQL-enforced planning revision model.
4. Preserve planning visibility:
   non-archived MKI, valid operations, PROVIDED/PLANNING/PLANNED semantics.
   Valid operations/areas/users/shift times должны читаться через Stage 6
   SQL-backed directories/security boundary.
5. Ensure unrelated users/messages/cards outside planning do not invalidate
   planning expected revision.
6. Preserve route-local production refresh.
7. Prevent JSON/snapshot overwrite of planning.

Что нельзя делать:
- не use global `meta.revision` as actual planning rev;
- не transfer execution/workspace actions;
- не depend on heavy local shadow state.

Проверки:
- schedule/plan/shifts/gantt;
- stale planning `409`;
- unrelated write does not create stale planning conflict;
- direct URL/F5 planning routes;
- reconciliation for planning tables.

Формат ответа:
1. SQL planning repository implemented.
2. Revision model.
3. Commands moved.
4. Tests/checks run.
5. Remaining compatibility.
```

## Ручная проверка после Prompt

Проверить `/production/schedule`, `/production/plan`, `/production/shifts`,
одно безопасное planning-действие и F5.
