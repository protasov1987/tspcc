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

Что нельзя делать:
- не переносить domain reads/writes;
- не добавлять JSON blob final model;
- не использовать CREATE TABLE IF NOT EXISTS as migration history substitute;
- не менять router/bootstrap.

Проверки:
- run migrations on clean test DB if available;
- rerun runner and verify migration history prevents duplicate apply;
- inspect schema for forbidden big JSON model.

Формат ответа:
1. Migration runner location.
2. Migration files added.
3. How schema history works.
4. Tests/checks run.
5. Why no domain cutover happened.
```

## Ручная проверка после Prompt

Если local/test MySQL доступен, выполнить documented migration command на
чистой test DB.
