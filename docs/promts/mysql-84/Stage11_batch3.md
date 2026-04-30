# MySQL 8.4 Stage 11 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 11.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 12.
- Acceptance должна проверить representative events for accepted SQL domains,
  включая Stage 6 directories/security, и подтвердить, что live events are
  post-commit signals, not write authority.
```

## Промт

```text
Нужно выполнить Stage 11 Batch 3: приемку Realtime, Audit and Outbox
Finalization.

Проверь exit criteria:
- realtime reflects committed SQL state;
- audit/outbox path is consistent across domains;
- no domain requires realtime for correctness.

Проверь failure conditions:
- live event is not sent before commit as write confirmation;
- failed transaction does not emit success refresh;
- client correctness does not depend on SSE.
- any domain uses live event to compensate missing SQL commit/state.

Формат ответа:
1. Stage 11 PASS/FAIL/BLOCKED.
2. Outbox/audit proof.
3. Realtime post-commit proof.
4. Representative domain event coverage.
5. Tests/checks run.
6. Можно ли начинать Stage 12.
```

## Ручная проверка после Prompt

Проверить live refresh and fallback behavior on representative pages.
