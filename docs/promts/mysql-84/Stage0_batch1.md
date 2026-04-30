# MySQL 8.4 Stage 0 Batch 1

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
- Это MySQL 8.4 Stage 0: SQL Readiness Inventory.
- Batch 1 является audit-only.
- Нельзя менять код приложения, схему БД, данные, VDS или production config.
- Нельзя начинать MySQL implementation, importer, migrations или cutover.
- Нельзя делать version bump.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
```

## Промт

```text
Нужно выполнить Stage 0 Batch 1: первичный inventory audit текущего persistence
perimeter перед переходом на MySQL 8.4.

Цель:
- понять фактическую структуру JSON database, file storage, domain APIs и
  compatibility adapters;
- не менять файлы;
- подготовить точный список артефактов, которые нужно зафиксировать в Batch 2.

Что проверить:
1. Текущую JSON database shape и все top-level fields.
2. Nested fields по доменам:
   cards, approvals/input/provision, files, directories, security, production,
   derived views, messaging/profile/notifications.
3. Файловое хранилище карточек:
   card folder/key, attachment metadata, missing/orphan candidates.
4. Domain API/read/write paths.
5. Snapshot/scoped read compatibility paths.
6. Legacy/export/adapter paths and removal assumptions.
7. E2E fixtures and runtime test fixtures.

Что нельзя делать:
- не создавать SQL schema;
- не писать importer;
- не менять docs;
- не менять код;
- не выполнять version bump.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Какие источники данных и файлов найдены.
2. Предварительная карта top-level JSON fields.
3. Предварительная карта file storage.
4. Предварительная карта compatibility adapters.
5. Какие blockers нужно уточнить в Batch 2.
```

## Ручная проверка после Prompt

Не нужна, если batch был audit-only и не менял файлы.
