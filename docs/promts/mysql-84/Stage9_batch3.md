# MySQL 8.4 Stage 9 Batch 3

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
- Batch 3 добавляет server read endpoints over derived SQL read models.
- Нельзя выполнять client route cutover в этом batch, кроме минимальных
  diagnostic/test hooks, если они уже существуют.
- Нельзя создавать write endpoints для derived views.
- Начинать можно только после Stage 9 Batch 2 PASS.
- Server endpoints must use Stage 9 query/read model layer from Batch 2 and
  must not assemble payloads from `/api/data?scope=production`.
- Актуальный baseline после Batch 2:
  - `DerivedViewsRepository` существует и читает только SQL read models;
  - migration `010_derived_views_read_model_semantics.sql` добавляет
    `item_kind` / `sample_type` в `production_flow_item_states`;
  - `production_ok_read_model` = `SAMPLE` + `CONTROL`;
  - `production_oc_read_model` = `SAMPLE` + `WITNESS`;
  - `workorders_read_model` зависит от cards + planning tasks + execution
    flow/projection, а не только от `cards.archived = FALSE`;
  - optional real MySQL migration run was skipped in Batch 2 unless local
    env explicitly enabled it.
- Главные риски Batch 3:
  - endpoint может случайно открыть SQL read model без accepted source-domain
    guards;
  - payload может оказаться неудобным для Batch 4 и спровоцировать client
    fallback к full snapshot;
  - detail lookup может потерять стабильность `qrId`/barcode/route card number;
  - unsupported methods могут стать неявным derived write surface.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 9 Batch 3: implement server API/read endpoints for
derived views SQL read models.

Что сделать:
1. Add dedicated read-only endpoints for derived routes/read models. Exact URL
   names may follow local conventions, but preferred map is:
   - `GET /api/derived/workorders`;
   - `GET /api/derived/workorders/:qr`;
   - `GET /api/derived/archive`;
   - `GET /api/derived/archive/:qr`;
   - `GET /api/derived/items`;
   - `GET /api/derived/ok`;
   - `GET /api/derived/oc`.
2. Endpoints must return client-compatible shape or a documented adapter shape
   that Batch 4 can consume without reintroducing full snapshot reads.
3. Detail endpoints must identify cards by stable `qrId`/barcode and preserve
   `/workorders/:qr` and `/archive/:qr` route stability.
4. Archive endpoints must be read-only. Repeat remains `/api/cards-core/:id/repeat`
   or existing card command and must create a new draft.
5. Workorders endpoints must derive from SQL cards + Stage 7 planning +
   Stage 8 execution source/read models.
6. Items/OK/OC endpoints must derive from SQL production execution item/sample
   states and include enough card metadata for navigation to
   `/workorders/:qr` or `/archive/:qr`.
7. Add explicit source guard for derived SQL endpoints:
   - require cards SQL source;
   - require directories/security SQL source where endpoint payload includes
     user/permission/display dependencies;
   - require production planning SQL source for workorders;
   - require production execution SQL source for items/OK/OC;
   - fail fast with `[DB]`/`[DATA]` diagnostics if required source domains are
     not accepted.
8. Do not run real DB migrations implicitly from server boot. If a real local
   MySQL check is available, run it only through existing migration/test
   commands and report the exact env-gated result.
9. Add endpoint/API tests for:
   - list/detail;
   - not found detail;
   - no POST/PUT/PATCH/DELETE derived write surface;
   - source-domain SQL dependency proof;
   - endpoint guard refuses SQL-derived reads when required source flags are
     missing;
   - endpoint payload does not require client full snapshot merge.

Что нельзя делать:
- не читать production planning через `/api/data?scope=production`;
- не использовать legacy `card.flow` compatibility projection as write
  authority;
- не добавлять independent mutable state for derived views;
- не менять client route loaders yet;
- не начинать messaging/realtime/outbox stages.

Проверки:
- `npm run test:sql`;
- focused API tests for derived endpoints;
- source scan/proof that new endpoints do not call `database.getData()` as
  authority when SQL source flags are enabled;
- proof that unsupported write methods return 404/405/403 without mutation.
- if `TSPCC_SQL_MIGRATION_TEST=1` is not available, explicitly report that
  real MySQL migration execution remains a Batch 4/5 acceptance risk.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 9 Batch 3 PASS/FAIL/BLOCKED.
2. Endpoint map.
3. Source-domain dependency proof.
4. Write authority proof.
5. Detail route stability proof.
6. Tests/checks run.
7. Remaining risks for Batch 4.
```

## Ручная проверка после Prompt

Не нужна. Browser route verification выполняется after client cutover.
