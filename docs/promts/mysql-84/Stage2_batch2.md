# MySQL 8.4 Stage 2 Batch 2

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
- Можно добавлять SQL foundation code only.
- Нельзя выполнять domain cutover.
- Нельзя создавать production schema implicitly on boot.
- Если меняются файлы сайта, выполни version bump по AGENTS.md.
```

## Промт

```text
Нужно выполнить Stage 2 Batch 2: реализовать SQL persistence foundation без
смены source of truth.

Что сделать:
1. Добавить MySQL driver/pool integration.
2. Добавить transaction helper:
   begin/commit/rollback, deadlock/timeout classification.
3. Добавить query helper:
   parameterized values, allowlisted identifiers, no raw user input
   interpolation.
4. Добавить repository base pattern.
5. Добавить SQL conflict helper compatible with current `409` contract.
6. Добавить `[DB]` diagnostics without noisy logs.
7. Добавить simple health query/test path for local/test only.

Что нельзя делать:
- не переносить cards/directories/production на SQL;
- не менять `/api/data`;
- не мутировать schema on server boot;
- не хранить secrets in repo.

Проверки:
- connection health in local/test if MySQL available;
- transaction commit/rollback tests if feasible;
- no domain source of truth changed.

Формат ответа:
1. Какие modules added.
2. Как устроены pool/transaction/query helpers.
3. Какие diagnostics added.
4. Какие tests/checks run.
5. Почему domain cutover не начат.
```

## Ручная проверка после Prompt

Если MySQL доступен локально, выполнить health check. UI проверка не требуется.
