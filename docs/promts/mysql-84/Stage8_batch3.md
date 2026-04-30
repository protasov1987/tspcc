# MySQL 8.4 Stage 8 Batch 3

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
- Batch 3 можно начинать только после Stage 8 Batch 2 PASS.
- Batch 3 является implementation foundation для normalized execution writes.
- Нельзя переносить derived views or messaging.
- Нельзя переводить все execution command families одним большим изменением.
- Нельзя создавать second authoritative flow state.
- Нельзя менять Stage 7 planning revision model.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 3: normalized execution repository foundation.

Цель:
подготовить SQL repository/query layer и reconciliation contract для
последующих маленьких command-family cutovers, не меняя все production
execution actions сразу.

Что сделать:
1. Extend `ProductionExecutionRepository` foundation methods for normalized
   execution tables:
   - stable SQL IDs for flow state, item state, personal operation,
     material/drying/delay/defect/repair/dispose rows;
   - transaction-scoped lock/check for `production_flow_states.flow_version`;
   - common append-only `production_flow_events` writer;
   - common `card_flow_projection` updater.
2. Add read/write helpers, but keep command behavior narrowly scoped:
   - item state helpers for `production_flow_item_states`;
   - personal operation helpers for `personal_operations`;
   - material/drying/delay/defect/repair/dispose helper skeletons may be added
     only as reusable repository methods, not wired to every command yet.
3. Define projection contract:
   - `card.flow` remains compatibility/read model;
   - `card_flow_projection` remains card-facing projection;
   - neither can be updated without the same authoritative SQL transaction.
4. Add reconciliation utilities/tests:
   - normalized SQL state can be compared to representative `card.flow`
     projection;
   - `production_flow_events` survive command updates;
   - projection update cannot delete `card_operations` and cascade flow
     history.
5. Add static guard tests:
   - no direct `database.update(...)` inside execution command block in SQL
     mode;
   - no command-family batch may bypass `ProductionExecutionRepository`.

Что нельзя делать:
- не cut over material/drying/delayed/defect/repair/dispose commands yet;
- не remove compatibility `card.flow`;
- не use `/api/data` or snapshot-save for execution writes;
- не store final execution model only as JSON in `cards`;
- не rely on realtime for correctness.

Проверки:
- SQL repository unit tests for lock/check/event/projection helpers;
- static tests for command boundary;
- reconciliation test for flow events/projection;
- existing stale `expectedFlowVersion -> 409` tests remain green;
- existing workspace route-safe conflict tests remain green.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 8 Batch 3 PASS/FAIL/BLOCKED.
2. Repository foundation proof.
3. Projection contract proof.
4. Reconciliation/static guard proof.
5. Tests/checks run.
6. Remaining blockers for Batch 4.
```

## Ручная проверка после Prompt

Проверить `/workspace`, F5/direct URL and one stale conflict if possible.
