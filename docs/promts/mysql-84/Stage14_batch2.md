# MySQL 8.4 Stage 14 Batch 2

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
- Это MySQL 8.4 Stage 14: Production Cutover.
- Выполнять production cutover только после явного подтверждения пользователя.
- Нельзя импровизировать вне runbook.
- При failed reconciliation остановиться и перейти к rollback decision.
- Production smoke must include Stage 6 directories/security scenarios before
  accepting cutover: directory/security reads, protected writes, auth/profile,
  `Abyss`, landingTab/inactivity timeout and snapshot overwrite protection.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 2: production cutover строго по runbook.

Перед началом:
- запроси явное подтверждение пользователя;
- назови target state and rollback point.

Что сделать после подтверждения:
1. Quiesce/stop writes according to runbook.
2. Take final JSON backup.
3. Take final file storage backup.
4. Create final manifest.
5. Apply SQL migrations.
6. Run final import.
7. Run final reconciliation.
8. Start app with MySQL-backed persistence.
9. Run post-cutover smoke.
   Include Stage 6 smoke explicitly.
10. Monitor DB/app metrics.

Что нельзя делать:
- не skip backup;
- не continue after failed reconciliation;
- не manually patch production schema/data outside runbook;
- не push backup branches unless requested.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Cutover result.
2. Backup manifest.
3. Reconciliation summary.
4. Smoke result.
5. Rollback window status.
```

## Ручная проверка после Prompt

Обязательна: login, F5/direct URL, cards, files, production, workspace,
messaging/profile, realtime fallback.
