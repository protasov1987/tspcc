# MySQL 8.4 Stage 10 Batch 1

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
- Batch 1 является audit/design.
- Нельзя менять code.
- Нельзя создавать `/api/messages/*` parallel stack.
- Начинать Stage 10 audit/design можно только после Stage 9 Batch 5 PASS.
- Stage 10 additionally depends on Stage 6 acceptance:
  users/access levels/profile identity dependencies должны быть SQL-owned.
- Если Stage 6 не PASS, зафиксируй blocker для profile/messaging cutover
  вместо fallback к JSON `users`/`accessLevels`.
- Если Stage 9 не PASS, зафиксируй blocker для global MySQL stage order вместо
  начала messaging/profile implementation.
```

## Промт

```text
Нужно выполнить Stage 10 Batch 1: audit/design messaging/profile/notifications
SQL cutover.

Проверь:
1. `/api/chat/*` current write stack.
2. conversations/messages/read states.
3. profile privacy.
4. user identity/profile dependency on Stage 6 SQL security state.
5. user actions owner and audit boundary.
6. webpush/FCM token storage.
7. deeplinks `openChatWith` / `conversationId`.
8. snapshot compatibility fields.
9. required tests.

Что нельзя делать:
- не менять code/docs;
- не reintroduce `/api/messages/*`;
- не change profile privacy semantics.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Messaging SQL cutover map.
2. Profile/user_actions ownership plan.
3. Push/FCM storage plan.
4. Risks/blockers.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
