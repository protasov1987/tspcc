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
- Учитывай итоги Stage 2 Batch 1 audit/design:
  - `server.js` сейчас является большим monolith и широко использует
    `database.getData()` / `database.update()`;
  - `db.js` сейчас владеет JSON persistence, normalization, revisions,
    write queue и `[DB][ENCODING]`; не превращать его в смешанный JSON/SQL
    authority;
  - MySQL driver сейчас отсутствует в `package.json`; для implementation
    decision использовать `mysql2` / `mysql2/promise`, если не найден
    явный blocker;
  - current config pattern читает `process.env` напрямую; `.env` loader не
    добавлять без отдельного явного решения;
  - `.env` / `.env.*` уже ignored, DB secrets не добавлять в
    `ecosystem.config.js`;
  - локально обнаружены MySQL client tools 8.4.8 и Node v24.11.1, но
    `TSPCC_DB_*` env в текущей shell может отсутствовать;
  - Stage 1 acceptance PASS artifact может отсутствовать в репозитории:
    перед implementation зафиксируй Stage 1 PASS или documented
    environment-only blocker.
```

## Промт

```text
Нужно выполнить Stage 2 Batch 2: реализовать SQL persistence foundation без
смены source of truth.

Что сделать:
0. Перед началом implementation проверить precondition:
   - Stage 1 acceptance явно PASS;
   - или есть documented environment-only blocker, не связанный с кодом
     приложения и secrets.
1. Добавить MySQL driver/pool integration:
   - dependency: `mysql2`;
   - runtime import: `mysql2/promise`;
   - pool lazy-created and bounded by `TSPCC_DB_CONNECTION_LIMIT`;
   - no DB connect on normal server boot unless explicit local/test health path
     is invoked.
2. Добавить SQL env/config helper:
   - reads only Stage 1 `TSPCC_DB_*` variables from `process.env`;
   - does not commit secrets;
   - does not embed DB credentials in `ecosystem.config.js`;
   - validates host/port/name/user/password/connectionLimit/ssl mode.
3. Добавить transaction helper:
   begin/commit/rollback, deadlock/timeout classification.
4. Добавить query helper:
   parameterized values, allowlisted identifiers, no raw user input
   interpolation.
5. Добавить repository base pattern.
6. Добавить SQL conflict helper compatible with current `409` contract:
   `code`, `entity`, `id`, `expectedRev`, `actualRev`, user-safe
   `message`/`error`.
7. Добавить `[DB]` diagnostics without noisy logs:
   pool creation, health result, query duration bucket, transaction commit /
   rollback / retry, deadlock/timeout classification.
8. Добавить simple health query/test path for local/test only.

Предпочтительный layout:
- `server/persistence/mysql/env.js`
- `server/persistence/mysql/pool.js`
- `server/persistence/mysql/query.js`
- `server/persistence/mysql/transaction.js`
- `server/persistence/mysql/identifiers.js`
- `server/persistence/mysql/conflicts.js`
- `server/repositories/baseRepository.js`
- `tests/sql/mysql-foundation.test.js` или эквивалентный isolated SQL test
  path.

Что нельзя делать:
- не переносить cards/directories/production на SQL;
- не менять `/api/data`;
- не мутировать schema on server boot;
- не хранить secrets in repo.
- не добавлять raw SQL прямо в `server.js` domain handlers;
- не отдавать наружу raw pool как основной API для доменного кода;
- не делать health check production boot dependency;
- не добавлять `.env` loader или committed local credentials;
- не использовать migration credentials в runtime app.

Проверки:
- connection health in local/test if MySQL available;
- transaction commit/rollback tests if feasible;
- SQL tests должны запускаться только при явном local/test signal, например
  `TSPCC_SQL_TEST=1`, или возвращать documented blocker;
- static review: no SQL values interpolation, dynamic identifiers only через
  allowlist;
- static review: no server boot schema mutation and no production boot DB
  dependency;
- no domain source of truth changed.

Формат ответа:
1. Stage 1 precondition result: PASS or documented environment-only blocker.
2. Какие modules/dependencies added.
3. Как устроены env/pool/transaction/query helpers.
4. Какие diagnostics added.
5. Какие tests/checks run.
6. Почему domain cutover не начат.
7. Почему JSON source of truth не изменился.
```

## Ручная проверка после Prompt

Если MySQL доступен локально, выполнить health check. UI проверка не требуется.
