# MySQL 8.4 Stage 2 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 2.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать schema migrations или domain cutover.
- Version bump не нужен, если файлов приложения не меняешь.
```

## Промт

```text
Нужно выполнить Stage 2 Batch 3: приемку SQL Persistence Foundation.

Проверь exit criteria:
- SQL foundation can connect, run simple health query and close cleanly;
- integration tests cover transaction commit/rollback или documented blocker;
- SQL injection review passes for helper API shape;
- no domain source of truth changed.

Проверь failure conditions:
- raw SQL helpers do not encourage string concatenation with user input;
- transaction helper does not allow partial commit inside business command;
- server boot does not silently change production schema.

Формат ответа:
1. Stage 2 PASS/FAIL/BLOCKED.
2. Таблица exit criteria.
3. SQL injection/helper API review result.
4. Tests/checks run.
5. Можно ли начинать Stage 3.
```

## Ручная проверка после Prompt

Не нужна, кроме local/test SQL health check при наличии MySQL.
