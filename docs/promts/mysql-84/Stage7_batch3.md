# MySQL 8.4 Stage 7 Batch 3

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
- Batch 3 переводит schedule/plan/auto-plan write paths на SQL.
- Начинать можно только после Stage 7 Batch 2 PASS.
- Нельзя переносить workspace/execution.
- Нельзя начинать shift lifecycle или shift-close cutover, если это не
  требуется как атомарный side effect конкретной plan mutation.
- Нельзя зависеть от global snapshot revision.
- Нельзя возвращать authority к JSON `ops`, `centers`, `areas`, `users`,
  `accessLevels`, `productionShiftTimes`, `productionSchedule` или
  `productionShiftTasks`.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 7 Batch 3: перевести schedule/plan/auto-plan planning
writes на SQL transactions.

Что сделать:
1. Перевести `POST /api/production/planning/schedule/assignments/commit` на
   SQL transaction:
   - write authority: `production_schedule` / `production_shift_masters`;
   - revision lock: `SELECT ... FOR UPDATE` по
     `production_planning_revisions.slice_key = 'production.planning'`;
   - compare `expectedRev`;
   - increment planning rev only after successful planning mutation;
   - return `{ revision: { entity, rev, source } }`.
2. Перевести `POST /api/production/plan/commit` на SQL transaction:
   - write authority: `production_shift_tasks`;
   - card planning side effects выполнять атомарно через cards SQL boundary;
   - не использовать JSON snapshot write path.
3. Перевести save path `POST /api/production/plan/auto` на SQL transaction.
   Dry-run auto-plan не должен bump planning rev.
4. Сохранить текущую shape ответов и route-local refresh metadata.
5. Убедиться, что unrelated security/directories/messages/cards вне planning
   не инвалидируют planning `expectedRev`.
6. Оставить `meta.domainRevisions.productionPlanning` и signature bump только
   как compatibility/export metadata, не как concurrency authority.

Что нельзя делать:
- не менять shift lifecycle или shift-close write authority в этом batch;
- не делать `/api/data` planning write path;
- не использовать global `meta.revision` для planning conflicts;
- не добавлять local shadow state as source of truth;
- не менять execution/workspace behavior.

Проверки:
- schedule assignment success and stale `409`;
- plan add/move/delete success and stale `409`;
- auto-plan dry-run no rev bump;
- auto-plan save rev bump;
- unrelated security/directories/messages/cards write does not stale planning;
- direct URL/F5 planning routes after writes.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 7 Batch 3 PASS/FAIL/BLOCKED.
2. Schedule/plan/auto write cutover proof.
3. Revision/conflict proof.
4. Cards SQL side effect proof.
5. Tests/checks run.
6. Remaining blockers for Batch 4.
```

## Ручная проверка после Prompt

Проверить `/production/schedule`, `/production/plan`, одно безопасное
schedule/plan действие, F5/direct URL и two-tab conflict where safe.
