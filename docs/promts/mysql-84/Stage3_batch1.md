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

Что нельзя делать:
- не писать migrations;
- не менять code;
- не делать version bump.

Формат ответа:
1. Proposed schema by domain.
2. Revision model by aggregate.
3. FK/guard decisions.
4. Index decisions.
5. Blockers before writing migrations.
```

## Ручная проверка после Prompt

Не нужна.
