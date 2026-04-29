# Stage 7 Batch 1

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
- Это Stage 7: Complete Security Domain.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 8 и дальше:
  - не делать production migration
  - не делать messaging migration
  - не делать realtime migration
- Нельзя заново переписывать Stage 1-6 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для security-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 7 из docs/architecture/migration-plan.md:
`Stage 7. Complete Security Domain`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path security-domain.
2. Разделить scope Stage 7 по зонам:
   - users
   - access levels
   - permission semantics
   - landing tab
   - inactivity timeout
   - profile access rules
3. Отделить Stage 7 от соседних этапов:
   - Stage 6 directories
   - Stage 8 production
   - messaging / profile chat behavior, который нельзя ломать
4. Найти, где security сейчас зависит от:
   - saveData()
   - /api/data
   - global arrays
   - обходных client-side write-path
   - login/bootstrap side effects
5. Составить точную карту разрывов между current-state и Stage 7.

Дополнительно, с учетом практического опыта Stage 4, для каждого in-scope UI flow, где есть action, modal, dialog, side panel, deeplink или detail-route confirm path, отдельно зафиксировать:
- open path
- confirm / submit path
- local invalid-state / no-request path
- server-side conflict / rejected-command path
- какие routes участвуют: list / detail / deeplink
- можно ли доказать route-safe refresh реальным two-tab / multi-client сценарием, а не только искусственным `409` через interceptor или mock

Если для какого-то subdomain таких open/confirm flows нет, это тоже нужно явно написать, а не оставлять неявным допущением.

Что нужно проверить обязательно:
- js/app.00.state.js
- js/app.50.auth.js
- js/app.81.navigation.js
- js/app.40.store.js
- server.js
- db.js
- docs/business-rules/directories-and-security.md
- docs/business-rules/auth-and-navigation.md
- docs/business-rules/messaging-profile-and-notifications.md
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где редактируются users.
2. Где редактируются access levels.
3. Где меняются permission semantics.
4. Где хранятся и сохраняются `landingTab` и `inactivityTimeoutMinutes`.
5. Где enforced `/profile/:id` ownership / privacy rules.
6. Где работает `Abyss` protection.
7. Где проверяется password validation / uniqueness.
8. Какие security UI еще используют bypass write-path.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current security read/write paths.
2. Что уже соответствует Stage 7.
3. Где security writes еще зависят от `/api/data`.
4. Где граница между Stage 7 и Stage 8.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой экран пользователей или уровней доступа.
2. Открой свой профиль.
3. Убедись, что после аудита ничего само не поменялось.
