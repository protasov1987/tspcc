# MySQL 8.4 Stage 9 Batch 4

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
- Это MySQL 8.4 Stage 9: Derived Views SQL Read Model Cutover.
- Batch 4 выполняет client route cutover на dedicated derived read endpoints
  из Batch 3.
- Нельзя создавать derived write authority.
- Нельзя возвращать `/workorders`, `/archive`, `/items`, `/ok`, `/oc` к
  `/api/data?scope=production` or full snapshot read as primary source.
- `/api/production/execution/scope` может оставаться production/workspace
  refresh endpoint, but derived routes should use Stage 9 read endpoints after
  this batch unless explicitly documented as a temporary read-only bridge.
- Начинать можно только после Stage 9 Batch 3 PASS.
- Актуальные риски, которые Batch 4 обязан закрыть:
  - focused E2E may still assert stale `GET /api/data?scope=production` for
    `/workorders`;
  - client may still build `/items`, `/ok`, `/oc` from compatibility
    `cards[].flow` arrays instead of Stage 9 endpoints;
  - direct detail routes can lose card context if endpoint payload misses
    `qrId`/route-card metadata;
  - route-local refresh can accidentally fall back to full snapshot on empty
    SQL read models;
  - archive repeat can be confused with mutating/unarchiving archived card.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 9 Batch 4: switch client derived routes to SQL read
endpoints and update route tests.

Что сделать:
1. Switch route-critical data/loading for:
   - `/workorders`;
   - `/workorders/:qr`;
   - `/archive`;
   - `/archive/:qr`;
   - `/items`;
   - `/ok`;
   - `/oc`
   from client-built compatibility arrays to Stage 9 derived read endpoints.
   If a shared production refresh remains for non-derived workspace screens,
   keep it separated from derived route loaders and document the boundary in
   tests.
2. Preserve URL-first SPA contract:
   - direct URL;
   - F5;
   - Back/Forward;
   - no redirect to `/dashboard`;
   - no protected render before session restore.
3. Preserve route-local state:
   - workorders list filters/search;
   - items/OK/OC filters/sort/pagination;
   - detail route card context.
4. Preserve archive flow:
   - archive list/detail are read-only;
   - repeat from archive remains a cards command that opens/creates a new draft;
   - archived card is not unarchived or mutated as the new working card.
5. Update focused E2E expectations:
   - remove stale requirement that `/workorders` must call
     `GET /api/data?scope=production`;
   - assert Stage 9 derived endpoint calls, or if a temporary bridge remains,
     assert it is read-only and SQL-backed;
   - keep `POST /api/data` forbidden for these routes.
6. Ensure empty SQL read model responses are valid empty lists/details-not-found,
   not a trigger for client fallback to JSON snapshot or `/api/data`.
7. Keep realtime optional: live signals may trigger refresh, but correctness
   comes from the server read endpoint.
8. Update tests/source scans proving:
   - derived route loaders call Batch 3 endpoints;
   - no route loader for `/workorders`, `/archive`, `/items`, `/ok`, `/oc`
     uses `loadData('production')`, `/api/data?scope=production`, full
     `loadData()` or `saveData()` as derived authority;
   - `/ok` UI identity remains control samples and `/oc` remains witness
     samples, regardless of defect/dispose/delay display statuses.

Что нельзя делать:
- не менять bootstrap/router pipeline;
- не add new menu handlers outside navigation layer;
- не create client fallback to full snapshot for derived routes;
- не use `window.location` for SPA navigation;
- не start Stage 10 messaging/profile work.

Проверки:
- focused E2E for workorders/archive/items/ok/oc;
- direct URL/F5 on `/workorders/:qr` and `/archive/:qr`;
- Back/Forward list-detail-list;
- archive repeat creates/opens new draft without mutating archived card;
- no `/api/data` writes;
- no critical client failures;
- no fallback to full snapshot when Stage 9 endpoints return empty lists;
- no stale E2E expectation for `GET /api/data?scope=production`.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 9 Batch 4 PASS/FAIL/BLOCKED.
2. Client route cutover map.
3. Route stability proof.
4. Archive/repeat proof.
5. No snapshot/write bypass proof.
6. Tests/checks run.
7. Remaining risks for acceptance.
```

## Ручная проверка после Prompt

Проверить `/workorders`, `/workorders/:qr`, `/archive`, `/archive/:qr`,
`/items`, `/ok`, `/oc`, archive repeat, F5/direct URL and Back/Forward.
