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
- Acceptance must include proof that Stage 12 Batch 6 passed before rehearsal
  and stayed true during rehearsal: no writable JSON/snapshot authority, no
  route-critical full snapshot dependency, no runtime E2E JSON fixture masking
  SQL failures, and any remaining JSON path is non-authoritative.
- Acceptance must include proof that Stage 6 directories/security and Stage 7
  production planning passed in rehearsal from a clean environment, not only in
  local/unit checks.
- Acceptance must include proof that Stage 10 messaging/profile/notifications
  passed in rehearsal from a clean environment, including snapshot overwrite
  protection and no `/api/messages/*` parallel stack.
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
- Stage 12 removal proof passes in rehearsal environment.

Проверь failure conditions:
- no manual DB edits required;
- restore works for SQL and files;
- load scenario does not exhaust pool or create data loss;
- rollback executable.
- writable JSON/snapshot authority exists, route-critical reads require full
  snapshot, or runtime fixture setup still copies `database.json`.
- directories/security smoke or overwrite protection failed in rehearsal.
- planning SQL source, stale `409`, production read/export status
  (`/api/data?scope=production` still authoritative or writable, if retained),
  or planning overwrite protection failed in rehearsal.
- messaging/profile/notifications SQL source, profile privacy, WebPush/FCM
  ownership, `/api/messages/*` absence, or Stage 10 overwrite protection failed
  in rehearsal.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 13 PASS/FAIL/BLOCKED.
2. Rehearsal proof.
3. Backup/restore proof.
4. 20-user proof.
5. Stage 12 JSON removal rehearsal proof.
6. Stage 6 rehearsal proof.
7. Stage 7 planning rehearsal proof.
8. Stage 10 messaging/profile rehearsal proof.
9. Можно ли начинать Stage 14 production cutover.
```

## Ручная проверка после Prompt

Проверить rehearsal artifacts and staging smoke result.
