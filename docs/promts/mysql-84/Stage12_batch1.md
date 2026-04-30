# MySQL 8.4 Stage 12 Batch 1

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
- Это MySQL 8.4 Stage 12: Remove JSON Snapshot Authority.
- Batch 1 является audit/design.
- Нельзя менять code.
- Нельзя удалять compatibility без proof.
- Stage 12 audit/design можно начинать только после Stage 11 Batch 4 PASS.
  Если Stage 11 не PASS, removal plan должен завершиться `BLOCKED`, потому что
  удаление JSON authority не должно маскировать незавершенный outbox/audit/live
  post-commit contract.
- Removal plan должен учитывать Stage 6 audit outcome:
  directories/security slices могут оставаться только read/export
  compatibility после SQL cutover; любое writable JSON authority for
  `ops`, `centers`, `areas`, `productionShiftTimes`, `users`,
  `accessLevels` является blocker.
- Removal plan должен учитывать Stage 10 Batch 5 acceptance:
  messaging/profile/notifications slices могут оставаться только read/export
  compatibility после SQL cutover; любое writable JSON authority for
  `messages`, `chatConversations`, `chatMessages`, `chatStates`,
  `userActions`, `userVisits`, `webPushSubscriptions`, `fcmTokens` является
  blocker.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 1: audit/design removal of JSON snapshot
authority.

Проверь:
1. Stage 11 Batch 4 PASS artifact:
   outbox/audit/live is finalized over committed SQL state and live is not
   correctness source.
2. Remaining `/api/data` reads/writes.
3. Remaining `saveData()` callers.
4. JSON database authority points.
5. Fixtures using JSON.
6. Compatibility adapters and removal criteria.
7. SQL-backed reads still depending on full snapshot payload.
8. Protected migrated slices from Stage 6 and later, включая Stage 10:
   prove they are read-only compatibility before removal.

Что нельзя делать:
- не менять code/docs;
- не удалять adapters;
- не break diagnostics/export.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. JSON authority map.
2. Snapshot API classification.
3. Fixture migration map.
4. Compatibility removal plan.
5. Stage 11 dependency status.
6. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
