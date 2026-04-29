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
- Это финальная acceptance-проверка MySQL Stage 7.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 8.
```

## Промт

```text
Нужно выполнить Stage 7 Batch 3: приемку Production Planning SQL Cutover.

Проверь exit criteria:
- planning source of truth is SQL;
- planning revision is SQL-enforced;
- JSON/snapshot cannot overwrite planning;
- planning route behavior unchanged.

Проверь failure conditions:
- planning conflict does not use global snapshot revision;
- planning correctness does not depend on local shadow state;
- planning writes do not go through `/api/data`.

Формат ответа:
1. Stage 7 PASS/FAIL/BLOCKED.
2. Planning source proof.
3. Revision/conflict proof.
4. Tests/checks run.
5. Можно ли начинать Stage 8.
```

## Ручная проверка после Prompt

Проверить planning routes, F5, safe planning action and two-tab conflict if
possible.
