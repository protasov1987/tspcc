# MySQL 8.4 Stage 14 Batch 2b

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
- Это MySQL 8.4 Stage 14: post-cutover production smoke and go/no-go.
- Начинать можно только после Stage14_batch2 cutover execution.
- Нельзя исправлять production issues вслепую.
- Нельзя закрывать rollback window при unresolved critical issue.
- Если smoke показывает critical regression, остановиться и перейти к
  rollback decision owner.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 2b: расширенный production smoke, monitoring
review и go/no-go decision после cutover.

Проверь:
1. Production app is running target version/commit.
2. SQL source flags active.
3. DB health:
   - connection;
   - schema_migrations;
   - basic counts for cards/users/planning/chat.
4. Stage 12 smoke:
   - no writable `/api/data`;
   - no runtime `database.json` authority;
   - no route-critical full snapshot read;
   - JSON/export path is non-authoritative.
5. Stage 6 smoke:
   - login/session;
   - `Abyss`;
   - users/access levels read;
   - directory/security reads;
   - profile route/privacy;
   - `landingTab`/inactivity timeout if safely testable.
6. Stage 7/8/9 production/planning/execution smoke:
   - planning routes;
   - workspace routes;
   - workorders/items/archive/ok/oc reads;
   - stale write/409 only if a safe test entity exists.
7. Stage 10 smoke:
   - own profile;
   - chat list/dialog read;
   - safe direct send/read only if approved;
   - deeplink;
   - no `/api/messages/*`;
   - WebPush/FCM ownership only if safely testable.
8. File availability:
   - representative card file list/download path.
9. Monitoring:
   - PM2 online;
   - app logs no critical errors;
   - DB logs no deadlocks/lock waits during smoke;
   - no pool exhaustion;
   - disk/memory stable.
10. Go/no-go:
   - `GO`: continue rollback window until Stage14_batch3 acceptance.
   - `NO-GO`: execute approved rollback within rollback window.
11. Write result artifact:
   `docs/architecture/mysql-84-stage14-batch2b-smoke-result.md`.

Что нельзя делать:
- не mutate production data unless the scenario is explicitly approved and
  rollback-safe;
- не считать manual UI glance достаточным smoke;
- не закрывать rollback window здесь;
- не начинать Stage 15 before Stage14_batch3 PASS.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы
`PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не
переводить.
1. Post-cutover smoke result.
2. Stage 12 smoke result.
3. Stage 6 smoke result.
4. Stage 7/8/9 smoke result.
5. Stage 10 smoke result.
6. File availability result.
7. Monitoring result.
8. Go/no-go decision and rollback window status.
9. Whether Stage14_batch3 may start.
```

## Ручная проверка после Prompt

Проверить representative user workflows in production during rollback window.
