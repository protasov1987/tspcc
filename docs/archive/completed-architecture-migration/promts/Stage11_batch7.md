# Stage 11 Batch 7

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
основной integration cutover check для messaging/profile/notifications после Batch 2-6.

Это НЕ финальная приемка Stage 11:
- Batch 8 должен отдельно добить proof hardening / E2E
- Batch 9 должен быть финальной проверкой без исправлений

Цель:
- подтвердить, что Stage 11 implementation paths согласованы между собой
- добрать только минимальные исправления по messaging/profile/notifications
- не начинать Stage 12 и Stage 13

Что нужно сделать:
1. Проверить весь Stage 11 scope against:
   - docs/architecture/migration-plan.md Stage 11
   - docs/architecture/current-state.md section Messaging/Profile/Notifications
   - docs/architecture/change-checklist.md section Messaging/Profile/Notifications
   - docs/business-rules/messaging-profile-and-notifications.md
   - docs/business-rules/auth-and-navigation.md
2. Подтвердить, что покрыты:
   - `/profile/:id`
   - direct chat
   - delivered / read / unread
   - user actions
   - WebPush
   - FCM
   - chat deeplinks
3. Подтвердить final stack boundary на уровне кода:
   - `/api/chat/*` primary
   - `/api/messages/*` отсутствует или adapter-only с explicit removal path
   - legacy `messages` не является writable source of truth
4. Проверить UI action/modal/dialog/side-panel/deeplink/detail-route paths:
   - chat user row open
   - send message
   - retry failed message
   - delivered/read auto submit
   - WebPush subscribe/unsubscribe/test
   - FCM token registration, если покрывается Android/API тестом
   - user actions log read
5. Для каждого flow явно подтвердить:
   - open path
   - confirm / submit path
   - local invalid-state / no-request path
   - server-side conflict / rejected-command path
   - routes: profile detail / deeplink
   - route-safe refresh через F5/direct login/two-tab, если применимо
6. Если Stage 11 еще не закрыт, внести только минимальные добивающие изменения.

Дополнительно, с учетом практического опыта Stage 4, Stage 11 нельзя считать
готовым к Batch 8, если:
- direct chat, deeplink или notification action доступны в разных UI-контекстах,
  но proof получен только для одного из них
- local invalid-state / no-request path просто молча возвращает без понятного
  состояния там, где пользователь ожидает результат
- server-side rejected-command оставляет permanent fake message или потерянный route
- route-safe refresh доказан только искусственным mock/interceptor, а не реальным
  F5/direct-login/two-tab сценарием там, где это применимо
- отсутствие open/confirm flow в каком-то subdomain не зафиксировано явно

Что нельзя делать:
- не переписывать realtime как Stage 12
- не удалять unrelated legacy snapshot writes как Stage 13
- не трогать receipts
- не делать perf hardening как самостоятельную цель
- не менять business meaning profile/chat/notifications

Критерий завершения Batch 7:
- Stage 11 implementation paths не конфликтуют
- основные known gaps из аудита закрыты или явно перенесены в Batch 8
- нет двух равноправных message stacks
- profile privacy и system-user guard сохранены
- Stage 12 не начат

Формат ответа:
1. Готов ли Stage 11 к proof hardening Batch 8.
2. Что именно еще пришлось добить.
3. Таблица flow coverage: open / submit / invalid-state / rejected-command / routes / refresh proof.
4. Какие автоматические проверки выполнил.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остаточные риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Согласованы основные пути Stage 11 messaging profile notifications"

После bump проверь:
- новая запись появилась в docs/version-log.html
- создана локальная backup-ветка с версией/датой/временем из version log
- в backup-ветке есть локальный commit
- push в GitHub не выполнялся
```

## Ручная проверка после Prompt

Обязательна. Это ручная проверка перед proof hardening.

### Чек-лист для чайника

1. Открой свой профиль.
2. Открой direct chat с доступным пользователем.
3. Отправь тестовое сообщение, если это безопасно.
4. Проверь deeplink `openChatWith` / `conversationId`, если есть ссылка.
5. Проверь:
   - delivered/read выглядит как раньше
   - лог действий в профиле виден
   - системному пользователю нельзя написать
6. Проверь WebPush subscribe/unsubscribe/test, если среда поддерживает.
7. Убедись, что профиль после `F5` не перекидывает на dashboard.
