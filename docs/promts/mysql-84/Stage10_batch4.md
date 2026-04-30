# MySQL 8.4 Stage 10 Batch 4

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
- Это MySQL 8.4 Stage 10: Messaging, Profile and Notifications SQL Cutover.
- Это compatibility/test hardening batch после runtime cutover.
- Нельзя начинать финальную acceptance, пока этот batch не дал PASS.
- Нельзя создавать second messaging API.
- Нельзя возвращать snapshot fields в роль write authority.
- Начинать можно только после Stage 10 Batch 3 PASS.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 10 Batch 4: закрыть compatibility/removal gaps и
доказать, что snapshot messaging/profile/push fields больше не являются write
authority после SQL cutover.

Проверь и при необходимости исправь:
1. `POST /api/data` cannot overwrite SQL-owned messaging/profile slices:
   `messages`, `chatConversations`, `chatMessages`, `chatStates`,
   `userActions`, `userVisits`, `webPushSubscriptions`, `fcmTokens`.
2. `GET /api/data` and scoped compatibility reads, если они еще нужны, are
   read/export compatibility only and assembled from SQL-backed source or
   explicitly documented as non-authoritative.
3. Legacy `messages` stays removed/empty/read-only archived. Non-empty legacy
   `messages` must remain a blocker requiring archive/owner decision, not a
   revived `/api/messages/*` path.
4. Import/reconciliation reports cover:
   - conversations;
   - participants;
   - messages;
   - read/delivered states;
   - user actions;
   - user visits;
   - WebPush subscriptions;
   - FCM tokens;
   - legacy `messages` classification.
5. Client does not use `saveData()` or full snapshot write for chat/profile/
   push flows.
6. Stage 10 SQL runtime does not depend on realtime for correctness.
7. Diagnostics are preserved:
   `[DATA]`, `[LIVE]`, `[CONFLICT]`, `[DB]` where applicable.

Что нельзя делать:
- не delete `/api/data` globally; это Stage 12 scope;
- не hide blockers by silently merging JSON snapshot into SQL;
- не introduce dual-write as normal migration strategy;
- не change profile privacy or notification deeplink semantics.

Проверки:
- `npm run test:sql`;
- focused E2E proving snapshot overwrite protection for all Stage 10 slices;
- focused E2E/source scan proving no `/api/messages/*`;
- focused E2E/source scan proving no client `saveData()` caller for messaging/
  profile/notifications;
- import/reconciliation checks for messaging/profile;
- route stability checks for `/profile/:id` direct URL/F5 and deeplink after
  SQL runtime cutover.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Compatibility hardening PASS/FAIL/BLOCKED.
2. Snapshot overwrite protection proof.
3. Import/reconciliation proof.
4. Client write-path proof.
5. Route/deeplink proof.
6. Tests/checks run.
7. Readiness for Stage 10 Batch 5 acceptance.
```

## Ручная проверка после Prompt

Проверить `/profile/:id`, chat deeplink and push controls if available.
