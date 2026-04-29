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
- Acceptance должна подтвердить, что importer/dry-run не стал новым runtime
  source of truth и не подключен к production boot.
- Acceptance должна проверить, что importer honors Stage 3 schema decisions and
  does not turn compatibility/projection fields into source of truth.
```

## Промт

```text
Нужно выполнить Stage 4 Batch 3: приемку JSON Import, Validation and
Reconciliation Dry Run.

Проверь exit criteria:
- Stage 3 PASS exists and import target schema is created only by Stage 3
  migrations;
- import can run repeatedly in test environment;
- reconciliation report is generated automatically;
- critical domain counts match or documented conversion exists;
- file metadata reconciliation passes or blockers documented;
- no production source of truth changed.
- importer scripts use Stage 2/3 SQL boundary or documented equivalent, not a
  separate raw SQL pipeline.
- reconciliation explicitly covers `centers[] -> work_centers`, single
  `user_actions`, production execution authoritative flow tables, card-facing
  projection, and archive/read-only snapshot tables.

Проверь failure conditions:
- unknown fields are not silently dropped;
- IDs do not change without compatibility mapping;
- import does not fix data without report;
- file mismatches are not ignored.
- production JSON/files are not mutated;
- importer is not wired into normal `server.js` startup;
- SQL dry-run data is not treated as live authoritative data.
- compatibility fields are not imported as new write authority.
- production flow is not split into two authoritative SQL models.

Формат ответа:
1. Stage 4 PASS/FAIL/BLOCKED.
2. Reconciliation summary.
3. File reconciliation summary.
4. Data blockers/warnings.
5. Runtime/source-of-truth review result.
6. Можно ли начинать Stage 5.
```

## Ручная проверка после Prompt

Проверить reconciliation report на понятность и отсутствие silent conversion.
