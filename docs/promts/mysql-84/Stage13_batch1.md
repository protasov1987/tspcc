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
- Начинать можно только после Stage 12 Batch 6 PASS.
- Нельзя трогать production authority.
- Нельзя выполнять destructive actions.
- Rehearsal planning должен explicitly include Stage 12 proof: no writable
  JSON/snapshot authority, no route-critical full snapshot dependency,
  app/runtime fixtures use SQL seed/migration path, and any remaining
  `/api/data` / `database.json` path is non-authoritative import/export/
  diagnostic only.
- Rehearsal planning должен включать explicit proof, что Stage 6
  directories/security SQL cutover accepted and no JSON/snapshot overwrite path
  remains for migrated slices.
- Rehearsal planning должен включать explicit proof, что Stage 10 Batch 5
  accepted messaging/profile/notifications SQL cutover and no JSON/snapshot
  overwrite path remains for migrated chat/profile/push slices.
- Rehearsal planning должен включать explicit proof, что Stage 11 Batch 4
  accepted realtime/audit/outbox finalization: live events are post-commit
  signals over committed SQL state, `audit_events` / `outbox_events` runtime
  paths are active, and no domain uses SSE for correctness.
```

## Промт

```text
Нужно выполнить Stage 13 Batch 1: подготовить production cutover rehearsal
runbook.

Что сделать:
1. Confirm Stage 12 Batch 6 PASS and define production-like inputs.
   JSON snapshot may be an import source for rehearsal only; it must not be
   runtime authority after SQL seed/import.
2. Define clean staging/test environment.
3. Define rehearsal commands:
   migrations, import, reconciliation, backup, restore, smoke, E2E, 20-user.
   Smoke/E2E обязательно должны покрывать directories/security checks from
   Stage 6: directory guards, users/access levels, `Abyss`, passwords,
   landingTab/inactivity timeout and profile route.
   Smoke/E2E также должны покрывать Stage 10:
   `/api/chat/*`, `/profile/:id`, foreign profile denial, delivered/read/
   unread, deeplink `openChatWith` / `conversationId`, WebPush/FCM ownership
   and Stage 10 snapshot overwrite protection.
4. Include Stage 11 smoke/E2E requirements:
   committed live event, rollback no-event, multi-client refresh, realtime
   unavailable fallback and diagnostics `[LIVE]`, `[DATA]`, `[CONFLICT]`,
   `[DB]`.
5. Define rollback decision points.
6. Define owner/checklist for cutover window.
7. Define required logs/artifacts.
8. Include checks that rehearsal app/runtime E2E do not reset by copying
   `database.json` and do not call full snapshot `/api/data` as route-critical
   source.

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
5. Stage 11 outbox/live proof.
6. Stage 12 JSON authority removal proof.
7. Blockers before Batch 2.
```

## Ручная проверка после Prompt

Не нужна.
