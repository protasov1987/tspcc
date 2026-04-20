# Stage 1 Batch 5

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
Нужно реализовать только один batch Stage 1:
довести автоматическую проверку Stage 1 до полного in-scope покрытия маршрутов.

Цель:
- E2E должны подтверждать Stage 1 по реальному route perimeter, а не по частичному набору маршрутов
- обязательные deep routes должны быть покрыты direct URL / F5 / history checks
- helper expectations должны быть синхронизированы с реальным router/page contract
- не смешивать этот batch с Stage 2 и доменной миграцией

Что нужно сделать:
1. Проверить tests/e2e/00.auth-routes.spec.js, tests/e2e/01.pages-and-modals-smoke.spec.js и helpers.
2. Добавить недостающее Stage 1 покрытие минимум для:
   - `/cards/new`
   - `/cards/:id`
   - `/profile/:id`
   - `/workorders/:qr`
   - `/workspace/:qr`
   - `/archive/:qr`
   - `/production/shifts/:key`
   - `/production/gantt/:...`
   - `/production/delayed/:qr`
   - `/production/defects/:qr`
3. Исправить broken test contracts, если mismatch чисто тестовый.
4. Если mismatch выявляет неправильный route/page contract в приложении, сделать минимальную app-side правку и явно объяснить почему.
5. Прогнать обновленные проверки.

Что нужно проверить обязательно:
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js
- tests/e2e/helpers/navigation.js
- tests/e2e/helpers/auth.js
- tests/e2e/helpers/diagnostics.js

Что нельзя делать:
- не менять бизнес-логику страниц
- не превращать tests batch в общий UI refactor
- не чинить unrelated smoke beyond Stage 1 perimeter
- не трогать receipts как домен

Формат ответа:
1. Какие Stage 1 маршруты были не покрыты автоматически.
2. Какие проверки и helper contracts изменил.
3. Какие тесты прогнал и с каким результатом.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Если пришлось менять app code, почему это было необходимо.
6. Остались ли риски.

Важно по version bump:
- если изменены только tests/**, version bump не нужен
- если изменены файлы приложения, обязательно выполни:
  npm run version:bump -- --change "Расширено Stage 1 покрытие маршрутов и проверок"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Не обязательна, если менялись только тесты.

Если менялись файлы приложения, проверь вручную:

1. `/cards/new`
2. `/cards/ID_КАРТОЧКИ`
3. `/profile/ID_ТЕКУЩЕГО_ПОЛЬЗОВАТЕЛЯ`
4. `/workorders/QR`
5. `/production/shifts/ДДММГГГГsN`
6. `/production/gantt/...`
7. На каждом маршруте:
   - прямой вход работает
   - `F5` оставляет тот же экран
   - `Назад` / `Вперёд` не ломают маршрут

