# MySQL 8.4 Stage 9 Batch 5

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
- Это финальная acceptance-проверка MySQL Stage 9.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 10.
- Acceptance должна подтвердить, что Stage 9 не вернул JSON/snapshot authority
  для cards/files, directories/security, planning или execution под видом
  derived read model.
- Acceptance должна explicitly verify risks from Stage9_batch1:
  - `/ok` is control samples, not `quality_status = 'OK'`;
  - `/oc` is witness samples, not defect queue;
  - `/workorders` no longer depends on stale `/api/data?scope=production`
    E2E expectation;
  - dedicated derived route reads are SQL-backed or explicitly documented
    read-only bridge with removal path.
- Начинать можно только после Stage 9 Batch 4 PASS.
- Acceptance must classify result as `BLOCKED`, not `PASS`, if any of the
  following remain true:
  - real MySQL migration execution for migration `010` was never run in an
    env-gated local/test DB and no explicit reason/owner is documented;
  - a derived client route can still fall back to full JSON snapshot for
    route-critical data;
  - a Stage 9 endpoint runs without accepted SQL source-domain guards;
  - `/ok` or `/oc` tests prove only generic status/defect behavior, not
    `sample_type` identity;
  - focused route tests still watch or require `/api/data?scope=production`
    for derived views.
```

## Промт

```text
Нужно выполнить Stage 9 Batch 5: приемку Derived Views SQL Read Model Cutover.

Проверь exit criteria:
- derived views read from SQL source domains/read models;
- no legacy source-model assumption remains for these routes;
- no new write path is introduced;
- `/workorders`, `/workorders/:qr`, `/archive`, `/archive/:qr`, `/items`,
  `/ok`, `/oc` use Stage 9 read endpoints or documented SQL-backed read-only
  bridge;
- archive repeat creates a new draft through cards command and does not mutate
  the archived card;
- detail routes preserve card context after direct URL, F5 and Back/Forward.

Проверь failure conditions:
- derived view owns separate mutable state;
- archive repeat mutates archived card instead of creating new draft;
- detail route loses card context;
- derived view uses legacy snapshot as authoritative source for any accepted
  SQL domain;
- planning source is `/api/data?scope=production` instead of Stage 7 SQL
  repository/query layer;
- execution source is legacy `card.flow` compatibility projection instead of
  Stage 8 SQL execution tables/read layer;
- `/ok` or `/oc` semantics are confused with quality status or defect queue;
- focused E2E still requires `/workorders` to call
  `GET /api/data?scope=production`.

Required checks:
- `npm run test:sql`;
- env-gated migration execution check for `010_derived_views_read_model_semantics.sql`
  if local/test MySQL credentials are available; otherwise record this as an
  explicit residual operational risk, not as silently covered;
- focused E2E for derived routes;
- direct URL/F5 for `/workorders/:qr` and `/archive/:qr`;
- Back/Forward list-detail-list;
- repeat from archive;
- items/OK/OC after representative source-domain flow change;
- no derived write bypass;
- no `POST /api/data` from these routes.
- source scan proving:
  - Stage 9 endpoints use `DerivedViewsRepository`;
  - `DerivedViewsRepository` does not use `/api/data`, `database.getData()`,
    JSON snapshot files or preserved compatibility payload as authority;
  - client derived route loaders do not use full snapshot fallback.

Acceptance risk summary to produce:
- residual SQL migration/runtime risk;
- residual client compatibility risk;
- residual route/F5/history risk;
- residual archive repeat risk;
- readiness decision for Stage 10.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 9 PASS/FAIL/BLOCKED.
2. Route/read model proof.
3. Source-domain dependency proof.
4. Items/OK/OC semantics proof.
5. Write authority proof.
6. Tests/checks run.
7. Residual risks.
8. Можно ли начинать Stage 10.
```

## Ручная проверка после Prompt

Проверить all derived routes, repeat from archive, F5/direct URL and
Back/Forward for list/detail routes.
