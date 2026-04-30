# MySQL 8.4 Stage 7 Batch 5

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
- Это финальная acceptance-проверка MySQL Stage 7.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 8.
- Acceptance должна подтвердить, что Stage 7 не откатил Stage 5/6:
  cards side effects идут через cards SQL boundary, directories/security
  dependencies остаются SQL-owned, а planning не использует JSON `ops`,
  `centers`, `areas`, `users`, `accessLevels`, `productionShiftTimes`,
  `productionSchedule`, `productionShiftTasks` или `productionShifts` как
  write/read authority.
```

## Промт

```text
Нужно выполнить Stage 7 Batch 5: приемку Production Planning SQL Cutover.

Проверь exit criteria:
- planning source of truth is SQL;
- planning revision is SQL-enforced through
  `production_planning_revisions.slice_key = 'production.planning'`;
- JSON/snapshot cannot overwrite planning;
- `/api/data?scope=production` is SQL-backed compatibility read/export only;
- planning route behavior unchanged;
- planning dependencies from Stage 6 remain SQL-owned.

Проверь failure conditions:
- planning conflict uses global snapshot revision;
- planning correctness depends on local shadow state;
- planning writes go through `/api/data`;
- planning introduced a fallback that treats Stage 6 directories/security
  snapshot slices as authoritative;
- planning route refresh can be broken by stale directory/security JSON state;
- `meta.domainRevisions.productionPlanning` or `db.js` signature bump is still
  concurrency authority;
- unrelated security/directories/messages/cards write creates stale planning
  conflict;
- dry-run auto-plan or areas-layout bumps planning revision.

Required checks:
- SQL success/stale `409` for schedule;
- SQL success/stale `409` for plan/auto-plan save;
- SQL success/stale `409` for shifts lifecycle;
- SQL success/stale `409` for shift-close draft/finalize;
- SQL dependency source proof for users/areas/ops/centers/shift times;
- `/api/data` cannot overwrite planning;
- `/api/data?scope=production` assembled from SQL source;
- direct URL/F5 for production planning routes;
- Back/Forward remains compatible with SPA routing contract.

Формат ответа:
1. Stage 7 PASS/FAIL/BLOCKED.
2. Planning source proof.
3. Revision/conflict proof.
4. Stage 5/6 dependency preservation proof.
5. Compatibility read/write protection proof.
6. Tests/checks run.
7. Можно ли начинать Stage 8.
```

## Ручная проверка после Prompt

Проверить planning routes, F5/direct URL, Back/Forward, safe planning action and
two-tab conflict if possible.
