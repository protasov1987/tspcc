# Stage 1 Batch 1 - done

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
- Это Stage 1: Stabilize Routing, Bootstrap and Auth For Entire In-Scope Perimeter.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче переводить домены на новые write API.
- Нельзя переписывать realtime.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняется bootstrap order — обязательно обнови docs/architecture/spa-boot.md.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 1 из docs/architecture/migration-plan.md:
`Stage 1. Stabilize Routing, Bootstrap and Auth For Entire In-Scope Perimeter`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все реальные нарушения или риски Stage 1 по коду.
2. Подтвердить, что уже соответствует требованиям.
3. Составить точную карту:
   - central router
   - bootstrap pipeline
   - auth/session restore sequence
   - popstate flow
   - forced redirects on boot
   - navigation setup and idempotency
   - protected route rendering timing
   - route diagnostics
4. Проверить весь in-scope perimeter, кроме receipts.

Что нужно проверить обязательно:
- js/app.00.state.js
- js/app.50.auth.js
- js/app.81.navigation.js
- js/app.99.init.js
- js/app.40.store.js
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js
- docs/architecture/spa-boot.md

In-scope маршруты для проверки:
- /dashboard
- /cards
- /cards/new
- /cards/:id
- /card-route/:qr
- /approvals
- /provision
- /input-control
- /departments
- /operations
- /areas
- /employees
- /shift-times
- /users
- /accessLevels
- /profile/:id
- /production/schedule
- /production/plan
- /production/shifts
- /production/shifts/:key
- /production/gantt/:...
- /workspace
- /workspace/:qr
- /production/delayed
- /production/delayed/:qr
- /production/defects
- /production/defects/:qr
- /workorders
- /workorders/:qr
- /archive
- /archive/:qr
- /items
- /ok
- /oc

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Что уже соответствует Stage 1.
2. Список точных нарушений/рисков Stage 1 с файлами и функциями.
3. Какой batch нужно делать первым.
4. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
5. Если ручная проверка нужна — дай короткий чек-лист для обычного пользователя.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если нужна быстрая перестраховка:

1. Открой сайт.
2. Перейди на `/cards`.
3. Нажми `F5`.
4. Перейди на `/production/plan`.
5. Нажми кнопки браузера `Назад` и `Вперёд`.
6. Убедись, что экран не прыгает сам на `/dashboard`.
