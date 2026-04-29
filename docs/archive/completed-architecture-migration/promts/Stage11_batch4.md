# Stage 11 Batch 4

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
доказать и добить delivered / read / unread semantics в primary `/api/chat/*` stack.

Контекст аудита Stage 11 Batch 1:
- Delivered/read уже работают через:
  - client `markConversationDelivered`
  - client `markConversationRead`
  - server `POST /api/chat/conversations/:id/delivered`
  - server `POST /api/chat/conversations/:id/read`
  - data model `chatStates`
- Unread для modern stack считается в `GET /api/chat/users`.
- Legacy `/api/messages/mark-read` был частью второго stack и должен быть
  удален или adapter-only после Batch 3.
- Stage 12 realtime normalization не входит в эту задачу.

Цель:
- сохранить delivered/read/unread semantics после удаления равноправия
  `/api/messages/*`
- доказать correctness без зависимости от realtime
- сохранить route-safe behavior для profile/detail/deeplink routes

Что нужно сделать:
1. Проверить текущие read/write paths:
   - `js/app.95.messenger.js`
   - `server.js`
   - `db.js`
   - Android chat client, если он использует delivered/read
2. Убедиться, что delivered/read writes:
   - проверяют auth/CSRF
   - проверяют participant access
   - clamp'ят seq до max conversation seq
   - не уменьшают уже достигнутые read/delivered значения
   - не позволяют foreign conversation update
3. Убедиться, что unread:
   - считается из `chatMessages + chatStates`
   - не зависит от legacy `messages`
   - корректно обновляется после F5/direct route refresh
4. Если найдены gaps, внести минимальные исправления только в messaging/profile perimeter.
5. Добавить или обновить focused tests:
   - delivered update success
   - read update success
   - foreign conversation rejected
   - unread reset after opening conversation
   - F5 на `/profile/:id` и deeplink не теряет state
6. Не переписывать SSE/fallback как Stage 12 normalization. Разрешены только
   точечные проверки, что REST path самодостаточен.

Для flow зафиксировать в ответе:
- open path
- confirm / submit path: auto POST delivered/read
- local invalid-state / no-request path: no active conversation / no seq / system read-only
- server-side rejected-command path: unauthorized / CSRF / no participant access
- routes: profile detail / deeplink
- доказан ли route-safe refresh без realtime

Что нельзя делать:
- не вводить вторую message-state модель
- не возвращать dependency на legacy `messages.readAt`
- не менять business meaning delivered/read/unread
- не ломать direct chat и deeplink из Batch 2
- не начинать Stage 12 realtime normalization

После изменений обязательно проверить:
- delivered/read/unread идут через primary `/api/chat/*`
- unread badge не считается из legacy `messages`
- foreign conversation state нельзя обновить
- F5 на profile/deeplink не теряет корректный state

Формат ответа:
1. Какие delivered/read/unread paths проверил или изменил.
2. Что именно сохранил из messaging semantics.
3. Какие автоматические проверки выполнил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Закреплены статусы delivered/read/unread в едином chat stack"

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
2. Открой диалог.
3. Отправь тестовое сообщение, если это безопасно.
4. Открой этот диалог во второй вкладке или попроси второго пользователя открыть его.
5. Проверь:
   - сообщение отображается
   - индикатор доставки/прочтения ведет себя как раньше
   - счетчик непрочитанных уменьшается после открытия диалога
6. Обнови страницу через `F5`.
7. Проверь, что состояние не потерялось.
