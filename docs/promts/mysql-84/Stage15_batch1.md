# MySQL 8.4 Stage 15 Batch 1

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
- Это MySQL 8.4 Stage 15: Post-Cutover Hardening and 20-User Proof.
- Batch 1 является post-cutover audit.
- Нельзя делать perf hacks без измерений.
- Нельзя менять business behavior.
```

## Промт

```text
Нужно выполнить Stage 15 Batch 1: post-cutover audit and measurement plan.

Проверь:
1. Full E2E status.
2. 20-user scenario readiness.
3. Slow query logs.
4. Connection pool metrics.
5. Deadlocks/lock waits.
6. Backup schedule.
7. Restore rehearsal after cutover.
8. Remaining compatibility adapters.

Что нельзя делать:
- не tune blindly;
- не add client caches as workaround;
- не remove adapters without criteria proof.

Формат ответа:
1. Post-cutover audit result.
2. Measurement plan.
3. Compatibility cleanup candidates.
4. Risks/blockers.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
