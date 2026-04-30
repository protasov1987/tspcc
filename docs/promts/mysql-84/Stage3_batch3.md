# MySQL 8.4 Stage 3 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 3.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать importer или domain cutover.
- Начинать только после Stage 3 Batch 2 implementation.
- Acceptance должна проверить, что migration runner остается controlled
  operation, а не production boot side effect.
- Acceptance должна проверить, что Stage 3 Batch 2 реализовал решения Batch 1
  audit, а не только создал формально пустую migration history.
```

## Промт

```text
Нужно выполнить Stage 3 Batch 3: приемку Schema Design and Migration Runner.

Проверь exit criteria:
- Stage 2 foundation PASS exists and migration runner uses the same SQL
  boundary or a documented compatible boundary;
- migrations run from empty DB to complete schema;
- rerunning migration runner is idempotent through migration history;
- test DB schema is created only by migrations;
- runtime user cannot apply migrations;
- schema review verifies there is no single big JSON table final model.
- server boot does not import/run migration runner and does not require
  migration credentials.
- schema review confirms Stage 3 Batch 1 ownership decisions:
  - current `centers` are represented as `work_centers`;
  - low-risk card descriptive JSON, if present, is explicitly owned and does
    not replace normalized card/operation/lifecycle/file tables;
  - `initialSnapshot` and close-page draft/snapshot/history are archive/read-only
    compatibility tables;
  - production execution tables are authoritative for flow state/history/version;
  - card-facing flow projection is read-only and not source of truth;
  - `user_actions` exists as a single messaging/profile/audit-owned model;
  - mutable aggregate roots have `rev`/version columns.
- SQL migration tests reuse Stage 2 pool/query/transaction helpers and do not
  introduce a second raw SQL pipeline.

Проверь failure conditions:
- `CREATE TABLE IF NOT EXISTS` is not the only migration history;
- cards/users/production/messages are not arrays inside one JSON column;
- destructive migration has backup/restore plan.
- migration/admin secrets are not committed;
- runtime app does not require CREATE/ALTER/DROP grants;
- no domain reads/writes use SQL as source of truth yet.
- schema does not make `/api/data` a primary SQL endpoint.
- schema does not create a second authoritative card flow model.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 3 PASS/FAIL/BLOCKED.
2. Migration runner proof.
3. Schema review result.
4. Runtime vs migration grants result.
5. Server boot/source-of-truth review result.
6. Можно ли начинать Stage 4.
```

## Ручная проверка после Prompt

Если local/test MySQL доступен, выполнить migration runner на пустой test DB.
