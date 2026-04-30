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
- Учитывай итоги Stage 2 Batch 1 audit/design и Stage 2 Batch 2
  implementation:
  - Stage 1 acceptance должен быть PASS или явно documented
    environment-only blocker;
  - SQL foundation должен быть отдельным boundary, а не расширением `db.js`
    JSON authority;
  - normal server boot не должен требовать MySQL connection и не должен
    менять schema;
  - health checks допустимы только explicit local/test path;
  - conflict helper должен быть совместим с текущим `409` payload;
  - raw SQL не должен быть размазан по `server.js`.
```

## Промт

```text
Нужно выполнить Stage 2 Batch 3: приемку SQL Persistence Foundation.

Проверь exit criteria:
- Stage 1 precondition documented: PASS или environment-only blocker;
- dependency strategy выполнена: MySQL driver добавлен только в рамках Batch 2,
  secrets не добавлены;
- SQL foundation modules exist under `server/persistence/mysql/` or an
  explicitly documented equivalent;
- repository base boundary exists and does not change domain source of truth;
- SQL foundation can connect, run simple health query and close cleanly;
- integration tests cover transaction commit/rollback или documented blocker;
- SQL injection review passes for helper API shape;
- `[DB]` diagnostics exist for health/query/transaction/error paths without
  logging secrets;
- no domain source of truth changed.

Проверь failure conditions:
- raw SQL helpers do not encourage string concatenation with user input;
- dynamic identifiers are allowlisted and cannot be supplied directly from user
  input;
- transaction helper does not allow partial commit inside business command;
- server boot does not silently change production schema.
- normal production boot does not depend on a SQL health query;
- runtime app does not require migration credentials;
- `db.js` is not converted into a mixed JSON/SQL authority;
- no cards/directories/security/production/messaging cutover started.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 2 PASS/FAIL/BLOCKED.
2. Stage 1 precondition status.
3. Таблица exit criteria.
4. SQL injection/helper API review result.
5. Boot/schema/source-of-truth review result.
6. Tests/checks run.
7. Можно ли начинать Stage 3.
```

## Ручная проверка после Prompt

Не нужна, кроме local/test SQL health check при наличии MySQL.
