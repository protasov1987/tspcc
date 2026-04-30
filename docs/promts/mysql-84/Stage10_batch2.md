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
- Можно менять только messaging/profile/notifications SQL scope.
- Нельзя создавать second messaging API.
- Начинать implementation можно только если Stage 6 security source of truth is
  SQL and profile identity/permissions are SQL-backed.
- Messaging/profile не должен читать authoritative users/accessLevels из
  legacy snapshot fallback.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 10 Batch 2: перевести messaging/profile/notifications на
SQL source of truth.

Что сделать:
1. Implement messaging/profile repository.
2. Make `/api/chat/*` SQL-backed primary stack.
3. Preserve conversations/messages/participants/read states.
4. Make `user_actions` single owner model in profile/audit boundary.
5. Store webpush subscriptions and FCM tokens in SQL with user ownership.
6. Preserve profile privacy and no-system-user dialog rule.
   Profile/user ownership checks должны использовать SQL-backed security state
   from Stage 6.
7. Preserve optimistic send rollback.
8. Remove/archive snapshot chat compatibility as read-only with removal criteria.

Что нельзя делать:
- не re-add `/api/messages/*` as active stack;
- не expose other user's profile;
- не store push tokens without owner.

Проверки:
- own profile/open other profile rejected;
- chat send/read/delivered;
- deeplink;
- webpush/FCM;
- no `/api/messages/*` parallel write stack;
- reconciliation for messages/profile.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. SQL messaging/profile implemented.
2. User actions ownership.
3. Push/FCM storage.
4. Tests/checks run.
5. Remaining compatibility.
```

## Ручная проверка после Prompt

Проверить profile, chat send/read, deeplink and push controls if available.
