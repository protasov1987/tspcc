# MySQL 8.4 Stage 6 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 6.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 7.
```

## Промт

```text
Нужно выполнить Stage 6 Batch 3: приемку Directories and Security SQL Cutover.

Проверь exit criteria:
- directories/security source of truth is SQL;
- JSON/snapshot cannot overwrite migrated directories/security slices;
- permissions and route visibility remain unchanged;
- business guards pass from SQL state.

Проверь failure conditions:
- no directory/security critical write uses snapshot-save;
- `Abyss` cannot be deleted/degraded;
- historical card text is not lost by directory mutation.

Формат ответа:
1. Stage 6 PASS/FAIL/BLOCKED.
2. Directories proof.
3. Security proof.
4. Tests/checks run.
5. Можно ли начинать Stage 7.
```

## Ручная проверка после Prompt

Проверить справочники, users/access levels, права вкладок и profile privacy.
