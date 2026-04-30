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
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 9 Batch 3: implement server API/read endpoints for
derived views SQL read models.

Что сделать:
1. Add dedicated read-only endpoints for derived routes/read models. Exact URL
   names may follow local conventions, but must cover:
   - workorders list;
   - workorders detail by `qr`;
   - archive list;
   - archive detail by `qr`;
   - items list;
   - OK list;
   - OC list.
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
7. Add endpoint/API tests for:
   - list/detail;
   - not found detail;
   - no POST/PUT/PATCH/DELETE derived write surface;
   - source-domain SQL dependency proof.

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
