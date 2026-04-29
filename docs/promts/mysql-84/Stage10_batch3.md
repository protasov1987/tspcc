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

Формат ответа:
1. Stage 10 PASS/FAIL/BLOCKED.
2. Messaging source proof.
3. Profile/privacy proof.
4. Push/FCM proof.
5. Можно ли начинать Stage 11.
```

## Ручная проверка после Prompt

Проверить own profile, chat, deeplink and push controls.
