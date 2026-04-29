# MySQL 8.4 Stage 4 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 4.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 5 cutover.
```

## Промт

```text
Нужно выполнить Stage 4 Batch 3: приемку JSON Import, Validation and
Reconciliation Dry Run.

Проверь exit criteria:
- import can run repeatedly in test environment;
- reconciliation report is generated automatically;
- critical domain counts match or documented conversion exists;
- file metadata reconciliation passes or blockers documented;
- no production source of truth changed.

Проверь failure conditions:
- unknown fields are not silently dropped;
- IDs do not change without compatibility mapping;
- import does not fix data without report;
- file mismatches are not ignored.

Формат ответа:
1. Stage 4 PASS/FAIL/BLOCKED.
2. Reconciliation summary.
3. File reconciliation summary.
4. Data blockers/warnings.
5. Можно ли начинать Stage 5.
```

## Ручная проверка после Prompt

Проверить reconciliation report на понятность и отсутствие silent conversion.
