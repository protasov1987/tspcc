# MySQL 8.4 Stage 3 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 3.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать importer или domain cutover.
```

## Промт

```text
Нужно выполнить Stage 3 Batch 3: приемку Schema Design and Migration Runner.

Проверь exit criteria:
- migrations run from empty DB to complete schema;
- rerunning migration runner is idempotent through migration history;
- test DB schema is created only by migrations;
- runtime user cannot apply migrations;
- schema review verifies there is no single big JSON table final model.

Проверь failure conditions:
- `CREATE TABLE IF NOT EXISTS` is not the only migration history;
- cards/users/production/messages are not arrays inside one JSON column;
- destructive migration has backup/restore plan.

Формат ответа:
1. Stage 3 PASS/FAIL/BLOCKED.
2. Migration runner proof.
3. Schema review result.
4. Runtime vs migration grants result.
5. Можно ли начинать Stage 4.
```

## Ручная проверка после Prompt

Если local/test MySQL доступен, выполнить migration runner на пустой test DB.
