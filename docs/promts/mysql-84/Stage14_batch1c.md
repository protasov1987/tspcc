# MySQL 8.4 Stage 14 Batch 1c

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
- Это MySQL 8.4 Stage 14: shadow-site validation on VDS.
- Batch 1c создает отдельный сайт `sql.tspcc.ru` на MySQL.
- Это НЕ production cutover для `tspcc.ru`.
- `tspcc.ru` должен остаться как есть: текущая директория, PM2 app, порт,
  JSON runtime и production data не меняются.
- Для `sql.tspcc.ru` нужно использовать локальную workstation DB `tspcc_bd`.
- Данные с текущей VDS production JSON базы НЕ импортировать в `sql.tspcc.ru`
  в этом batch.
- Файлы сайта на VDS должны попадать только из GitHub/deploy pipeline.
- Нельзя вручную править или копировать файлы сайта в `/var/www/tspcc.ru`.
- Shadow app должен иметь отдельные директорию, env, PM2 process, порт и Nginx
  server block.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 1c: поднять на VDS отдельный shadow-сайт
`sql.tspcc.ru` на MySQL с локальной базой `tspcc_bd`, не меняя `tspcc.ru`.

Целевой результат:
- `tspcc.ru` продолжает работать как сейчас на JSON.
- `sql.tspcc.ru` работает отдельно на MySQL.
- VDS MySQL DB `tspcc_bd` содержит дамп локальной workstation DB `tspcc_bd`.

Перед изменениями:
1. Проверить и зафиксировать:
   - локальную ветку, commit и версию;
   - publish branch, который будет загружен в GitHub;
   - DNS `sql.tspcc.ru`;
   - VDS PM2/Nginx/current `tspcc.ru` state;
   - что `/var/www/tspcc.ru` и PM2 app `tspcc` не будут изменяться.
2. Если DNS `sql.tspcc.ru` еще не указывает на VDS IP, зафиксировать blocker:
   публичный HTTPS smoke невозможен до DNS. Продолжать можно только для
   server-side/local-port validation или после добавления DNS.

Что сделать:
1. Создать publish branch для текущего site code и push только этой branch в
   GitHub.
2. На VDS подготовить отдельную app directory:
   - `/var/www/sql.tspcc.ru`;
   - deploy только через GitHub branch clone/fetch/checkout.
3. Подготовить отдельную MySQL runtime конфигурацию:
   - DB: `tspcc_bd`;
   - runtime user: `tspcc_app`;
   - migration/import user separate from runtime user;
   - secrets только в host-level secret/env path, не в Git.
4. Сделать локальный дамп workstation DB `tspcc_bd` и импортировать его в VDS
   MySQL DB `tspcc_bd`.
5. Перенести локальные runtime file data, которые нужны SQL shadow-site
   validation, в отдельное storage место `sql.tspcc.ru`; не трогать production
   `/var/www/tspcc.ru/storage`.
6. Запустить отдельный PM2 app:
   - name: `tspcc-sql`;
   - отдельный port, например `8010`;
   - SQL source flags enabled for all migrated domains;
   - storage/data paths point to `/var/www/sql.tspcc.ru`, not production site.
7. Создать отдельный Nginx server block для `sql.tspcc.ru`.
8. Если DNS готов, выпустить/подключить TLS certificate и проверить HTTPS.
   Если DNS не готов, не подменять `tspcc.ru`; ограничиться local-port/Host
   header smoke и зафиксировать DNS blocker.
9. Выполнить smoke:
   - app starts;
   - `/` or login page opens;
   - auth/session smoke;
   - core SQL data route smoke;
   - file availability smoke;
   - PM2 logs without critical SQL/pool errors.
10. Проверить неизменность `tspcc.ru`:
    - PM2 `tspcc` online;
    - old port still active;
    - current production data files untouched;
    - no SQL source flags enabled for `tspcc.ru`.

Что нельзя делать:
- не удалять и не переименовывать `tspcc.ru`;
- не менять `/var/www/tspcc.ru/data/database.json`;
- не импортировать локальную DB в production runtime `tspcc.ru`;
- не включать SQL flags для PM2 app `tspcc`;
- не push локальные backup branches;
- не хранить MySQL secrets в repo;
- не продолжать к production cutover без отдельного user approval.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы
`PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не
переводить.
1. Shadow-site result.
2. Publish branch / commit / version.
3. VDS MySQL DB import status.
4. PM2/Nginx/TLS status for `sql.tspcc.ru`.
5. Smoke result.
6. Proof that `tspcc.ru` was not changed.
7. Remaining blockers before production cutover.
```

## Ручная проверка после Prompt

Пользователь вручную проверяет `sql.tspcc.ru`. Production cutover к
`tspcc.ru` можно обсуждать только после явного acceptance этого shadow-сайта.
