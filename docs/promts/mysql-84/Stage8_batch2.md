# MySQL 8.4 Stage 8 Batch 2

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
- Это MySQL 8.4 Stage 8: Production Execution and Workspace SQL Cutover.
- Batch 2 устраняет dependency/guard risks, выявленные Stage 8 Batch 1 audit.
- Можно менять только execution/workspace SQL cutover scope and required guards.
- Нельзя переносить derived views or messaging.
- Нельзя обновлять projection отдельно от authoritative transaction.
- Начинать implementation можно только если Stage 6 Batch 3 PASS и Stage 7
  Batch 5 PASS разрешили Stage 8.
- Execution SQL cutover нельзя включать отдельно от SQL planning source:
  blocking rules должны получать planning state из
  `ProductionPlanningRepository` / SQL-backed planning query layer.
- Execution/workspace не должен возвращать JSON/snapshot authority для
  operations, areas, users, access levels, shift times или planning state.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 2: harden production execution SQL boundary after
Batch 1 audit.

Контекст аудита Batch 1:
- базовый `ProductionExecutionRepository` уже может владеть `flow_version`,
  `production_flow_states`, `production_flow_events` и `card_flow_projection`;
- execution command write path должен оставаться SQL-owned;
- production workspace refresh должен использовать `/api/production/execution/scope`,
  а `/api/data?scope=production` может быть только SQL-backed compatibility
  read/export;
- главный оставшийся риск: misconfiguration, когда execution SQL включен без
  planning SQL source, из-за чего blocking rules могут получить stale planning
  slices;
- следующий риск: compatibility/projection не должны стать вторым
  authoritative flow model.

Что сделать:
1. Add hard guard for execution SQL source:
   - `TSPCC_PRODUCTION_EXECUTION_SQL_SOURCE=1` must require planning SQL source;
   - allowed production mode: `TSPCC_PRODUCTION_SQL_SOURCE=1`;
   - if execution SQL is requested without planning SQL, fail fast with clear
     `[BOOT]` / `[DB]` diagnostic, not silent snapshot fallback.
2. Make execution dependency reads explicit:
   - workspace/execution command data must be assembled from cards SQL source,
     Stage 6 directories/security SQL repositories, and Stage 7 planning SQL
     repository/query layer;
   - no command may read authoritative `productionSchedule`,
     `productionShiftTasks`, `productionShifts`, `ops`, `areas`, `users`,
     `accessLevels`, `productionShiftTimes` from JSON preserved slices.
3. Keep `/api/production/execution/scope` as the production workspace refresh
   endpoint:
   - client production refresh must not use `/api/data?scope=production`;
   - `/api/data?scope=production` remains compatibility read/export only and
     must call the same SQL-backed composer when execution SQL is enabled.
4. Keep current execution commands on one mutation boundary:
   - `persistProductionExecutionMutation(...)`;
   - `ProductionExecutionRepository.syncFlowStateFromCard(...)`;
   - `CardsRepository.writeCardExecutionProjection(...)`;
   - no direct `database.update(...)` in execution command families.
5. Preserve `expectedFlowVersion -> 409` and route-safe targeted refresh.
6. Add tests proving:
   - execution SQL cannot be enabled without planning SQL;
   - execution command data uses SQL planning dependencies;
   - production refresh uses `/api/production/execution/scope`;
   - `/api/data?scope=production` is SQL-backed compatibility in execution SQL
     mode;
   - execution command families do not bypass SQL mutation boundary.

Что нельзя делать:
- не normalize item/material/drying/delay/defect/repair tables in this batch
  unless required by the guard tests;
- не create two authoritative flow models;
- не use snapshot-save for execution;
- не change planning revision model;
- не start Stage 9 derived views.

Проверки:
- unit/static tests for env/source guards;
- stale flow version `409`;
- `/workspace` and `/workspace/:qr` route stability after conflict;
- `/production/delayed` and `/production/defects` route-safe conflict refresh;
- `/api/data?scope=production` compatibility proof in SQL mode.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 8 Batch 2 PASS/FAIL/BLOCKED.
2. SQL source guard proof.
3. Dependency source proof.
4. Execution command boundary proof.
5. Refresh/compatibility proof.
6. Tests/checks run.
7. Remaining blockers for Batch 3.
```

## Ручная проверка после Prompt

Проверить `/workspace`, `/workspace/:qr`, `/production/delayed`,
`/production/defects`, одно безопасное execution-действие, F5/direct URL and
conflict if possible.
