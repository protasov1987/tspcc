# MySQL 8.4 Stage 12 Batch 6

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
- Это финальная acceptance-проверка MySQL Stage 12.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать production rehearsal.
- Acceptance можно выдавать только после Stage 12 Batch 2-5 PASS.
- Acceptance должна include explicit proof:
  - no writable JSON/snapshot authority;
  - no route-critical full snapshot dependency;
  - fixtures use SQL seed/migration path;
  - any remaining JSON path is non-authoritative import/export/diagnostic.
- Acceptance должна include explicit negative proof for risks found after
  Batch 2:
  - no `saveData()` network POST;
  - no route/live correctness through `loadData()` / `GET /api/data`;
  - no E2E runtime reset through copied `database.json`;
  - no runtime SQL failure fallback to `JsonDatabase`.
- Acceptance должна include explicit proof for Stage 6 directories/security
  slices and Stage 10 messaging/profile/notifications slices: no JSON write
  authority remains and route-critical reads no longer require full snapshot
  payload.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 6: приемку Remove JSON Snapshot Authority.

Проверь exit criteria:
- MySQL is only source of truth for in-scope data;
- `database.json` is not authoritative;
- `/api/data` is removed or explicitly non-authoritative diagnostic/export;
- client no longer depends on full snapshot payload;
- fixtures use SQL seed/migration path for app/runtime E2E.

Проверь failure conditions:
- no critical write can persist through JSON snapshot;
- JSON and MySQL do not both accept authoritative writes;
- fixture/test setup does not hide SQL migration failures;
- runtime app does not start or continue in authoritative JSON mode for any
  in-scope domain after SQL source is required;
- route/live fallback does not load full snapshot as correctness source;
- `/api/data` or `database.json` cannot overwrite `ops`, `centers`,
  `areas`, `productionShiftTimes`, `users`, `accessLevels`;
- `/api/data` or `database.json` cannot overwrite `messages`,
  `chatConversations`, `chatMessages`, `chatStates`, `userActions`,
  `userVisits`, `webPushSubscriptions`, `fcmTokens`;
- route-critical boot/read path does not require `GET /api/data` full
  snapshot.

Проверки:
- static source scan for legacy snapshot authority;
- static source scan for `saveData`, `LEGACY_SNAPSHOT_SAVE_PATH`,
  `LEGACY_SNAPSHOT_READ_PATH`, `API_ENDPOINT`, `loadDataWithScope`,
  `startBackgroundDataHydration`, `JsonDatabase`, `database.getData`,
  `database.update`, `resetDatabaseFromSnapshot`, `loadSnapshotDb`,
  `database.json`;
- `npm run test:sql`;
- focused E2E over SQL seed path;
- route direct URL/F5 and Back/Forward smoke;
- API/export proof for any remaining `/api/data`;
- fixture setup proof.
- fail-closed proof for missing/misconfigured SQL source where applicable;
- documented list of remaining JSON artifacts with classification:
  importer, reconciliation, backup/export, diagnostic, or removed.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 12 PASS/FAIL/BLOCKED.
2. JSON authority proof.
3. Snapshot API/export proof.
4. Stage 6 and Stage 10 slice proof.
5. Fixture/seed proof.
6. Runtime fallback/fail-closed proof.
7. Remaining JSON artifacts classification.
8. Tests/checks run.
9. Можно ли начинать Stage 13 rehearsal.
```

## Ручная проверка после Prompt

Проверить основные домены после удаления JSON authority.
