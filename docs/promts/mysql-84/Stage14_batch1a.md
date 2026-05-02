# MySQL 8.4 Stage 14 Batch 1a

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
- Это MySQL 8.4 Stage 14: Production Cutover preparation.
- Batch 1a закрывает только production platform/tooling readiness.
- Это НЕ production cutover.
- Нельзя переключать сайт на MySQL source of truth.
- Нельзя импортировать production data в authoritative runtime без отдельного
  cutover approval.
- Нельзя править файлы сайта на VDS вручную.
- Любые production/VDS команды требуют явного подтверждения пользователя перед
  началом batch.
- Цель batch: сделать так, чтобы на VDS были MySQL 8.4 server/client tools,
  production DB/users/env path и возможность выполнить migrations/import/backup
  в следующих batch.
- Если установка MySQL или настройка credentials невозможна, batch должен
  завершиться `BLOCKED`, а не обходить требование SQL backup.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 1a: подготовить VDS MySQL platform для
production cutover, не переключая production runtime.

Перед началом:
- запроси явное подтверждение пользователя на production/VDS infrastructure
  changes;
- назови target host, app dir, текущую версию сайта и rollback point;
- подтверди, что уже есть свежий source backup JSON+files или создай новый
  source backup перед изменениями.

Что сделать после подтверждения:
1. Проверить VDS current state:
   - host/date/time;
   - `/var/www/tspcc.ru`;
   - PM2 `tspcc`;
   - текущий `app-version.json`;
   - disk/memory;
   - наличие `mysql`, `mysqldump`, MySQL server, MySQL service.
2. Если MySQL 8.4 server/client tools отсутствуют, установить их штатным
   package-manager способом для ОС VDS.
3. Создать/проверить production DB contract:
   - DB name: `tspcc_bd`;
   - runtime user: `tspcc_app`;
   - migration/admin user: separate from runtime user;
   - least-privilege grants for runtime user;
   - migration user can run migrations/import/backup as required.
4. Секреты не коммитить и не печатать. Production env должен быть host-level
   secret file / PM2 env / approved deploy secret path, not repo file.
5. Проверить connection and grants:
   - `mysql --version`;
   - `mysqldump --version`;
   - runtime `SELECT 1`;
   - migration `SELECT 1`;
   - `scripts/mysql/validate-runtime-grants.ps1` equivalent if PowerShell is
     available, otherwise equivalent SQL grant check.
6. Не запускать app with SQL source flags.
7. Не менять production runtime data authority.
8. Обновить readiness artifact:
   `docs/architecture/mysql-84-stage14-batch1-readiness.md`.

Что нельзя делать:
- не включать `TSPCC_*_SQL_SOURCE=1` в production app;
- не запускать production import как authoritative cutover;
- не делать manual schema drift outside migrations;
- не хранить secrets в Git;
- не пушить/деплоить сайт вручную на VDS.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы
`PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не
переводить.
1. Platform readiness result.
2. MySQL/server/client status.
3. DB/users/grants status.
4. Secret/env path status.
5. Backup status before changes.
6. Remaining blockers before Stage14_batch1b.
```

## Ручная проверка после Prompt

Проверить, что сайт на VDS все еще работает как до batch и не переключен на
MySQL source flags.
