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
- Это MySQL 8.4 Stage 11: Realtime, Audit and Outbox Finalization.
- Это domain wiring batch после Stage 11 Batch 2 foundation PASS.
- Можно менять только wiring accepted SQL domain commands to the shared
  audit/outbox/post-commit boundary from Batch 2.
- Нельзя делать realtime source of correctness.
- Нельзя менять router/bootstrap.
- Нельзя использовать live/outbox как workaround для домена, который ещё не
  имеет SQL source of truth.
- Messaging/profile/notifications можно подключать только если Stage 10
  Batch 5 PASS artifact подтвержден. Если подтверждения нет, batch должен
  завершиться `BLOCKED`, а не пропускать домен молча.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 11 Batch 3: подключить representative accepted SQL
domains к outbox/audit/live post-commit boundary.

Что сделать:
1. Подтвердить Stage 11 Batch 2 PASS.
2. Wire cards/card files commands to audit/outbox:
   - create/update/archive/delete/repeat;
   - approval/input-control/provision;
   - upload/delete/resync file metadata.
3. Wire Stage 6 directories/security commands:
   - departments/work centers;
   - operations and operation-area links;
   - areas;
   - employees assignment;
   - shift times;
   - users;
   - access levels.
   Нельзя менять permission, guard or conflict semantics.
4. Wire production planning/execution commands:
   - schedule/plan/auto-plan save;
   - shift lifecycle and shift-close draft/finalize;
   - workspace start/pause/resume/complete/reset;
   - personal operations;
   - material issue/return;
   - drying;
   - delayed/defect/repair/dispose;
   - operation comments.
5. Wire messaging/profile/notifications only after explicit Stage 10 Batch 5
   PASS:
   - `/api/chat/*`;
   - delivered/read/unread;
   - `user_actions`;
   - `user_visits`;
   - WebPush/FCM ownership events.
6. Preserve current SSE compatibility names where needed, but each event must
   carry or map from the standard envelope:
   `domain`, `entity`, `id`, `rev` or `version`, `eventType`, `timestamp`.
7. Ensure live only signals targeted refresh:
   - no client patching from untrusted live payload as source of truth;
   - refresh reads committed SQL state;
   - fallback works when SSE is unavailable.
8. Preserve diagnostics `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]`.

Что нельзя делать:
- не rewrite SSE broadly;
- не make bootstrap depend on live;
- не emit live event before commit;
- не make failed transaction emit success refresh;
- не use outbox/live to mask missing SQL source of truth;
- не ослаблять Stage 6 security guards or Stage 10 profile privacy.

Проверки:
- representative live event after commit for each wired domain family;
- rollback/no-event proof;
- multi-client refresh for cards, directories/security, production and chat
  if Stage 10 PASS is confirmed;
- realtime unavailable fallback;
- source scan proving no live-as-correctness dependency;
- tests for outbox rows and dispatched payload envelope.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 11 Batch 3 PASS/FAIL/BLOCKED.
2. Prerequisite proof.
3. Domain event wiring map.
4. Post-commit proof.
5. Representative domain event coverage.
6. Realtime fallback proof.
7. Tests/checks run.
8. Remaining blockers for Batch 4 acceptance.
```

## Ручная проверка после Prompt

Проверить representative multi-client live refresh and fallback behavior on:
`/cards`, `/users` or `/accessLevels`, `/production/plan`, `/workspace`, and
`/profile/:id` if Stage 10 Batch 5 PASS is confirmed.
