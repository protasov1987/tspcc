# MySQL 8.4 Stage 12 Batch 5

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
- Batch 5 является final runtime cleanup/hardening перед Stage 12 acceptance.
- Начинать можно только после Stage 12 Batch 2-4 PASS.
- Удалять compatibility можно только при proof, что replacement работает и
  diagnostics/export не ломаются.
- JSON может остаться только как non-authoritative import/export/backup
  artifact. Runtime app не должен считать `database.json` source of truth.
- Актуальный риск после Batch 2-4:
  серверный `JsonDatabase` shell и многочисленные `database.getData()` /
  `database.update()` branches могут оставаться dormant fallback'ом. Этот batch
  должен удалить или fail-closed такие runtime branches, не ломая importer,
  reconciliation и backup/export artifacts.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 5: remove runtime JSON authority shell and
harden remaining non-authoritative export/read-only adapters.

Что сделать:
1. Audit remaining runtime references:
   - `JsonDatabase`;
   - `database.getData()`;
   - `database.update()`;
   - `data/database.json`;
   - `GET /api/data`;
   - protected snapshot guards retained only because POST existed.
   - `LEGACY_SNAPSHOT_DATA_PATH`, `LEGACY_SNAPSHOT_READ_PATH`,
     `LEGACY_SNAPSHOT_SAVE_PATH`, `API_ENDPOINT`;
   - `preserveProtectedSlicesForLegacySnapshot(...)`;
   - JSON branches under cards, directories/security, production,
     messaging/profile, notifications and derived views.
2. Remove runtime JSON authority:
   - no domain command may read/write `database.json` as source of truth;
   - no route-critical read may require full snapshot payload;
   - no post-cutover E2E may seed runtime state by copying JSON.
   - SQL source disabled/misconfigured must fail closed with `[DB]`/`[DATA]`
     diagnostics, not fall back to JSON.
3. Remove guards/adapters whose only purpose was protecting `POST /api/data`
   after POST is removed/disabled:
   - `preserveProtectedSlicesForLegacySnapshot(...)`;
   - `LEGACY_SNAPSHOT_SAVE_PATH`;
   - `API_ENDPOINT` alias if no caller remains;
   - other temporary snapshot adapters with met criteria.
4. Keep only explicitly non-authoritative paths:
   - migration import from JSON;
   - reconciliation reports;
   - diagnostic/export endpoint if there is an explicit owner, auth guard,
     read-only contract and removal/retention decision.
5. Ensure diagnostics remain useful:
   - `[DATA]` for export/read-only attempts;
   - `[DB]` for SQL source;
   - no noisy false success logs from removed snapshot writes.
6. Produce explicit runtime fallback matrix:
   - each remaining `database.getData()` / `database.update()` is classified as
     removed, import/export-only, test-only, or BLOCKED with owner and next
     removal condition.

Что нельзя делать:
- не remove importer/reconciliation JSON support;
- не remove backup/export diagnostics without replacement decision;
- не leave writable compatibility adapter;
- не silently fallback from SQL to JSON on runtime failure.
- не удалять JSON importer/reconciliation только ради clean source scan;
- не считать runtime cleanup complete, если `JsonDatabase` still boots as
  production source for any in-scope domain.

Проверки:
- static source scan for `JsonDatabase`, `database.getData`, `database.update`,
  `/api/data`, `LEGACY_SNAPSHOT`, `API_ENDPOINT`, `database.json`,
  `preserveProtectedSlicesForLegacySnapshot`, `mergeSnapshots`;
- API proof that any remaining `/api/data` path is read-only/export only;
- fail-closed proof when SQL source/env is missing for in-scope runtime domain;
- full SQL test suite;
- focused E2E smoke over SQL seed path;
- diagnostics scan for `[DATA]`, `[DB]`, `[CONFLICT]`, `[LIVE]`.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Runtime JSON authority removed.
2. Compatibility adapters removed.
3. Remaining import/export artifacts.
4. Diagnostics preserved.
5. Tests/checks run.
6. Blockers before Stage 12 acceptance.
```

## Ручная проверка после Prompt

Проверить login, direct URL/F5, cards/files, directories/security,
production/workspace, derived views, messaging/profile and diagnostics.
