# MySQL 8.4 Stage 10 Batch 3

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
- Это runtime cutover batch.
- Можно менять только existing messaging/profile/notifications endpoints,
  repository wiring and narrowly required tests.
- Нельзя создавать `/api/messages/*` или любой second messaging API.
- Нельзя менять SPA routing/bootstrap.
- Нельзя менять profile privacy semantics.
- Начинать можно только после Stage 10 Batch 2 PASS.
- Stage 9 Batch 5 PASS и Stage 6 SQL security proof остаются обязательными
  prerequisites. Если они не подтверждены, заверши batch как `BLOCKED`.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 10 Batch 3: перевести runtime
messaging/profile/notifications на SQL source of truth через repository из
Batch 2.

Что сделать:
1. Make existing `/api/chat/*` SQL-backed primary stack:
   - `GET /api/chat/users`;
   - `POST /api/chat/direct`;
   - `GET /api/chat/conversations/:id/messages`;
   - `POST /api/chat/conversations/:id/messages`;
   - `POST /api/chat/conversations/:id/delivered`;
   - `POST /api/chat/conversations/:id/read`;
   - `GET /api/chat/stream` initial unread count.
2. Preserve current API response shape expected by `js/app.95.messenger.js`.
3. Preserve direct conversation semantics:
   - direct conversations remain unique per participant pair;
   - system user dialog remains read-only;
   - no-system-user dialog rule remains enforced.
4. Preserve message semantics:
   - idempotent `clientMsgId`;
   - monotonic `seq` per conversation inside SQL transaction;
   - optimistic send rollback still works on client failure;
   - delivered/read/unread states update the correct conversation.
5. Make `/api/user-actions` SQL-backed and own-profile only.
6. Make WebPush and FCM runtime writes SQL-backed:
   - `/api/push/subscribe`;
   - `/api/push/unsubscribe`;
   - `/api/push/test`;
   - `/api/fcm/subscribe`;
   - send paths list active SQL-owned tokens/subscriptions.
7. Profile/user ownership checks must use Stage 6 SQL-backed security state,
   not JSON `users` / `accessLevels` fallback.
8. Keep SSE/live as signal only; realtime must not become correctness source.

Что нельзя делать:
- не re-add `/api/messages/*`;
- не expose other user's profile or actions;
- не store WebPush/FCM without current authenticated user ownership;
- не read authoritative chat/profile/push state from `database.json`;
- не rely on `/api/data` to confirm messaging/profile writes.

Проверки:
- `npm run test:sql`;
- focused E2E for:
  - own `/profile/:id`;
  - foreign `/profile/:id` rejected without dashboard redirect;
  - direct chat send;
  - delivered/read/unread;
  - deeplink `openChatWith` / `conversationId`;
  - no-system-user dialog rule;
  - optimistic send rollback/retry;
  - WebPush subscribe/unsubscribe/test;
  - FCM token subscribe;
  - no `/api/messages/*` parallel stack.
- source scan proving `/api/chat/*`, `/api/user-actions`, WebPush and FCM
  handlers use the Stage 10 repository, not snapshot arrays.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Runtime SQL cutover implemented.
2. Messaging source proof.
3. Profile/user_actions proof.
4. Push/FCM proof.
5. Stage 6 security dependency proof.
6. Tests/checks run.
7. Remaining compatibility for Batch 4.
```

## Ручная проверка после Prompt

Проверить own profile, foreign profile denial, chat send/read, deeplink and
push controls if available.
