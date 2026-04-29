# MySQL 8.4 Stage 1 Batch 3

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
- Это MySQL 8.4 Stage 1: MySQL Platform and Operations Baseline.
- Этот batch про backup/restore/runbook, не про domain SQL cutover.
- Нельзя менять production/VDS без отдельного явного запроса.
- Нельзя считать SQL dump достаточным backup, если файлы карточек остаются в
  filesystem/object storage.
```

## Промт

```text
Нужно выполнить Stage 1 Batch 3: подготовить production-grade backup/restore
runbook for MySQL + card files.

Цель:
- зафиксировать проверяемый backup set:
  SQL dump + file storage backup + manifest;
- подготовить restore rehearsal path for test environment;
- определить RPO/RTO baseline.

Что сделать:
1. Добавить/обновить docs/scripts for:
   - mysqldump logical backup;
   - file storage archive/snapshot;
   - manifest generation;
   - restore rehearsal.
2. Manifest должен включать:
   - timestamp;
   - app version/git commit;
   - schema migration version placeholder;
   - domain counts placeholder;
   - file count/checksum summary.
3. Описать retention baseline.
4. Описать restore verification:
   - SQL restored;
   - files restored;
   - file metadata matches physical files.

Что нельзя делать:
- не менять production data;
- не запускать destructive restore outside test env;
- не добавлять real secrets;
- не начинать Stage 2.

Формат ответа:
1. Какие backup/restore artifacts добавлены.
2. Как формируется backup set.
3. Как выполняется restore rehearsal.
4. Какие проверки выполнены.
5. Остаточные операционные риски.
```

## Ручная проверка после Prompt

Если есть локальная/test MySQL и test file storage, выполнить documented
backup/restore rehearsal. Production не трогать.
