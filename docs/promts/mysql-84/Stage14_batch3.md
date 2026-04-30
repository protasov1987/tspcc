# MySQL 8.4 Stage 14 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 14.
- Нельзя исправлять blockers в этом batch.
- Нельзя закрывать rollback window при unresolved critical issue.
- Acceptance must include production Stage 6 proof: directories/security SQL
  source of truth, route/auth/profile behavior, and no JSON overwrite path.
- Acceptance must include production Stage 10 proof: messaging/profile/
  notifications SQL source of truth, profile privacy, WebPush/FCM ownership,
  no `/api/messages/*`, and no JSON overwrite path for Stage 10 slices.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 3: приемку Production Cutover.

Проверь exit criteria:
- production runs on MySQL source of truth;
- JSON is not authoritative;
- post-cutover smoke passes;
- no data reconciliation blocker;
- backups and restore point retained;
- monitoring shows no critical SQL/pool issue.

Проверь failure conditions:
- reconciliation does not fail;
- core route/auth works;
- critical writes do not fail broadly;
- files available after cutover;
- rollback criteria not met.
- directories/security production smoke failed or `/api/data` can overwrite
  migrated directories/security slices.
- messaging/profile/notifications production smoke failed, `/api/messages/*`
  exists, or `/api/data` can overwrite migrated Stage 10 slices.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 14 PASS/FAIL/BLOCKED.
2. Production source proof.
3. Smoke/monitoring result.
4. Stage 6 production proof.
5. Stage 10 production proof.
6. Rollback window decision.
7. Можно ли начинать Stage 15.
```

## Ручная проверка после Prompt

Обязательная ручная приемка production после cutover.
