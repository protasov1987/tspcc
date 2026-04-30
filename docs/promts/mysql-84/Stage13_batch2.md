# MySQL 8.4 Stage 13 Batch 2

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
- Это MySQL 8.4 Stage 13: Production Cutover Rehearsal.
- Выполнять только в staging/test environment.
- Нельзя менять production authority.
- Нельзя продолжать при failed reconciliation.
- Rehearsal must include Stage 6 directories/security smoke and overwrite
  protection checks; failed Stage 6 checks are cutover blockers.
```

## Промт

```text
Нужно выполнить Stage 13 Batch 2: провести production-like cutover rehearsal.

Что сделать:
1. Freeze production-like JSON snapshot and file storage copy.
2. Restore into staging/test environment.
3. Run full SQL migrations.
4. Run importer.
5. Run reconciliation.
6. Run full E2E and SQL integration tests.
   Include Stage 6 coverage: directory guards, users/access levels, `Abyss`,
   password validation/uniqueness, landingTab/inactivity timeout, profile
   route, and `/api/data` overwrite protection.
7. Run SQL + file backup and restore rehearsal.
8. Run 20-user representative scenario.
9. Collect artifacts/logs.

Что нельзя делать:
- не touch production data;
- не manually patch DB for success;
- не ignore file restore failure.

Формат ответа:
1. Rehearsal result.
2. Reconciliation summary.
3. Restore rehearsal result.
4. 20-user scenario result.
5. Blockers before acceptance.
```

## Ручная проверка после Prompt

Проверить staging/test сайт после rehearsal, не production.
