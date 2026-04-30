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
- Audit must explicitly include Stage 6 directories/security under normal and
  concurrent load: no stale JSON dependency, no permission/profile regression,
  no writable compatibility adapter.
- Audit must explicitly include Stage 10 messaging/profile/notifications under
  normal and concurrent load: no stale JSON dependency, no profile privacy
  regression, no WebPush/FCM ownership regression, no `/api/messages/*`, no
  writable compatibility adapter.
- Audit must explicitly include Stage 11 realtime/audit/outbox under normal
  and degraded-live conditions: no pre-commit live success event, no rollback
  success event, no correctness dependency on SSE, and diagnostics remain
  actionable.
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
9. Directories/security query/write latency, conflicts and route stability.
10. Messaging/profile/notifications query/write latency, route stability,
    deeplink behavior, push/FCM ownership and snapshot compatibility state.
11. Realtime/audit/outbox behavior:
    committed event latency, rollback no-event, outbox attempts/errors,
    multi-client refresh and unavailable fallback.

Что нельзя делать:
- не tune blindly;
- не add client caches as workaround;
- не remove adapters without criteria proof.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Post-cutover audit result.
2. Measurement plan.
3. Compatibility cleanup candidates.
4. Realtime/audit/outbox findings.
5. Risks/blockers.
6. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
