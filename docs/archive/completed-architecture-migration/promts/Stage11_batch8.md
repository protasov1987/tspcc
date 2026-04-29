# Stage 11 Batch 8

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
добить unified messaging proof hardening и E2E coverage.

Цель:
- доказать Stage 11 не только статическим аудитом, но и route-safe сценариями
- покрыть real F5/direct-login/two-tab/multi-client cases там, где это возможно
- не начинать Stage 12 realtime normalization

Что нужно сделать:
1. Провести audit после Batch 7:
   - direct chat
   - deeplink `openChatWith` / `conversationId`
   - delivered / read / unread
   - user actions
   - WebPush / FCM
   - `/profile/:id`
   - `/api/messages/*` boundary
2. Добавить или расширить focused E2E/API coverage:
   - F5 на `/profile/:id`
   - F5 на `/profile/:id?openChatWith=...&conversationId=...`
   - direct protected URL через login на profile deeplink
   - foreign profile access remains forbidden
   - direct chat send success
   - send rejected path does not leave permanent fake message
   - delivered/read REST path works without relying on SSE
   - unread changes are observable after route refresh
   - WebPush test/subscribe contract privacy, если можно проверить без реального браузерного push
   - FCM subscribe contract, если можно проверить API-level
3. Для two-tab / multi-client proof:
   - использовать реальный второй browser context или вторую страницу, если это
     уже поддерживается test helpers
   - не подменять весь proof искусственным `409`/mock/interceptor
   - если реальный сценарий невозможен в текущей среде, явно написать почему и
     какой minimal manual check остается
4. Проверить final stack boundary:
   - `/api/chat/*` primary
   - `/api/messages/*` отсутствует или adapter-only
   - no legacy `messages` writable source of truth
5. Если найдены blockers, внести минимальные исправления в Stage 11 perimeter.
   Если исправление требует Stage 12/13, не делать его, а зафиксировать blocker.

Для каждого in-scope UI/API flow в ответе дать proof:
- open path
- confirm / submit path
- local invalid-state / no-request path
- server-side rejected-command path
- routes: profile detail / deeplink / API-only
- доказательство route-safe refresh: F5/direct-login/two-tab/multi-client или почему не применимо

Что нельзя делать:
- не переписывать SSE/fallback как Stage 12
- не делать global `/api/data` cleanup как Stage 13
- не ослаблять privacy ради тестов
- не оставлять два равноправных message stacks
- не трогать receipts

Формат ответа:
1. Какой final unified messaging proof получен.
2. Что осталось от `/api/messages/*` и какой removal path, если он нужен.
3. Таблица proof coverage по flows.
4. Какие автоматические проверки выполнил.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остаточные риски и почему они не блокируют или блокируют Stage 11.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлено подтверждение Stage 11 для профильного чата и уведомлений"

После bump проверь:
- новая запись появилась в docs/version-log.html
- создана локальная backup-ветка с версией/датой/временем из version log
- в backup-ветке есть локальный commit
- push в GitHub не выполнялся
```

## Ручная проверка после Prompt

Обязательна.

1. Открой свой профиль.
2. Открой direct chat и отправь тестовое сообщение, если это безопасно.
3. Открой тот же профиль/чат во второй вкладке.
4. Проверь deeplink `openChatWith` / `conversationId`, если он доступен.
5. Обнови профиль и deeplink через `F5`.
6. Проверь notifications subscribe/unsubscribe/test, если они доступны.
7. Убедись, что системному пользователю нельзя написать.
8. Убедись, что чужой профиль не раскрывается.
