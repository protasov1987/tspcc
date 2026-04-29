# Stage 11 Batch 6

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
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 12 и дальше:
  - не делать realtime normalization
  - не делать final legacy cleanup за пределами messaging/profile
  - не делать perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-10 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для messaging/profile consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 11:
закрепить profile user actions log и system notification side effects в Stage 11 perimeter.

Контекст аудита Stage 11 Batch 1:
- User actions log является частью профиля, но это не chat conversation.
- Read path: `GET /api/user-actions?userId=currentUser.id&limit=200`.
- Server-side privacy: чужой `userId` в `/api/user-actions` должен возвращать 403.
- Write paths:
  - login/logout через `appendUserAction`
  - часть business actions через legacy `/api/data` snapshot side effect
    `collectBusinessUserActions`
- System messages создаются через `appendSystemMessage` и пишут в
  `chatConversations/chatMessages`, а не в legacy `messages`.
- Stage 13 global `/api/data` cleanup не входит в Stage 11, но Stage 11 не должен
  усиливать обходные write-path для profile/messaging.

Цель:
- сохранить user actions log как private profile context
- не пытаться превращать user actions в chat messages
- убрать или явно ограничить Stage 11-specific обходные write-path, если они
  создают notification/profile side effects вне единого stack
- сохранить system-message behavior в primary chat stack
- не начинать Stage 13 global snapshot cleanup

Что нужно сделать:
1. Проверить paths:
   - `js/app.95.messenger.js`
   - `server.js`
   - `db.js`
   - `js/app.40.store.js`, только чтобы понять legacy snapshot boundary
2. Убедиться, что `/api/user-actions`:
   - требует auth
   - разрешает читать только current user's actions
   - не раскрывает чужой profile context
   - корректно работает после F5 на `/profile/:id`
3. Убедиться, что user action writes:
   - не создают chat/message divergence
   - не пишут в legacy `messages`
   - не требуют Stage 13 removal of `/api/data`
4. Проверить system notification side effects:
   - `appendSystemMessage`
   - transfer/status-change notifications
   - WebPush/FCM payload для system messages
   - no system-user dialog regression: system thread read-only, send запрещен
5. Если найден Stage 11-specific bypass, внести минимальное исправление.
   Не удалять все `/api/data` writes проекта.
6. Добавить или обновить focused tests:
   - own user actions visible in profile
   - foreign user actions rejected
   - login/logout action сохраняется
   - system message попадает в primary `chatMessages`
   - system thread remains read-only

Для flow зафиксировать в ответе:
- open path: profile user actions log / system thread
- confirm / submit path: отсутствует для user actions read-only; есть только server-side writes from auth/business actions
- local invalid-state / no-request path: no currentUser / no profile owner / missing DOM
- server-side rejected-command path: unauthorized / foreign userId / system send rejected
- routes: profile detail / deeplink, если system notification ведет в профиль
- можно ли доказать route-safe refresh через F5 на профиле

Что нельзя делать:
- не превращать user actions в chat messages
- не ослаблять `/profile/:id` privacy
- не разрешать писать system user
- не делать Stage 13 cleanup `/api/data` как отдельную цель
- не начинать Stage 12 realtime normalization

После изменений обязательно проверить:
- user actions log работает в собственном профиле
- чужие actions не раскрываются
- system messages живут в primary chat stack
- system thread остается read-only

Формат ответа:
1. Какие user actions / system notification paths проверил или изменил.
2. Что именно сохранил из profile/privacy behavior.
3. Какие автоматические проверки выполнил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Закреплен лог действий и системные сообщения в профиле"

После bump проверь:
- новая запись появилась в docs/version-log.html
- создана локальная backup-ветка с версией/датой/временем из version log
- в backup-ветке есть локальный commit
- push в GitHub не выполнялся
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой свой профиль.
2. Проверь блок “Лог действий”.
3. Обнови страницу через `F5`.
4. Проверь, что лог действий не пропал.
5. Открой системный диалог, если он есть.
6. Проверь:
   - системные сообщения читаются
   - поле отправки системе недоступно
7. Если есть ID другого пользователя, попробуй открыть чужой профиль:
   - чужой лог действий не должен раскрыться.
