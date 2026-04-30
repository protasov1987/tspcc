# MySQL 8.4 Stage 13 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 13.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать production cutover.
- Acceptance must include proof that Stage 6 directories/security and Stage 7
  production planning passed in rehearsal from a clean environment, not only in
  local/unit checks.
```

## Промт

```text
Нужно выполнить Stage 13 Batch 3: приемку Production Cutover Rehearsal.

Проверь exit criteria:
- rehearsal completes from clean environment;
- reconciliation passes;
- restore rehearsal passes;
- 20-user scenario passes;
- rollback procedure is executable and documented;
- no unresolved blocker remains.

Проверь failure conditions:
- no manual DB edits required;
- restore works for SQL and files;
- load scenario does not exhaust pool or create data loss;
- rollback executable.
- directories/security smoke or overwrite protection failed in rehearsal.
- planning SQL source, stale `409`, `/api/data?scope=production` SQL-backed
  compatibility export, or planning overwrite protection failed in rehearsal.

Формат ответа:
1. Stage 13 PASS/FAIL/BLOCKED.
2. Rehearsal proof.
3. Backup/restore proof.
4. 20-user proof.
5. Stage 6 rehearsal proof.
6. Stage 7 planning rehearsal proof.
7. Можно ли начинать Stage 14 production cutover.
```

## Ручная проверка после Prompt

Проверить rehearsal artifacts and staging smoke result.
