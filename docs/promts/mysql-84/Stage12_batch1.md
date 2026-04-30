# MySQL 8.4 Stage 12 Batch 1

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
- Это MySQL 8.4 Stage 12: Remove JSON Snapshot Authority.
- Batch 1 является audit/design.
- Нельзя менять code.
- Нельзя удалять compatibility без proof.
- Removal plan должен учитывать Stage 6 audit outcome:
  directories/security slices могут оставаться только read/export
  compatibility после SQL cutover; любое writable JSON authority for
  `ops`, `centers`, `areas`, `productionShiftTimes`, `users`,
  `accessLevels` является blocker.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 1: audit/design removal of JSON snapshot
authority.

Проверь:
1. Remaining `/api/data` reads/writes.
2. Remaining `saveData()` callers.
3. JSON database authority points.
4. Fixtures using JSON.
5. Compatibility adapters and removal criteria.
6. SQL-backed reads still depending on full snapshot payload.
7. Protected migrated slices from Stage 6 and later: prove they are read-only
   compatibility before removal.

Что нельзя делать:
- не менять code/docs;
- не удалять adapters;
- не break diagnostics/export.

Формат ответа:
1. JSON authority map.
2. Snapshot API classification.
3. Fixture migration map.
4. Compatibility removal plan.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
