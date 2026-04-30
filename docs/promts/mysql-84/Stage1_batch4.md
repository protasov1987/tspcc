# MySQL 8.4 Stage 1 Batch 4

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
- Это финальная acceptance-проверка MySQL Stage 1.
- Нельзя исправлять найденные blockers в этом batch.
- Нельзя начинать Stage 2.
- Нельзя менять production/VDS.
- Учитывай Stage 1 Batch 1 audit findings:
  - MySQL driver was absent before Stage 1 implementation;
  - app config reads `process.env` directly;
  - DB credentials must not be committed or embedded as literals in
    `ecosystem.config.js`;
  - backup acceptance must cover both SQL dump and `storage/cards` file archive.
```

## Промт

```text
Нужно выполнить Stage 1 Batch 4: финальную приемку MySQL Platform and
Operations Baseline.

Проверь exit criteria:
- MySQL 8.4 reachable in local/test environment или documented blocker;
- runtime user cannot CREATE/ALTER/DROP;
- migration user can apply migrations;
- secrets are not committed;
- backup and restore rehearsal commands/procedure documented;
- no application domain reads/writes use MySQL as source of truth yet.
- env/secret contract documented and compatible with:
  `TSPCC_DB_HOST`, `TSPCC_DB_PORT`, `TSPCC_DB_NAME`, `TSPCC_DB_USER`,
  `TSPCC_DB_PASSWORD`, `TSPCC_DB_CONNECTION_LIMIT`, `TSPCC_DB_SSL`,
  `TSPCC_DB_MIGRATION_USER`, `TSPCC_DB_MIGRATION_PASSWORD`;
- connection pool baseline for 20 users documented, initially
  `TSPCC_DB_CONNECTION_LIMIT=10` unless tests justify another value.

Проверь failure conditions:
- runtime app does not require root/admin credentials;
- no password committed;
- backup covers SQL and files;
- restore procedure is testable.
- no literal DB secrets were added to `ecosystem.config.js`, docs, scripts, or
  examples;
- backup manifest includes SQL dump, file archive, app version/git commit,
  schema migration placeholder, domain counts placeholder and file count/checksum
  summary;
- Stage 2 is not started until Stage 1 blockers are explicitly resolved or
  documented as environment-only blockers.

Что нельзя делать:
- не исправлять по ходу;
- не менять docs/code;
- не делать version bump.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 1 PASS/FAIL/BLOCKED.
2. Таблица exit criteria.
3. Таблица failure conditions.
4. Какие commands/tests подтверждают результат.
5. Какие secrets/config checks выполнены.
6. Можно ли начинать Stage 2.
```

## Ручная проверка после Prompt

Проверить grants и restore rehearsal только в local/test окружении.
