# MySQL 8.4 Stage 12 Batch 3

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
- Batch 3 закрывает только client/server read dependency on full/scoped
  snapshot payload.
- Начинать можно только после Stage 12 Batch 2 PASS:
  application writes через `POST /api/data` / `saveData()` disabled or removed.
- Актуальный риск после Batch 2:
  writable snapshot закрыт, но route/live correctness всё еще может быть
  скрыто завязана на `loadData()`, `loadDataWithScope(...)`,
  `startBackgroundDataHydration()` и `GET /api/data*`.
- Нельзя менять bootstrap/router contract:
  URL remains source of truth, session-first bootstrap, no forced dashboard
  redirect, popstate -> handleRoute.
- Нельзя возвращать reads к `database.json` как authority. Если временный
  export/read endpoint остается, он должен быть non-authoritative.
- Не пытайся в этом batch удалять `JsonDatabase`, E2E fixtures или весь
  `/api/data` endpoint: эти риски закрываются в Batch 4-5 после read cutover.
- Если меняется bootstrap order, обязательно обновить docs/architecture/spa-boot.md.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 3: replace full snapshot route hydration with
SQL/domain read paths.

Что сделать:
1. Audit current read dependencies:
   - `loadData()`;
   - `loadDataWithScope({ scope: DATA_SCOPE_FULL })`;
   - `loadDataWithScope({ scope: DATA_SCOPE_PRODUCTION })`;
   - `loadDataWithScope({ scope: DATA_SCOPE_DIRECTORIES })`;
   - `loadDataWithScope({ scope: DATA_SCOPE_CARDS_BASIC })`;
   - `startBackgroundDataHydration()`;
   - helper fallbacks like `refreshScopedDataPreservingRoute(...)`;
   - `GET /api/data`;
   - `GET /api/data?scope=cards-basic`;
   - `GET /api/data?scope=directories`;
   - `GET /api/data?scope=production`;
   - live fallback refreshes that call full snapshot load.
2. Replace route-critical reads with domain/SQL-backed endpoints:
   - cards list/detail through cards endpoints/read model;
   - directories/security through `/api/directories/*` and `/api/security/*`;
   - production through production planning/execution scope endpoints;
   - derived views through `/api/derived/*`;
   - messaging/profile/notifications through `/api/chat/*`, profile and
     notification endpoints.
3. Remove route-critical dependency on full snapshot payload:
   - direct URL/F5 must not require `GET /api/data` full snapshot;
   - background hydration must not be required for correctness;
   - live fallback must perform targeted domain refresh or explicit
     non-authoritative diagnostic export only.
   - any remaining full/scope snapshot read must be either manual diagnostic,
     migration/export proof, or test-only legacy coverage with owner/removal
     condition.
4. Keep `GET /api/data` only if explicitly marked diagnostic/export/read-only:
   - it must not be used by route-critical app code;
   - it must not be the source of correctness for migrated domains.
5. Add/update proof tests that distinguish:
   - no route-critical app read to `GET /api/data` full snapshot;
   - no live fallback correctness dependency on `GET /api/data?scope=*`;
   - remaining tests that intentionally call `/api/data` are diagnostic/export
     checks, not application hydration.
6. Preserve SPA diagnostics:
   - `[BOOT]`, `[ROUTE]`, `[DATA]`, `[LIVE]`, `[CONFLICT]`.

Что нельзя делать:
- не change auth/session/bootstrap order unless required for this read cutover;
- не add new page without router registration;
- не use realtime as correctness source;
- не migrate fixtures in this batch;
- не remove final `JsonDatabase` runtime shell until Batch 5 unless all callers
  are already gone and proof is complete.
- не маскировать read dependency простым переименованием `/api/data` helper'а;
- не оставлять background hydration as hidden correctness requirement.

Проверки:
- static source scan proving no route-critical app code calls full snapshot
  `loadData()` / `GET /api/data` as authority;
- static source scan for `loadDataWithScope`, `startBackgroundDataHydration`,
  `refreshScopedDataPreservingRoute`, `LEGACY_SNAPSHOT_READ_PATH`,
  `DATA_SCOPE_FULL`;
- direct URL/F5 on `/dashboard`, `/cards`, `/cards/<id>`, `/profile/<id>`,
  `/production/plan`, `/workspace`;
- Back / Forward smoke;
- focused domain read tests for cards, directories/security, production,
  derived views, messaging/profile;
- live unavailable fallback remains targeted/non-authoritative.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Read paths removed from snapshot authority.
2. Route-critical replacement endpoints.
3. Remaining `GET /api/data` classification.
4. Bootstrap/router proof.
5. Tests/checks run.
6. Remaining fixture/runtime JSON risks for Batch 4-5.
```

## Ручная проверка после Prompt

Проверить direct URL/F5 и Back/Forward на ключевых маршрутах, затем проверить
cards, directories/security, production/workspace, derived views и chat/profile.
