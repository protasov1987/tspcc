# MySQL 8.4 Stage 9 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 9.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 10.
```

## Промт

```text
Нужно выполнить Stage 9 Batch 3: приемку Derived Views SQL Read Model Cutover.

Проверь exit criteria:
- derived views read from SQL source domains/read models;
- no legacy source-model assumption remains for these routes;
- no new write path is introduced.

Проверь failure conditions:
- derived view does not own separate mutable state;
- archive repeat does not mutate archived card;
- detail route does not lose card context.

Формат ответа:
1. Stage 9 PASS/FAIL/BLOCKED.
2. Route/read model proof.
3. Write authority proof.
4. Tests/checks run.
5. Можно ли начинать Stage 10.
```

## Ручная проверка после Prompt

Проверить all derived routes and repeat from archive.
