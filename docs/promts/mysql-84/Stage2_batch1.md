# MySQL 8.4 Stage 2 Batch 1

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
- Это MySQL 8.4 Stage 2: SQL Persistence Foundation.
- Batch 1 является audit/design-only.
- Нельзя выполнять domain cutover.
- Нельзя менять router/bootstrap.
- Нельзя создавать schema migrations в этом batch.
- Начинать этот batch можно только после Stage 1 acceptance или явного
  documented environment-only blocker.
- Учитывай Stage 1 audit/design:
  - MySQL driver was absent before implementation; dependency decision belongs
    to Stage 2 design/implementation, not Stage 1 platform docs;
  - env contract должен использовать `TSPCC_DB_*` variables from Stage 1;
  - app currently reads `process.env` directly, so any `.env` loading decision
    must be explicit and must not commit secrets;
  - DB credentials must not be embedded as literals in `ecosystem.config.js`.
```

## Промт

```text
Нужно выполнить Stage 2 Batch 1: audit/design SQL persistence foundation.

Цель:
- определить, куда встроить MySQL pool, transaction helper, query helper,
  repository base и `[DB]` diagnostics без изменения source of truth.

Что проверить:
1. Current server structure and module boundaries.
2. Existing db.js responsibilities.
3. Current conflict helpers and domain command patterns.
4. Current test setup and where SQL integration tests should live.
5. Dependency strategy for MySQL driver.
6. How to avoid raw SQL scattered through server.js.
7. How SQL foundation will read Stage 1 env contract without changing current
   JSON source of truth.
8. How health checks can run only in local/test context and never mutate schema
   on server boot.

Что нельзя делать:
- не добавлять dependencies;
- не писать foundation code;
- не менять runtime behavior;
- не менять persistence source.

Формат ответа:
1. Proposed file/module layout.
2. Proposed pool/transaction/query helper API.
3. Proposed diagnostics.
4. Proposed test strategy.
5. Dependency/env strategy.
6. Implementation risks for Batch 2.
```

## Ручная проверка после Prompt

Не нужна.
