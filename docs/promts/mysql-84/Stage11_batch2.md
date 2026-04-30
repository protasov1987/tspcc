# MySQL 8.4 Stage 11 Batch 2

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
- Это MySQL 8.4 Stage 11: Realtime, Audit and Outbox Finalization.
- Это implementation foundation batch после Stage 11 Batch 1 audit/design.
- Можно менять только shared realtime/audit/outbox foundation:
  repository/helpers, transaction integration, post-commit dispatcher boundary
  and focused tests.
- Нельзя в этом batch массово переписывать все domain handlers или весь SSE.
- Нельзя делать realtime source of correctness.
- Начинать implementation можно только если domain SQL cutovers Stage 5-10
  accepted, включая Stage 10 Batch 5 PASS. Не использовать outbox/live как
  workaround для домена, который ещё не имеет SQL source of truth.
- Если Stage 10 Batch 5 PASS не подтвержден явным acceptance artifact, batch
  должен завершиться `BLOCKED`; нельзя подключать
  messaging/profile/notifications к finalized outbox/live как будто SQL cutover
  завершен.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 11 Batch 2: реализовать outbox/audit foundation and
post-commit dispatcher boundary over committed SQL state.

Что сделать:
1. Сначала подтвердить prerequisite artifacts:
   - Stage 5 Batch 3 PASS;
   - Stage 6 Batch 3 PASS;
   - Stage 7 Batch 5 PASS;
   - Stage 8 Batch 9 PASS;
   - Stage 9 Batch 5 PASS;
   - Stage 10 Batch 5 PASS.
   Если Stage 10 Batch 5 PASS artifact отсутствует, завершить batch как
   `BLOCKED` и не делать implementation.
2. Implement shared audit/outbox repository/helper over existing tables:
   - `audit_events`;
   - `outbox_events`.
3. Add transaction helper contract for domain repositories:
   - domain command writes audit/outbox rows inside the same SQL transaction;
   - failed/rolled back transaction leaves no success outbox event;
   - helper returns committed event descriptors only after commit.
4. Add post-commit dispatcher boundary:
   - dispatch existing SSE event names only after transaction commit;
   - do not treat SSE delivery as write success;
   - failed dispatch updates diagnostics/attempt state but does not rollback
     already committed domain write.
5. Standardize event envelope shape for future Batch 3 wiring:
   `domain`, `entity`, `id`, `rev` or `version`, `eventType`, `timestamp`,
   optional `scope`, `route`, `hints`.
6. Preserve current client compatibility:
   - existing event names may remain as compatibility transport;
   - payload must be sufficient for targeted refresh;
   - no bootstrap/router dependency on live.
7. Preserve diagnostics `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]`.

Что нельзя делать:
- не wire all domains in this batch;
- не rewrite SSE broadly;
- не emit success event before commit;
- не use live as write confirmation;
- не make failed transaction emit success refresh;
- не подключать messaging/profile/notifications без Stage 10 Batch 5 PASS.

Проверки:
- focused unit/sql tests for outbox/audit repository/helper;
- transaction commit creates outbox/audit rows;
- transaction rollback creates no outbox/live success event;
- dispatcher emits only after commit;
- source scan: no new bootstrap/router/live correctness dependency;
- diagnostics prefix scan for `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]`.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 11 Batch 2 PASS/FAIL/BLOCKED.
2. Prerequisite proof.
3. Outbox/audit foundation.
4. Post-commit dispatcher boundary.
5. Event envelope contract.
6. Tests/checks run.
7. Remaining risks for Batch 3 domain wiring.
```

## Ручная проверка после Prompt

Не нужна; это foundation batch. Если легко, можно smoke-проверить, что live
unavailable fallback не ухудшился.
