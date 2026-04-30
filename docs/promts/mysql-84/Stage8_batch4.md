# MySQL 8.4 Stage 8 Batch 4

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
- Batch 4 можно начинать только после Stage 8 Batch 3 PASS.
- Batch 4 переносит только core workspace execution commands.
- Нельзя переносить material/drying/delayed/defect/repair/dispose в этом batch.
- Нельзя переносить derived views or messaging.
- Нельзя создавать second authoritative flow state.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 4: core workspace execution command cutover.

Scope этого batch:
- `/api/production/operation/start`;
- `/api/production/operation/pause`;
- `/api/production/operation/resume`;
- `/api/production/operation/reset`;
- `/api/production/operation/complete`;
- `/api/production/operation/comment`;
- `/api/production/flow/identify`;
- `/api/production/flow/commit`;
- `/api/production/personal-operation/select`;
- `/api/production/personal-operation/action`.

Что сделать:
1. Move listed command family to explicit SQL transaction methods in
   `ProductionExecutionRepository`.
2. SQL must own:
   - `production_flow_states.flow_version`;
   - `production_flow_item_states` for identify/commit transfer;
   - `personal_operations` for personal operation select/action;
   - `production_flow_events` for history.
3. Preserve business rules:
   - start/pause/resume/reset/complete state machine;
   - identify/commit item/sample semantics;
   - personal operation assignment/executor guards;
   - blocking rules from SQL-owned cards, Stage 6 directories/security and
     Stage 7 planning dependencies.
4. Keep projection update inside the same authoritative transaction:
   - `card_flow_projection`;
   - card-facing `card.flow`;
   - card operation compatibility fields.
5. Preserve `expectedFlowVersion -> 409`:
   - stale writes fail before mutation;
   - success increments flow version only;
   - planning revision must not change.

Что нельзя делать:
- не touch material issue/return;
- не touch drying;
- не touch delayed/defect/repair/dispose;
- не use snapshot-save or `/api/data` for execution writes;
- не rely on realtime for correctness.

Проверки:
- successful and stale `409` for each listed endpoint;
- two-tab conflict for start/comment/personal operation;
- `/workspace` and `/workspace/:qr` route-safe conflict refresh;
- direct URL/F5 for workspace routes;
- no planning revision bump after successful execution command;
- SQL event/projection reconciliation for affected cards.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 8 Batch 4 PASS/FAIL/BLOCKED.
2. Core command cutover proof.
3. Flow item/personal operation SQL proof.
4. Conflict/revision proof.
5. Projection/reconciliation proof.
6. Tests/checks run.
7. Remaining blockers for Batch 5.
```

## Ручная проверка после Prompt

Проверить `/workspace`, `/workspace/:qr`, start/comment or another safe core
execution action, F5/direct URL and conflict if possible.
