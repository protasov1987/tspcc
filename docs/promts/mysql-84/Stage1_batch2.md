# MySQL 8.4 Stage 1 Batch 2

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
- Это MySQL 8.4 Stage 1: MySQL Platform and Operations Baseline.
- Разрешено добавлять только platform/config docs/scripts that do not change
  application source of truth.
- Нельзя выполнять domain cutover.
- Нельзя хранить реальные secrets.
- Если меняются файлы сайта/runtime scripts, применяй versioning rule.
- Учитывай результаты Stage 1 Batch 1 audit:
  - current Node runtime observed locally: `v24.11.1`;
  - MySQL driver/dependency currently absent;
  - current config pattern reads `process.env` directly, `.env` loader is not
    present;
  - `.env`, `.env.*`, `data/`, `storage/*`, `fcm-service-account.json` are
    already ignored;
  - `ecosystem.config.js` currently contains notification secrets inline, so DB
    credentials MUST NOT be added there as literals;
  - existing data/storage envs are `TSPCC_DATA_DIR` and `TSPCC_STORAGE_DIR`.
```

## Промт

```text
Нужно выполнить Stage 1 Batch 2: подготовить local/test MySQL 8.4 platform
bootstrap artifacts.

Цель:
- добавить безопасные non-secret артефакты для MySQL platform setup;
- не менять runtime source of truth приложения.

Что сделать:
1. Добавить env example/documentation without real secrets.
   Обязательный env contract:
   - `TSPCC_DB_HOST=127.0.0.1`;
   - `TSPCC_DB_PORT=3306`;
   - `TSPCC_DB_NAME=tspcc_bd`;
   - `TSPCC_DB_USER=tspcc_app`;
   - `TSPCC_DB_PASSWORD=<secret>`;
   - `TSPCC_DB_CONNECTION_LIMIT=10`;
   - `TSPCC_DB_SSL=disabled|required|custom`;
   - `TSPCC_DB_MIGRATION_USER=<migration user>`;
   - `TSPCC_DB_MIGRATION_PASSWORD=<secret>`.
2. Добавить или описать DB bootstrap commands:
   - database `tspcc_bd`;
   - runtime user `tspcc_app`;
   - separate migration user;
   - least privilege grants.
3. Добавить/описать validation command for runtime grants.
4. Зафиксировать secret delivery pattern:
   - local/test: `.env` or shell environment outside Git;
   - PM2/VDS later: external secret file or host-level env, not literal DB
     secrets in `ecosystem.config.js`.
5. Убедиться, что `.env`, `.env.*` and service secrets ignored.
6. Зафиксировать, что приложение пока НЕ подключается к MySQL как source of
   truth.

Что нельзя делать:
- не коммитить passwords;
- не использовать root as runtime;
- не менять production schema;
- не добавлять domain repositories;
- не менять `/api/data`.
- не устанавливать MySQL и не добавлять npm dependency in this batch unless the
  prompt is explicitly changed by user;
- не добавлять DB credentials в `ecosystem.config.js` as literal values.

Проверки:
- static review of ignored secret files;
- command docs are reproducible;
- runtime grants do not include CREATE/ALTER/DROP.
- documented runtime user cannot apply migrations;
- migration/admin user is separate from `tspcc_app`;
- no MySQL source-of-truth path is introduced in app code.

Формат ответа:
1. Какие platform artifacts добавлены.
2. Как устроены users/grants.
3. Как проверено отсутствие secrets.
4. Что осталось для backup/restore batch.
```

## Ручная проверка после Prompt

Если пользователь уже установил MySQL локально: выполнить documented bootstrap
commands и grants check. Если MySQL не установлен, ручная проверка не нужна.
