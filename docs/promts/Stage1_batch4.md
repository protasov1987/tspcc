# Stage 1 Batch 4  - done

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
довести initNavigation/setupNavigation до полной идемпотентности.

Цель:
- повторный вызов initNavigation()/setupNavigation() не должен создавать duplicate listeners
- modal close/back handlers не должны вешаться повторно
- repeated bootstrap и repeated route init должны оставаться безопасными
- navigation layer должен оставаться единым, без обходных bind-path

Что нужно сделать:
1. Проверить initNavigation(), setupNavigation() и связанные setup-функции.
2. Найти реальные bindings без guard и повторные навешивания handlers.
3. Добавить guard-механику только там, где она реально нужна для Stage 1.
4. Сохранить текущее поведение:
   - меню
   - dropdown
   - tabs
   - modal close via history.back()

Что нужно проверить обязательно:
- js/app.81.navigation.js
- js/app.50.auth.js
- js/app.99.init.js
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нельзя делать:
- не переписывать весь navigation UI
- не делать общий modal refactor
- не менять router semantics beyond idempotency needs
- не трогать receipts как домен

После изменений обязательно проверить:
- повторные переходы между страницами
- повторный bootstrap / `F5`
- один клик по меню = одно действие
- close/open модалок без двойных срабатываний
- cards dropdown и card tabs продолжают работать

Формат ответа:
1. Где именно setup/bindings были неидемпотентны.
2. Что именно изменил.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Сделана полностью идемпотентной инициализация навигации"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Несколько раз подряд перейди:
   - `/cards`
   - `/dashboard`
   - `/cards`
   - `/production/plan`
3. Проверь, что по одному клику меню происходит ровно одно действие.
4. Открой карточку или другую модалку несколько раз подряд.
5. Закрытие должно происходить один раз, без двойного отката истории и без дерганий.
6. Нажми `F5` и повтори пару действий.
7. Если после нескольких повторов интерфейс начинает срабатывать по два раза, batch не закрыт.

