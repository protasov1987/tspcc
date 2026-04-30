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
- Stage 2 foundation по текущему коду:
  `server/persistence/mysql/*` and `server/repositories/baseRepository.js`.
  Optional local/test health query skip из-за отсутствия env не блокирует
  implementation, если остальные Stage 2 checks PASS.
- Migration runner должен использовать Stage 2 SQL foundation/helpers or an
  explicitly documented equivalent, но не создавать второй independent SQL
  connection/query pipeline.
- Server boot must not apply migrations or require migration credentials.
- Учитывай Stage 3 Batch 1 audit decisions:
  - migrations location: `migrations/mysql/`;
  - runner location: `scripts/mysql/` and/or
    `server/persistence/mysql/migrations/`;
  - current `centers` target table: `work_centers`;
  - low-risk card descriptive fields may use explicitly owned JSON columns only
    as bounded non-authoritative attributes, never as whole-card JSON;
  - `initialSnapshot`, close-page draft/snapshot/history are archive/read-only
    compatibility tables, not write authority;
  - production execution tables are authoritative for flow state/history/version;
  - card-facing flow projection is read-only projection/read model;
  - `user_actions` has single owner in messaging/profile/audit boundary;
  - Stage 3 schema tests must reuse Stage 2 pool/query/transaction helpers.
```

## Промт

```text
Нужно выполнить Stage 3 Batch 2: добавить migration runner и initial SQL schema
migrations.

Что сделать:
1. Добавить migration runner and `schema_migrations` table.
2. Добавить initial migrations для all target domains without domain cutover:
   - cards: `cards`, `card_operations`, `card_serials`/quantity tables,
     lifecycle/approval/input/provision/log tables, `card_attachments`;
   - directories: `work_centers`, `operations`, `operation_allowed_areas`,
     `production_areas`, `production_shift_times`;
   - security: `users`, `access_levels`, permission/session tables where
     persisted;
   - production planning: schedule, shift tasks, shifts, shift logs, planning
     revision tables, close archive/read-only tables;
   - production execution: authoritative flow state/events/version, personal
     operations, material/drying/delay/defect/repair/dispose tables;
   - derived read models/views for workorders/archive/items/ok/oc, with no
     write authority;
   - messaging/profile/notifications: conversations, participants, messages,
     message states, visits, push/FCM tokens;
   - audit/profile: single `user_actions` model and shared audit/outbox tables.
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
10. Add `rev`/version columns for mutable aggregate roots:
    `cards.rev`, directory/security entity `rev`, planning slice revisions,
    `production_shifts.rev`, and `production_flow_states.flow_version`.
11. Add FK/guard/index decisions from Stage 3 Batch 1:
    hard FK for identity invariants, application guards for historical text and
    conditional business rules, unique indexes for stable IDs/business keys,
    and query indexes for current card, planning, workspace, chat/profile
    routes.

Что нельзя делать:
- не переносить domain reads/writes;
- не добавлять JSON blob final model;
- не хранить cards/users/production/messages as arrays inside JSON columns;
- не использовать JSON columns для flow authority, attachments authority,
  users authority, messages authority or production source state;
- не использовать CREATE TABLE IF NOT EXISTS as migration history substitute;
- не менять router/bootstrap.
- не импортировать migration runner into normal `server.js` startup;
- не требовать CREATE/ALTER/DROP grants for `tspcc_app`;
- не хранить migration/admin secrets в repo или `ecosystem.config.js`.

Проверки:
- run migrations on clean test DB if available;
- rerun runner and verify migration history prevents duplicate apply;
- inspect schema for forbidden big JSON model.
- inspect schema for Stage 3 Batch 1 ownership decisions:
  `work_centers`, single `user_actions`, authoritative production execution
  flow tables, read-only card-facing flow projection, archive/read-only
  snapshot tables;
- validate runtime user cannot apply migrations or document environment-only
  blocker if local/test credentials are unavailable;
- inspect server boot path for no migration side effect.
- run `npm run test:sql`; add/update SQL migration tests that reuse Stage 2
  helpers rather than raw ad hoc SQL.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
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
