# MySQL 8.4 Stage 10 Batch 5

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
- Это финальная acceptance-проверка MySQL Stage 10.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 11.
- Acceptance можно выполнять только после:
  - Stage 9 Batch 5 PASS;
  - Stage 10 Batch 4 PASS;
  - Stage 6 security source of truth is SQL and profile identity/permissions
    are SQL-backed.
- Acceptance должна подтвердить, что messaging/profile не вернули JSON
  `users`/`accessLevels` authority и используют Stage 6 SQL security state for
  identity/privacy checks.
```

## Промт

```text
Нужно выполнить Stage 10 Batch 5: приемку Messaging, Profile and Notifications
SQL Cutover.

Проверь exit criteria:
- messaging/profile/notifications source of truth is SQL;
- `/api/chat/*` is the only active messaging write stack;
- `/api/messages/*` does not exist as parallel stack;
- snapshot chat/profile/push fields are removed or read-only archived with
  removal criteria;
- delivered/read/unread behavior preserved;
- profile privacy preserved;
- no-system-user dialog rule preserved;
- WebPush/FCM tokens are user-owned in SQL;
- user_actions is the single profile/audit-owned action model;
- deeplink `openChatWith` / `conversationId` preserved;
- realtime is only signal and not correctness source.

Проверь failure conditions:
- two equal messaging stacks exist;
- `/api/chat/*` or push/FCM runtime reads authoritative state from JSON
  snapshot;
- user can open another user's profile or actions;
- push tokens are not user-owned;
- profile/messaging uses legacy snapshot `users`/`accessLevels` as
  authoritative identity source after Stage 6;
- `POST /api/data` can overwrite SQL-owned Stage 10 slices;
- client messaging/profile/notification flow writes through `saveData()`;
- non-empty legacy `messages` is silently accepted without owner/archive
  decision.

Обязательные проверки:
- `npm run test:sql`;
- focused E2E for:
  - own profile;
  - foreign profile rejected;
  - direct chat send;
  - delivered/read/unread;
  - deeplink direct URL and F5;
  - no-system-user dialog rule;
  - optimistic send rollback/retry;
  - WebPush subscribe/unsubscribe/test;
  - FCM token subscribe;
  - snapshot overwrite protection for Stage 10 slices;
  - no `/api/messages/*` parallel write stack;
  - SQL reconciliation for messages/profile.
- source scan proving:
  - `/api/chat/*`, `/api/user-actions`, WebPush and FCM handlers use Stage 10
    SQL repository;
  - no runtime authoritative read from `database.json` chat/profile/push
    arrays remains;
  - profile identity/privacy checks use Stage 6 SQL security state.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 10 PASS/FAIL/BLOCKED.
2. Messaging source proof.
3. Profile/privacy proof.
4. Push/FCM proof.
5. User actions/audit boundary proof.
6. Stage 6 security dependency proof.
7. Compatibility/removal proof.
8. Tests/checks run.
9. Можно ли начинать Stage 11.
```

## Ручная проверка после Prompt

Проверить own profile, chat, deeplink and push controls.
