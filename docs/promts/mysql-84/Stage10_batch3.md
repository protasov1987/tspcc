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
- Это финальная acceptance-проверка MySQL Stage 10.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 11.
- Acceptance можно выполнять только после Stage 9 Batch 5 PASS и Stage 10
  Batch 2 PASS.
- Acceptance должна подтвердить, что messaging/profile не вернули JSON
  `users`/`accessLevels` authority и используют Stage 6 SQL security state for
  identity/privacy checks.
```

## Промт

```text
Нужно выполнить Stage 10 Batch 3: приемку Messaging, Profile and Notifications
SQL Cutover.

Проверь exit criteria:
- messaging/profile/notifications source of truth is SQL;
- snapshot chat fields are removed or read-only archived with removal criteria;
- delivered/read/unread behavior preserved.

Проверь failure conditions:
- two equal messaging stacks do not exist;
- user cannot open another user's profile;
- push tokens are user-owned.
- profile/messaging uses legacy snapshot users/accessLevels as authoritative
  identity source after Stage 6.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 10 PASS/FAIL/BLOCKED.
2. Messaging source proof.
3. Profile/privacy proof.
4. Push/FCM proof.
5. Stage 6 security dependency proof.
6. Можно ли начинать Stage 11.
```

## Ручная проверка после Prompt

Проверить own profile, chat, deeplink and push controls.
