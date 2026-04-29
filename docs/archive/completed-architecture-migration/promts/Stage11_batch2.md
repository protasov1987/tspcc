# Stage 11 Batch 2

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
починить и доказать chat deeplink entry в профиле.

Контекст аудита Stage 11 Batch 1:
- сервер уже генерирует URL вида:
  `/profile/<peerId>?openChatWith=<senderId>&conversationId=<conversationId>`
  при отправке chat notification.
- В клиентском коде найдено много использования `conversationId`, но не найдено
  чтение query params `openChatWith` / `conversationId` для открытия нужного
  диалога в профиле.
- Web UI уже использует primary `/api/chat/*` path для direct chat.
- `/profile/:id` приватен: пользователь может открыть только собственный профиль.
- Диалог с system user нельзя инициировать или отправлять в него сообщения.

Цель:
- сделать deeplink `openChatWith` / `conversationId` реально рабочим entry path
  в `/profile/:id`
- сохранить profile privacy
- сохранить no system-user dialog regression
- не трогать `/api/messages/*` cleanup в этом batch
- не начинать Stage 12 realtime normalization

Что нужно сделать:
1. Проверить текущий profile route flow:
   - `js/app.00.state.js`
   - `js/app.50.auth.js`
   - `js/app.81.navigation.js`
   - `js/app.95.messenger.js`
   - `js/app.96.webpush.js`
   - `sw.js`
   - `server.js`
2. Реализовать минимальный client-side обработчик deeplink params:
   - `openChatWith`
   - `conversationId`
   внутри уже существующего profile / messenger flow.
3. Deeplink должен:
   - работать после прямого захода по URL
   - работать после F5
   - работать после login с direct protected URL
   - открывать именно нужного собеседника / conversation context
   - не обходить центральный router
4. Если `conversationId` не принадлежит текущему пользователю или не совпадает
   с `openChatWith`, серверный reject должен обрабатываться понятным UI state,
   без permanent fake message и без редиректа на dashboard.
5. Если `openChatWith=system` или peer является системным пользователем:
   - открыть системный read-only thread можно только если это уже существующий
     system conversation, если текущая логика это поддерживает
   - инициировать или отправлять сообщение системе по-прежнему нельзя.
6. Добавить или обновить focused tests:
   - direct `/profile/<ownId>?openChatWith=<peerId>&conversationId=<conversationId>`
   - F5 на этом deeplink
   - foreign `/profile/<foreignId>?openChatWith=...` не раскрывает профиль
   - system-user no-send regression
7. Не переносить сюда delivered/read/unread, webpush/FCM и legacy `/api/messages/*`
   больше, чем строго нужно для deeplink.

Для in-scope UI flow зафиксировать в ответе:
- open path
- confirm / submit path, если он есть
- local invalid-state / no-request path
- server-side rejected-command path
- какие routes участвуют: profile detail / deeplink
- можно ли доказать route-safe refresh реальным F5/direct-login сценарием

Что нельзя делать:
- не менять `window.location` напрямую для SPA-навигации
- не вызывать render до завершения `restoreSession()`
- не добавлять новый parallel message client
- не создавать третий message API
- не удалять `/api/messages/*` в этом batch
- не начинать Stage 12 realtime normalization

После изменений обязательно проверить:
- deeplink из notification URL открывает нужный диалог
- F5 на deeplink сохраняет профиль и диалог
- чужой профиль остается закрытым
- system user не становится writable
- `/api/chat/*` остается primary path

Формат ответа:
1. Какие deeplink/profile paths изменил.
2. Как preserved profile privacy и no system-user dialog rule.
3. Какие автоматические проверки выполнил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Восстановлено открытие чата по deeplink из профиля"

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
2. Открой чат с доступным пользователем.
3. Если есть ссылка вида `/profile/ТВОЙ_ID?openChatWith=ID&conversationId=ID`:
   - открой ее напрямую
   - обнови страницу через `F5`
4. Проверь:
   - профиль не перекинуло на dashboard
   - открылся нужный диалог
   - поле отправки доступно только для обычного пользователя
   - системному пользователю написать нельзя
5. Попробуй чужой `/profile/ЧУЖОЙ_ID?...`, если это безопасно:
   - должен остаться запрет доступа к чужому профилю.
