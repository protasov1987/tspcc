# MySQL 8.4 Stage 9 Batch 2

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
- Batch 2 переносит только SQL query/read model foundation для derived views.
- Клиентский route cutover выполняется позже, не в этом batch.
- Нельзя создавать bypass write-path.
- Начинать implementation можно только если source domains accepted:
  cards/files, directories/security, production planning, production execution.
- Derived views не должны использовать JSON/snapshot as fallback authority for
  any source domain.
- Audit baseline из Stage9_batch1:
  - SQL views уже существуют, но их semantics недостаточны для Stage 9
    acceptance;
  - `/ok` в UI означает контрольные образцы (`sampleType: CONTROL`), а не
    `quality_status = 'OK'`;
  - `/oc` в UI означает образцы-свидетели (`sampleType: WITNESS`), а не defect
    queue;
  - текущие client views еще собираются из cards-core/cache and production
    execution scope compatibility shape, а не из dedicated derived read
    endpoints;
  - focused E2E содержит устаревшее ожидание `GET /api/data?scope=production`
    для `/workorders`; после Stage 8 primary refresh должен идти через
    `/api/production/execution/scope` или через новые derived endpoints.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 9 Batch 2: harden SQL read model/query layer для
derived views без client route cutover.

Что сделать:
1. Review and fix SQL read model semantics for:
   - `workorders_read_model`;
   - `archive_read_model`;
   - `production_items_read_model`;
   - `production_ok_read_model`;
   - `production_oc_read_model`.
2. Implement repository/query layer, for example `DerivedViewsRepository`,
   that reads only accepted SQL source domains:
   - cards/files via Stage 5 SQL boundary;
   - directories/security via Stage 6 SQL repositories/read layer;
   - production planning via Stage 7 SQL repository/query layer;
   - production execution via Stage 8 SQL repository/tables.
3. Correct `/items`, `/ok`, `/oc` source semantics:
   - `/items`: production item states, not samples;
   - `/ok`: control samples (`kind = SAMPLE`, `sampleType = CONTROL`);
   - `/oc`: witness samples (`kind = SAMPLE`, `sampleType = WITNESS`);
   - defect/dispose/delay statuses may be displayed, but they are not the
     route identity for `/ok` or `/oc`.
4. Keep `archive` as cards-derived read model with `archived = TRUE`.
5. Keep `workorders` as cards + planning/execution derived read model, not a
   plain `cards.archived = FALSE` dump.
6. Add/adjust SQL tests proving query layer semantics and that no query reads
   `/api/data`, JSON snapshot files, or preserved compatibility payload as
   authority.
7. Do not change client route loaders in this batch except where unavoidable
   for tests of the query layer.

Что нельзя делать:
- не mutate derived view state directly;
- не reintroduce snapshot source;
- не change cards/production business semantics.
- не менять archive/repeat write commands;
- не создавать client fallback to JSON snapshot for empty SQL read models.

Проверки:
- `npm run test:sql`;
- repository/query unit tests for workorders/archive/items/ok/oc;
- proof that `production_ok_read_model` and `production_oc_read_model` match
  sample type semantics;
- proof that planning dependencies come from Stage 7 SQL repository/query layer,
  not `/api/data?scope=production`;
- no derived write bypass.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 9 Batch 2 PASS/FAIL/BLOCKED.
2. SQL read model semantics proof.
3. Source-domain dependency proof.
4. Write authority proof.
5. Tests/checks run.
6. Remaining risks for Batch 3.
```

## Ручная проверка после Prompt

Не нужна. Client route cutover выполняется в следующих batch.
