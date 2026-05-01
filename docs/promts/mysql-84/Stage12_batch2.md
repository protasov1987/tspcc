# MySQL 8.4 Stage 12 Batch 2

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
- Batch 2 закрывает только writable snapshot boundary:
  `POST /api/data`, `saveData()`, `LEGACY_SNAPSHOT_SAVE_PATH` и тестовые
  proof'ы, что migrated slices нельзя перезаписать snapshot payload.
- Нельзя одновременно переписывать route hydration, full snapshot reads,
  fixtures и финальный `JsonDatabase` cleanup. Эти работы вынесены в Batch 3-5.
- Нельзя удалять `GET /api/data` / export diagnostics в этом batch, если они
  еще нужны для read compatibility или тестов. Они должны стать явно
  non-authoritative/read-only.
- Stage 6 slices (`ops`, `centers`, `areas`, `productionShiftTimes`,
  `users`, `accessLevels`) и Stage 10 slices (`messages`,
  `chatConversations`, `chatMessages`, `chatStates`, `userActions`,
  `userVisits`, `webPushSubscriptions`, `fcmTokens`) должны остаться
  SQL-owned/read-only compatibility и не должны приниматься через
  `POST /api/data`.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 2: disable/remove writable JSON snapshot
authority.

Что сделать:
1. Повторно подтвердить Stage 12 Batch 1 audit findings:
   - Stage 11 Batch 4 PASS artifact exists;
   - active `POST /api/data` path exists or already removed;
   - `saveData()` has no application callers outside its own definition.
2. Add/update focused tests proving:
   - no application caller of `saveData()`;
   - no client application write reaches `LEGACY_SNAPSHOT_SAVE_PATH`;
   - `POST /api/data`, если route еще существует, cannot overwrite migrated
     SQL-owned slices from Stage 5-10;
   - Stage 6 and Stage 10 protected slices are explicitly covered.
3. Remove or disable `saveData()` as application write path:
   - remove the public callable path if safe;
   - or make it fail closed with clear `[DATA]` diagnostics and no persistence,
     if temporary compatibility requires keeping the symbol.
4. Remove or disable `POST /api/data` for application writes:
   - preferred: return controlled `405`/`410` for normal app requests;
   - acceptable temporary diagnostic mode only if explicitly authenticated,
     non-authoritative and covered by tests.
5. Keep `GET /api/data` and scoped reads unchanged except for diagnostics that
   mark them read-only/non-authoritative.
6. Preserve diagnostics:
   - `[DATA]` for blocked legacy write attempts;
   - `[CONFLICT]` and `[DB]` behavior must not regress.

Что нельзя делать:
- не migrate fixtures in this batch;
- не rewrite route hydration in this batch;
- не remove `JsonDatabase` constructor/runtime reads yet;
- не leave JSON and MySQL as equal write authority;
- не remove export diagnostics without replacement.

Проверки:
- static source scan for `saveData(` in `js/**`;
- static source scan for `LEGACY_SNAPSHOT_SAVE_PATH` and `POST /api/data`;
- E2E/API proof that migrated domains cannot be overwritten by JSON payload;
- focused SQL/E2E tests for Stage 6 and Stage 10 protected slices;
- smoke login and representative domain write through domain endpoints.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Writable snapshot authority removed/disabled.
2. `saveData()` status.
3. `POST /api/data` status.
4. Stage 6/Stage 10 overwrite protection proof.
5. Tests/checks run.
6. Remaining read/fixture/runtime JSON risks for Batch 3-5.
```

## Ручная проверка после Prompt

Проверить login, cards create/update, directories/security save, production
workspace action, chat send. Старый `POST /api/data` не должен сохранять
business changes.
