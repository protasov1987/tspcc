# Stage 11 Batch 9

## Общий префикс для каждого промта

```text
Работай строго по:
- AGENTS.md
- docs/architecture/target-architecture.md
- docs/architecture/migration-plan.md
- docs/architecture/current-state.md
- docs/architecture/change-checklist.md
- docs/business-rules/auth-and-navigation.md
- docs/business-rules/cards-and-approval.md
- docs/business-rules/directories-and-security.md
- docs/business-rules/production-and-workspace.md
- docs/business-rules/workorders-archive-and-items.md
- docs/business-rules/messaging-profile-and-notifications.md

Важно:
- Это Stage 11: Migrate Messaging, Profile and Notifications.
- Это финальная приемка Stage 11, а не implementation batch.
- Нельзя менять файлы приложения.
- Нельзя менять docs.
- Нельзя делать version bump.
- Нельзя начинать Stage 12.
- Если найдены blockers — перечисли их и предложи отдельный следующий implementation batch.
```

## Промт

```text
Нужно выполнить финальную проверку Stage 11 end-to-end после Batch 8.

Цель:
- подтвердить, что Stage 11 полностью соответствует target architecture для
  messaging/profile/notifications
- убедиться, что unified messaging proof не оставил hidden overlap
- ничего не исправлять в этом batch

Что нужно сделать:
1. Повторить финальный audit against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/current-state.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/messaging-profile-and-notifications.md
   - docs/business-rules/auth-and-navigation.md
   - docs/business-rules/directories-and-security.md
2. Проверить весь Stage 11 scope:
   - `/profile/:id`
   - direct chat
   - delivered / read / unread
   - user actions
   - WebPush
   - FCM
   - chat deeplinks
3. Подтвердить final stack boundary:
   - `/api/chat/*` primary
   - `/api/messages/*` отсутствует или является adapter-only с explicit removal path
   - legacy `messages` не является writable source of truth
   - нет третьего message API
4. Подтвердить business invariants:
   - profile privacy preserved
   - no system-user dialog regression
   - delivered/read semantics preserved
   - unread semantics preserved
   - deeplink via `openChatWith` / `conversationId` preserved
   - notification subscriptions/tokens remain user-owned
   - user actions log remains private profile context
5. Подтвердить, что Stage 12 functionality не смешана в Stage 11:
   - realtime normalization не делалась как отдельная цель
   - correctness не требует live-only behavior
6. Подтвердить, что Stage 13 functionality не смешана в Stage 11:
   - global `/api/data` cleanup не выполнялся
   - cleanup ограничен messaging/profile overlap
7. Если Stage 11 еще не закрыт:
   - не вносить исправления
   - перечислить blockers
   - предложить отдельный следующий implementation batch

Формат ответа:
1. Выполнен ли Stage 11 полностью или нет.
2. Финальная таблица messaging/profile/notification paths:
   - read path
   - write path
   - data model
   - route involvement
   - rejection/conflict behavior
3. Результат проверки отсутствия двух равноправных message stacks.
4. Таблица final proof:
   - open path
   - confirm / submit path
   - local invalid-state / no-request path
   - server-side rejected-command path
   - route-safe refresh proof
5. Какие тесты/сценарии проверил автоматически.
6. Что нужно проверить вручную — отдельным чек-листом для обычного пользователя.
7. Если Stage 11 не закрыт: blockers и минимальный следующий implementation batch.
8. Какие остаточные риски остались.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 11.

### Stage 11 считается принят вручную, если:

- свой профиль открывается
- чужой профиль не раскрывается
- direct chat работает
- отправка сообщения работает, если тестовая отправка безопасна
- delivered/read/unread не сломаны
- user actions log в профиле работает
- deeplinks в чат через `openChatWith` / `conversationId` сохранены
- notifications сохраняются и ведут в правильный профильный chat context
- `/api/chat/*` является основным stack
- `/api/messages/*` отсутствует или явно adapter-only
- системному пользователю нельзя написать
- Stage 12 не был затронут без отдельной задачи
