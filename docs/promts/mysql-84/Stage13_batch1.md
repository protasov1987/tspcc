# MySQL 8.4 Stage 13 Batch 1

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
- Это MySQL 8.4 Stage 13: Production Cutover Rehearsal.
- Batch 1 является rehearsal planning.
- Нельзя трогать production authority.
- Нельзя выполнять destructive actions.
- Rehearsal planning должен включать explicit proof, что Stage 6
  directories/security SQL cutover accepted and no JSON/snapshot overwrite path
  remains for migrated slices.
```

## Промт

```text
Нужно выполнить Stage 13 Batch 1: подготовить production cutover rehearsal
runbook.

Что сделать:
1. Define production-like snapshot inputs.
2. Define clean staging/test environment.
3. Define rehearsal commands:
   migrations, import, reconciliation, backup, restore, smoke, E2E, 20-user.
   Smoke/E2E обязательно должны покрывать directories/security checks from
   Stage 6: directory guards, users/access levels, `Abyss`, passwords,
   landingTab/inactivity timeout and profile route.
4. Define rollback decision points.
5. Define owner/checklist for cutover window.
6. Define required logs/artifacts.

Что нельзя делать:
- не запускать production cutover;
- не менять production data;
- не skip backup/restore.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Rehearsal runbook.
2. Required inputs.
3. Required commands/checks.
4. Rollback decision points.
5. Blockers before Batch 2.
```

## Ручная проверка после Prompt

Не нужна.
