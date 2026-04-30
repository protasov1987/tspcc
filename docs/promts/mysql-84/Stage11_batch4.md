# MySQL 8.4 Stage 11 Batch 4

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
- Acceptance можно выполнять только после Stage 11 Batch 3 PASS.
- Acceptance должна проверить representative events for accepted SQL domains,
  включая Stage 6 directories/security, и подтвердить, что live events are
  post-commit signals, not write authority.
- Acceptance должна считать messaging/profile/notifications accepted domain
  только если Stage 10 Batch 5 PASS подтвержден. Иначе это blocker для Stage 11
  PASS, а не допустимое outbox исключение.
```

## Промт

```text
Нужно выполнить Stage 11 Batch 4: приемку Realtime, Audit and Outbox
Finalization.

Проверь exit criteria:
- realtime reflects committed SQL state;
- audit/outbox path is consistent across accepted SQL domains;
- no domain requires realtime for correctness;
- failed transaction does not create success outbox/live event;
- dispatched live payloads follow the Stage 11 envelope contract:
  domain, entity, id, rev/version, event type, timestamp;
- existing SSE compatibility names still lead only to targeted refresh;
- diagnostics `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]` are preserved.

Проверь failure conditions:
- live event is sent before commit as write confirmation;
- failed transaction emits success refresh;
- client correctness depends on SSE;
- any domain uses live event to compensate missing SQL commit/state;
- `audit_events` / `outbox_events` exist only as unused schema tables after
  claimed implementation PASS;
- Stage 6 directories/security events are missing or bypass their permission/
  conflict semantics;
- messaging/profile/notifications are counted as accepted without explicit
  Stage 10 Batch 5 PASS.

Обязательные проверки:
- source scan for runtime writes to `audit_events` and `outbox_events`;
- committed event test;
- rollback no-event test;
- representative multi-client refresh tests:
  - cards/card files;
  - directories/security;
  - production planning/execution;
  - messaging/profile/notifications only if Stage 10 Batch 5 PASS exists;
- realtime unavailable fallback;
- source scan proving no bootstrap/router/live correctness dependency;
- diagnostics prefix scan for `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]`;
- `npm run test:sql`;
- focused E2E relevant to changed live/outbox paths.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 11 PASS/FAIL/BLOCKED.
2. Outbox/audit proof.
3. Realtime post-commit proof.
4. Representative domain event coverage.
5. Diagnostics proof.
6. Tests/checks run.
7. Можно ли начинать Stage 12.
```

## Ручная проверка после Prompt

Проверить live refresh and fallback behavior on representative pages:
`/cards`, `/users` or `/accessLevels`, `/production/plan`, `/workspace`, and
`/profile/:id` if Stage 10 Batch 5 PASS is confirmed.
