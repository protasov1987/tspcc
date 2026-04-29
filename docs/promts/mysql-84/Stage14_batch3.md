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

Формат ответа:
1. Stage 14 PASS/FAIL/BLOCKED.
2. Production source proof.
3. Smoke/monitoring result.
4. Rollback window decision.
5. Можно ли начинать Stage 15.
```

## Ручная проверка после Prompt

Обязательная ручная приемка production после cutover.
