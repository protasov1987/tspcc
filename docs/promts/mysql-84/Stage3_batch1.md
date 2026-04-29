# MySQL 8.4 Stage 3 Batch 1

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
- Batch 1 является schema design audit.
- Нельзя выполнять domain cutover.
- Нельзя менять production schema.
- Нельзя использовать одну большую JSON table as final model.
- Начинать только после Stage 2 PASS или явно documented Stage 2 blocker,
  который не мешает schema design audit.
- Учитывай Stage 2 decisions:
  - SQL foundation должен жить за единым boundary
    `server/persistence/mysql/` or documented equivalent;
  - domain repositories должны использовать repository base, а не raw pool;
  - migration runner не должен быть частью normal server boot;
  - runtime user и migration user разделены.
```

## Промт

```text
Нужно выполнить Stage 3 Batch 1: detailed SQL schema design audit.

Цель:
- на основе Stage 0 inventory подготовить детальный schema design для all
  target domains before writing migrations.

Что сделать:
1. Сопоставить Stage 0 mapping с target domain tables.
2. Определить aggregate roots and `rev` columns.
3. Определить FK vs application guards.
4. Определить unique indexes.
5. Определить query indexes by real route/read patterns.
6. Определить ownership:
   cards, card files, directories, security, production planning/execution,
   derived read models, messaging/profile, audit/outbox.
7. Отдельно подтвердить:
   - `user_actions` single owner;
   - production execution authoritative flow state;
   - card-facing flow projection is not source of truth.
8. Определить migration runner integration boundary:
   - migrations location: `migrations/mysql/` or documented equivalent;
   - runner location: `scripts/mysql/` and/or
     `server/persistence/mysql/migrations/`;
   - migrations use migration credentials only;
   - runtime server boot never applies migrations.
9. Определить how Stage 3 schema tests will reuse Stage 2 pool/query helpers
   without making domain SQL reads/writes authoritative.

Что нельзя делать:
- не писать migrations;
- не менять code;
- не делать version bump.
- не проектировать schema под `/api/data` as primary SQL endpoint;
- не проектировать таблицу whole-site JSON;
- не встраивать migration runner в `server.js` boot path.

Формат ответа:
1. Proposed schema by domain.
2. Revision model by aggregate.
3. FK/guard decisions.
4. Index decisions.
5. Migration runner boundary.
6. Blockers before writing migrations.
```

## Ручная проверка после Prompt

Не нужна.
