# MySQL 8.4 Stage 4 Batch 1

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
- Batch 1 является importer design/audit.
- Нельзя менять production source of truth.
- Нельзя писать в production MySQL.
- Нельзя silently drop unknown fields.
- Начинать только после Stage 3 PASS или explicitly documented blocker,
  который не мешает importer design.
- Importer должен использовать Stage 2 SQL foundation и Stage 3 migrations/
  schema boundary; не создавать отдельный raw SQL pipeline.
```

## Промт

```text
Нужно выполнить Stage 4 Batch 1: design importer/validator/reconciliation
pipeline.

Цель:
- спроектировать воспроизводимый import from JSON + files into clean test SQL
  DB without changing production authority.

Что проверить:
1. Stage 0 field mapping completeness.
2. Stage 3 schema fit for importer.
3. Validation rules:
   required IDs, duplicates, broken refs, invalid statuses/revisions,
   attachment metadata, production flow consistency.
4. File reconciliation requirements.
5. Reconciliation report format.
6. Automated pre/post comparison strategy.
7. How importer creates/uses a clean test SQL DB through Stage 3 migrations.
8. How importer reads current JSON snapshot and card files without mutating
   production JSON/files.
9. How unknown fields are reported with owner/removal/conversion decision.

Что нельзя делать:
- не писать importer code;
- не менять data;
- не исправлять source JSON;
- не выполнять cutover.
- не подключать importer to runtime server boot;
- не использовать production DB/files as write target;
- не делать JSON back-sync from SQL.

Формат ответа:
1. Import pipeline design.
2. Validation list by domain.
3. Reconciliation report shape.
4. File reconciliation approach.
5. Test DB/migration setup.
6. Blockers before implementation.
```

## Ручная проверка после Prompt

Не нужна.
