# MySQL 8.4 Stage 12 Batch 2

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
- Можно удалять только JSON authority that has SQL replacement proof.
- Нельзя удалять diagnostic/export path без replacement decision.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 2: убрать remaining authoritative JSON snapshot
paths.

Что сделать:
1. Remove/disable critical writes through `/api/data`.
2. Remove `saveData()` as application write path.
3. Ensure JSON is not authoritative storage.
4. Keep JSON export only if explicitly non-authoritative diagnostic/export.
5. Replace full snapshot fixtures with SQL seed/migration fixtures.
6. Remove compatibility adapters whose criteria are met.
7. Verify remaining adapters are read-only.

Что нельзя делать:
- не leave JSON and MySQL as equal write authority;
- не break app boot/routes;
- не remove export diagnostics without replacement.

Проверки:
- no application caller of snapshot-save;
- `/api/data` not primary API;
- migrated domains cannot be overwritten by JSON payload;
- fixtures use SQL seed path;
- app boots/routes from SQL-backed reads.

Формат ответа:
1. What JSON authority removed.
2. What remains as non-authoritative export/read-only.
3. Fixture migration result.
4. Tests/checks run.
5. Remaining risks.
```

## Ручная проверка после Prompt

Проверить login, key routes, cards, production, messaging after JSON authority
removal.
