# MySQL 8.4 Stage 12 Batch 4

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
- Это MySQL 8.4 Stage 12: Remove JSON Snapshot Authority.
- Batch 4 закрывает fixture/test setup, чтобы тесты больше не маскировали
  SQL migration failures через копирование `database.json`.
- Начинать можно только после Stage 12 Batch 2 PASS и желательно после Batch 3
  PASS, чтобы route-critical reads уже не зависели от full snapshot.
- JSON fixtures могут остаться только для importer/reconciliation tests,
  где проверяется migration from JSON. Они не должны быть runtime authority
  для post-cutover E2E.
- Нельзя менять business behavior ради удобства seed.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 4: replace JSON E2E/runtime fixtures with SQL
seed/migration fixtures.

Что сделать:
1. Audit fixture authority:
   - `tests/e2e/fixtures/*.database.json`;
   - `tests/e2e/helpers/snapshot.js`;
   - `tests/e2e/global.setup.js`;
   - `tests/e2e/global.teardown.js`;
   - tests that call `resetDatabaseFromSnapshot(...)`;
   - any helper that copies `data/database.json` as test truth.
2. Create or wire SQL seed path for post-cutover E2E:
   - use versioned migrations;
   - use importer only as controlled migration/seed step, not hidden runtime
     fallback;
   - reset test SQL state deterministically;
   - seed physical card files when tests require them.
3. Split tests by purpose:
   - importer/reconciliation tests may use JSON fixtures explicitly;
   - app/runtime E2E should use SQL seed path;
   - overwrite-protection tests should use diagnostic/export paths only if
     they still exist.
4. Ensure test setup cannot pass while SQL migrations/import are broken:
   - failed migration/seed must fail test setup;
   - no silent fallback to `data/database.json`.
5. Preserve local developer ergonomics:
   - document required env flags/commands if needed;
   - keep optional local/live MySQL skips explicit, not hidden success.

Что нельзя делать:
- не use JSON copy as runtime E2E authority after this batch;
- не drop importer JSON fixtures;
- не modify production data;
- не hide SQL setup failures behind skips unless the test is explicitly
  optional/local.

Проверки:
- `npm run test:sql`;
- focused E2E using SQL seed path for auth/routes/cards/directories/security/
  production/messaging;
- static source scan for `resetDatabaseFromSnapshot`, `baseline-core.database.json`
  and direct `database.json` fixture copy in runtime E2E setup;
- importer/reconciliation tests still pass and remain explicitly JSON-scoped.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Fixture authority removed.
2. SQL seed/migration fixture path.
3. Remaining JSON importer fixtures.
4. Tests/checks run.
5. Remaining blockers for final runtime JSON cleanup.
```

## Ручная проверка после Prompt

Не нужна. Проверить локально только тестовые команды и отсутствие скрытого
fallback на `data/database.json`.
