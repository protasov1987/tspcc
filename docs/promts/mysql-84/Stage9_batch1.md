# MySQL 8.4 Stage 9 Batch 1

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
- Batch 1 является audit/design.
- Нельзя менять code.
- Нельзя добавлять write authority to derived views.
```

## Промт

```text
Нужно выполнить Stage 9 Batch 1: audit/design derived views SQL read model
cutover.

Проверь routes:
- `/workorders`
- `/workorders/:qr`
- `/archive`
- `/archive/:qr`
- `/items`
- `/ok`
- `/oc`

Что проверить:
1. Current read sources.
2. Current actions, if any.
3. Archive semantics and repeat flow.
4. Items/OK/OC dependence on flow.
5. Detail route stability.
6. Required SQL source/read models.

Что нельзя делать:
- не менять code/docs;
- не create independent mutable state;
- не start messaging/realtime stages.

Формат ответа:
1. Derived route map.
2. SQL read model proposal.
3. Write authority proof.
4. Risks/blockers.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
