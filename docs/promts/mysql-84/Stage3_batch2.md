# MySQL 8.4 Stage 3 Batch 2

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
- Это MySQL 8.4 Stage 3: Schema Design and Migration Runner.
- Можно добавлять migration runner and SQL migrations.
- Нельзя выполнять domain cutover.
- Нельзя менять application source of truth.
- Runtime app must not require migration credentials.
- Начинать только после Stage 2 PASS.
- Migration runner должен использовать Stage 2 SQL foundation/helpers or an
  explicitly documented equivalent, но не создавать второй independent SQL
  connection/query pipeline.
- Server boot must not apply migrations or require migration credentials.
```

## Промт

```text
Нужно выполнить Stage 3 Batch 2: добавить migration runner и initial SQL schema
migrations.

Что сделать:
1. Добавить migration runner and `schema_migrations` table.
2. Добавить initial migrations для:
   cards, card lifecycle, card attachments, directories, security, production
   planning, production execution, derived read models, messaging/profile,
   audit/user actions, outbox/live events.
3. Add migration descriptions:
   purpose, domain, business impact/no impact, rollback/restore expectation.
4. Ensure migrations run from empty DB to complete schema.
5. Ensure runtime user cannot apply migrations.
6. Ensure no server boot auto-mutates production schema.
7. Add explicit migration command/script under `scripts/mysql/` or npm script
   wrapper that is separate from `npm start`.
8. Ensure migration runner reads only migration env:
   `TSPCC_DB_MIGRATION_USER`, `TSPCC_DB_MIGRATION_PASSWORD` plus non-secret
   connection vars; runtime app reads only runtime credentials.
9. Add local/test schema setup path for SQL integration tests through the same
   migrations, not hand-written drift schema.

Что нельзя делать:
- не переносить domain reads/writes;
- не добавлять JSON blob final model;
- не использовать CREATE TABLE IF NOT EXISTS as migration history substitute;
- не менять router/bootstrap.
- не импортировать migration runner into normal `server.js` startup;
- не требовать CREATE/ALTER/DROP grants for `tspcc_app`;
- не хранить migration/admin secrets в repo или `ecosystem.config.js`.

Проверки:
- run migrations on clean test DB if available;
- rerun runner and verify migration history prevents duplicate apply;
- inspect schema for forbidden big JSON model.
- validate runtime user cannot apply migrations or document environment-only
  blocker if local/test credentials are unavailable;
- inspect server boot path for no migration side effect.

Формат ответа:
1. Migration runner location.
2. Migration files added.
3. How schema history works.
4. Runtime vs migration credential boundary.
5. Tests/checks run.
6. Why no domain cutover happened.
7. Why server boot cannot mutate schema.
```

## Ручная проверка после Prompt

Если local/test MySQL доступен, выполнить documented migration command на
чистой test DB.
