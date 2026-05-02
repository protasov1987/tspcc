# MySQL 8.4 Stage 14 Batch 1b

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
- Это MySQL 8.4 Stage 14: final operational gate before production cutover.
- Batch 1b не выполняет cutover.
- Начинать можно только после:
  - Stage 13 Batch 3 PASS;
  - Stage 14 Batch 1 readiness artifact exists;
  - Stage 14 Batch 1a PASS или documented reason why MySQL platform is already
    ready;
  - Stage 14 Batch 1c PASS, если выбран путь предварительной проверки через
    отдельный `sql.tspcc.ru` shadow-сайт.
- Цель batch: закрыть operational blockers:
  source backup, owner/go-no-go, maintenance/quiesce, monitoring, rollback,
  publish/deploy readiness.
- `sql.tspcc.ru` с локальной DB `tspcc_bd` является validation shadow-site, а
  не production cutover source.
- Production DB после cutover должна строиться из VDS production
  `data/database.json` + `storage/cards`, а НЕ из локальной rehearsal DB.
- Локальные базы `tspcc_bd_stage13_*` нельзя переносить на VDS.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 1b: закрыть final operational gate перед
production cutover.

Проверь и зафиксируй:
1. Fresh production source backup:
   - `data/database.json`;
   - `storage/cards`;
   - manifest with SHA256, file count, app version, git commit.
2. MySQL platform/tooling ready:
   - `mysql`;
   - `mysqldump`;
   - MySQL 8.4 server/service;
   - DB/users/grants ready.
3. Maintenance/quiesce:
   - exact window or explicit zero-downtime decision;
   - exact quiesce command/procedure;
   - expected user-visible impact.
4. Owners:
   - cutover owner;
   - go/no-go decision owner;
   - rollback owner;
   - smoke owner.
5. Rollback:
   - rollback point is the latest verified source backup plus current app
     version/config;
   - rollback deadline/window is explicit;
   - rollback commands are concrete.
6. Monitoring:
   - PM2 status/logs;
   - disk/memory;
   - DB connectivity;
   - slow queries/deadlocks/lock waits;
   - pool exhaustion;
   - backup/restore failure signal.
7. Publish/deploy readiness:
   - identify exact local commit/version intended for production;
   - identify publish branch to push;
   - confirm deploy path uses GitHub/deploy pipeline only;
   - no direct VDS site-file edits.
8. Update:
   - `docs/architecture/mysql-84-stage14-batch1-readiness.md`.

Что нельзя делать:
- не начинать Stage14_batch2 without explicit cutover approval;
- не переключать production app;
- не импортировать data into authoritative MySQL runtime;
- не push без явного решения publish branch;
- не считать rehearsal backup заменой production source backup.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы
`PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не
переводить.
1. Operational gate result.
2. Backup/rollback point.
3. MySQL platform readiness.
4. Maintenance/quiesce decision.
5. Owners/go-no-go.
6. Monitoring readiness.
7. Publish/deploy readiness.
8. Whether Stage14_batch2 may start.
```

## Ручная проверка после Prompt

Пользователь должен явно подтвердить, что готов к Stage14_batch2 production
cutover.
