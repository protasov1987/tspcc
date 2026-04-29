# Stage 11 Batch 5

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
закрепить WebPush и FCM notification paths поверх primary chat/profile semantics.

Контекст аудита Stage 11 Batch 1:
- WebPush UI находится в `/profile/:id`.
- WebPush client использует:
  - `GET /api/push/vapidPublicKey`
  - `POST /api/push/subscribe`
  - `POST /api/push/unsubscribe`
  - `POST /api/push/test`
- Service worker открывает `payload.url`.
- Сервер при chat send отправляет WebPush URL:
  `/profile/<peerId>?openChatWith=<senderId>&conversationId=<conversationId>`.
- FCM token registration есть на сервере: `POST /api/fcm/subscribe`.
- Android chat client регистрирует FCM token и открывает `ChatActivity` по
  `peerId` / `conversationId`.
- Потенциальный gap: `/api/push/test` принимает `targetUserId` из body и должен
  не ослаблять profile privacy / user-owned subscription semantics.

Цель:
- сохранить subscribe/unsubscribe/test для WebPush
- сохранить FCM token registration и delivery
- убедиться, что notification deep links ведут в working profile chat path из Batch 2
- не допустить notification side effects вне единого messaging/profile stack
- не начинать Stage 12 realtime normalization

Что нужно сделать:
1. Проверить paths:
   - `js/app.96.webpush.js`
   - `sw.js`
   - `server.js`
   - `android-chat/**`
   - `ecosystem.config.js`, только как source текущей FCM конфигурации
2. Убедиться, что WebPush subscriptions:
   - сохраняются только для authenticated current user
   - удаляются только для authenticated current user
   - не позволяют подписать/отписать чужого пользователя
3. Убедиться, что `/api/push/test`:
   - не позволяет обычному пользователю отправлять test push чужому `targetUserId`
     без явного правила доступа
   - не раскрывает чужой profile/chat context
   - генерирует URL, совместимый с Batch 2 deeplink behavior
4. Убедиться, что chat message notification:
   - использует primary `chatMessages/chatConversations`
   - содержит корректные `peerId` и `conversationId`
   - не зависит от legacy `/api/messages/*`
5. Убедиться, что FCM:
   - token сохраняется за authenticated current user
   - delivery payload содержит `conversationId`, `peerId`, `userName`
   - Android клиент открывает тот же conversation context
6. Если документация Android README утверждает, что endpoint отсутствует, а
   endpoint уже есть, зафиксировать это как docs gap. Исправлять docs можно
   только если это не смешивает implementation scope; docs-only change не требует bump.
7. Добавить или обновить focused tests для server-side privacy/contract:
   - subscribe current user
   - unsubscribe current user
   - test push чужому target rejected или clearly governed
   - notification URL содержит profile deeplink params
   - FCM subscribe current user

Для flow зафиксировать в ответе:
- open path: profile notification controls / service worker notification click / Android notification
- confirm / submit path: subscribe / unsubscribe / test / FCM register
- local invalid-state / no-request path: unsupported browser, denied permission, no token, no target profile
- server-side rejected-command path: unauthorized, CSRF, invalid subscription/token, forbidden target
- routes: profile detail / deeplink
- можно ли доказать route-safe refresh notification deeplink после F5

Что нельзя делать:
- не менять product-смысл уведомлений
- не ломать существующие подписки
- не делать notifications зависимыми от legacy `/api/messages/*`
- не начинать Stage 12 realtime normalization
- не трогать unrelated production/card notification logic за пределами messaging/profile consistency

После изменений обязательно проверить:
- WebPush subscribe/unsubscribe/test сохраняют ownership
- FCM registration сохраняет ownership
- notification deeplink открывает профильный chat context
- чужой profile/chat не раскрывается

Формат ответа:
1. Какие WebPush / FCM paths проверил или изменил.
2. Что именно сохранил из notification behavior.
3. Какие автоматические проверки выполнил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Закреплены WebPush и FCM уведомления для профильного чата"

После bump проверь:
- новая запись появилась в docs/version-log.html
- создана локальная backup-ветка с версией/датой/временем из version log
- в backup-ветке есть локальный commit
- push в GitHub не выполнялся
```

## Ручная проверка после Prompt

Желательна, если среда поддерживает WebPush/FCM.

### Чек-лист для чайника

1. Открой свой профиль.
2. Включи WebPush, если браузер разрешает.
3. Нажми тестовое уведомление, если кнопка доступна.
4. Проверь:
   - экран не сломался
   - уведомление ведет в твой профиль
   - чужой профиль не открывается
5. Отключи WebPush.
6. Обнови страницу через `F5` и проверь, что состояние выглядит корректно.
7. Если используется Android/FCM, проверь входящее уведомление и открытие нужного чата.
