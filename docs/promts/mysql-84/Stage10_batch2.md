# MySQL 8.4 Stage 10 Batch 2

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
- Это implementation foundation batch, а не runtime cutover.
- Можно менять только messaging/profile/notifications SQL repository,
  import/reconciliation/test scope.
- Нельзя создавать second messaging API.
- Нельзя переводить runtime `/api/chat/*` на SQL в этом batch.
- Нельзя менять profile privacy semantics.
- Начинать implementation foundation можно только если Stage 10 Batch 1
  завершен и
  Stage 9 Batch 5 PASS разрешил переход к Stage 10.
- Stage 10 implementation additionally requires Stage 6 security source of
  truth is SQL and profile identity/permissions are SQL-backed.
- Messaging/profile не должен читать authoritative users/accessLevels из
  legacy snapshot fallback.
- Если Stage 9 Batch 5 PASS или Stage 6 SQL security proof не подтверждены,
  заверши batch как `BLOCKED` и не добавляй fallback к JSON `users` /
  `accessLevels`.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 10 Batch 2: подготовить SQL repository/foundation для
messaging/profile/notifications без переключения runtime endpoints.

Что сделать:
1. Implement messaging/profile repository over existing SQL tables:
   `chat_conversations`, `chat_conversation_participants`, `chat_messages`,
   `chat_message_states`, `user_visits`, `user_actions`,
   `web_push_subscriptions`, `fcm_tokens`.
2. Repository должен покрывать current `/api/chat/*` contract shape:
   users list, direct conversation open/create, conversation messages,
   idempotent `clientMsgId`, delivered/read state, unread counts.
3. Repository должен использовать Stage 6 SQL-backed security identity source
   for users/access levels/profile ownership. Не читать authoritative
   `users`/`accessLevels` из legacy snapshot fallback.
4. Define user actions boundary:
   `user_actions` is the profile/audit-owned single model; other domains may
   append only through shared repository/audit boundary.
5. Define WebPush/FCM repository methods with user ownership:
   subscribe/upsert, unsubscribe/revoke, list active by user, token/endpoint
   hash uniqueness, no raw secret logging.
6. Validate importer/reconciliation coverage for messaging/profile/push:
   conversations, participants, messages, read/delivered states,
   user actions, user visits, WebPush, FCM, legacy `messages`.
7. Add focused SQL tests for repository API shape and SQL injection-safe
   parameterized access.

Что нельзя делать:
- не re-add `/api/messages/*` as active stack;
- не switch `/api/chat/*` runtime handlers yet;
- не expose other user's profile;
- не store push tokens without owner.
- не treat `database.json` chat/profile arrays as SQL source of truth.

Проверки:
- `npm run test:sql`;
- repository unit/integration checks for:
  - direct conversation create/find;
  - message insert with idempotent `clientMsgId`;
  - delivered/read state update;
  - unread count;
  - own user actions read and foreign read denial helper;
  - WebPush subscribe/unsubscribe ownership;
  - FCM token upsert ownership.
- source scan proof that runtime `/api/chat/*` still has not been duplicated
  and `/api/messages/*` is absent.
- no `/api/messages/*` parallel write stack;
- reconciliation for messages/profile/importer.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Repository/foundation implemented.
2. Stage 6 security dependency proof.
3. User actions ownership.
4. Push/FCM repository plan/proof.
5. Runtime cutover readiness for Batch 3.
6. Tests/checks run.
7. Remaining compatibility.
```

## Ручная проверка после Prompt

Не нужна.
