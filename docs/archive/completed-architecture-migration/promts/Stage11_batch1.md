# Stage 11 Batch 1

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
Нужно выполнить точный технический аудит Stage 11 из docs/architecture/migration-plan.md:
`Stage 11. Migrate Messaging, Profile and Notifications`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path messaging/profile/notifications.
2. Разделить scope Stage 11 по зонам:
   - `/profile/:id`
   - direct chat
   - delivered / read / unread
   - user actions
   - webpush
   - FCM
   - chat deeplinks
3. Отделить Stage 11 от соседних этапов:
   - Stage 10 derived views
   - Stage 12 realtime normalization
   - Stage 13 final cleanup
4. Найти, где messaging сейчас зависит от:
   - одновременно живущих `/api/chat/*` и `/api/messages/*`
   - обходных write-path
   - profile privacy gaps
   - notification side effects вне единого stack
5. Составить точную карту разрывов между current-state и Stage 11.

Дополнительно, с учетом практического опыта Stage 4, для каждого in-scope UI flow, где есть action, modal, dialog, side panel, deeplink или detail-route confirm path, отдельно зафиксировать:
- open path
- confirm / submit path
- local invalid-state / no-request path
- server-side conflict / rejected-command path
- какие routes участвуют: list / detail / deeplink
- можно ли доказать route-safe refresh реальным two-tab / multi-client сценарием, а не только искусственным `409` через interceptor или mock

Если для какого-то subdomain таких open/confirm flows нет, это тоже нужно явно написать, а не оставлять неявным допущением.

Что нужно проверить обязательно:
- js/app.50.auth.js
- js/app.81.navigation.js
- js/app.40.store.js
- server.js
- db.js
- docs/business-rules/messaging-profile-and-notifications.md
- docs/business-rules/auth-and-navigation.md
- docs/business-rules/directories-and-security.md
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где работает `/api/chat/*`.
2. Где еще живет `/api/messages/*`.
3. Где открывается direct chat.
4. Где работают delivered / read / unread.
5. Где работают user actions.
6. Где включаются webpush и FCM.
7. Где используются deeplink `openChatWith` / `conversationId`.
8. Где enforced profile privacy и нет ли system-user dialog regression.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current messaging/profile/notifications read/write paths.
2. Что уже соответствует Stage 11.
3. Где одновременно живут два message stacks.
4. Где граница между Stage 11 и Stage 12/13.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой свой профиль.
2. Открой чат, если он доступен.
3. Убедись, что после аудита ничего само не поменялось.
