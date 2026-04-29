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
2. Добавить или описать DB bootstrap commands:
   - database `tspcc_bd`;
   - runtime user `tspcc_app`;
   - separate migration user;
   - least privilege grants.
3. Добавить/описать validation command for runtime grants.
4. Убедиться, что `.env`, `.env.*` and service secrets ignored.
5. Не подключать приложение к MySQL как source of truth.

Что нельзя делать:
- не коммитить passwords;
- не использовать root as runtime;
- не менять production schema;
- не добавлять domain repositories;
- не менять `/api/data`.

Проверки:
- static review of ignored secret files;
- command docs are reproducible;
- runtime grants do not include CREATE/ALTER/DROP.

Формат ответа:
1. Какие platform artifacts добавлены.
2. Как устроены users/grants.
3. Как проверено отсутствие secrets.
4. Что осталось для backup/restore batch.
```

## Ручная проверка после Prompt

Если пользователь уже установил MySQL локально: выполнить documented bootstrap
commands и grants check. Если MySQL не установлен, ручная проверка не нужна.
