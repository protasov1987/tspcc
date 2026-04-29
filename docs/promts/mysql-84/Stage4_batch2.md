# MySQL 8.4 Stage 4 Batch 2

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
- Это MySQL 8.4 Stage 4: JSON Import, Validation and Reconciliation Dry Run.
- Можно добавлять importer/validator/reconciliation scripts/tests.
- Нельзя менять production source of truth.
- Нельзя исправлять данные без отчета.
- Если меняются файлы сайта/runtime scripts, применяй versioning rule.
- Начинать только после Stage 3 PASS.
- Importer/validator/reconciliation scripts должны жить под `scripts/mysql/`
  or documented equivalent и использовать Stage 2/3 SQL foundation/migrations.
- Import target is clean local/test SQL DB only.
```

## Промт

```text
Нужно выполнить Stage 4 Batch 2: реализовать JSON import dry-run pipeline for
test SQL DB.

Что сделать:
1. Добавить importer from current JSON database snapshot.
2. Добавить file metadata importer/reconciler.
3. Добавить pre-import validation:
   required IDs, duplicate IDs, duplicate-key anomalies, encoding issues,
   invalid statuses/stages/revisions, broken references, orphan attachments,
   production flow consistency.
4. Добавить reconciliation report:
   domain counts, sample equality, broken refs, skipped/converted fields,
   warnings requiring manual decision, file metadata summary.
5. Добавить automated comparison checks for key domains.
6. Ensure import can run repeatedly in test environment.
7. Ensure test SQL DB setup is produced by Stage 3 migrations before import.
8. Ensure importer reports unknown/skipped/converted fields explicitly and
   never silently drops data.
9. Ensure file reconciliation covers metadata and physical files together:
   `storage/cards/<qrId>`, size, checksum when generated/available, missing and
   orphan files.

Что нельзя делать:
- не менять production JSON;
- не менять application source of truth;
- не выполнять live writes to SQL as source of truth;
- не скрывать unknown fields.
- не подключать importer to runtime app boot;
- не писать в production MySQL;
- не выполнять SQL -> JSON back-sync.

Проверки:
- run importer against test fixture or safe copy;
- inspect reconciliation output;
- verify failures are explicit.
- rerun importer on clean test DB and verify repeatability;
- verify production `data/database.json` and `storage/cards` were not mutated.

Формат ответа:
1. Importer/validator files added.
2. Reconciliation report output.
3. Test DB/migration setup used.
4. Tests/checks run.
5. Known warnings/blockers.
6. Why production authority is unchanged.
```

## Ручная проверка после Prompt

Если есть локальная/test DB, выполнить importer на безопасной копии данных и
открыть reconciliation report.
