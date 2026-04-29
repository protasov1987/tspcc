# Stage 1 Batch 3 - done

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
выровнять реальный bootstrap order с docs/architecture/spa-boot.md.

Цель:
- в приложении должен остаться один linear bootstrap pipeline
- bootstrap order в коде и в docs должен совпадать
- route activation должна происходить в правильной фазе bootstrap
- если bootstrap делает internal SPA redirect, pipeline должен продолжаться по canonical route
- live/SSE не должны стартовать раньше, чем route resolved

Что нужно сделать:
1. Сравнить реальный bootstrap flow в коде с docs/architecture/spa-boot.md.
2. Исправить только те расхождения, которые реально нарушают Stage 1.
3. Подтвердить, что popstate handler attached exactly once и не позднее route activation.
4. Перенести старт live/SSE на корректный этап bootstrap, если сейчас он стартует слишком рано.
5. Если порядок изменился — обязательно обновить docs/architecture/spa-boot.md.

Что нужно проверить обязательно:
- js/app.99.init.js
- js/app.50.auth.js
- js/app.81.navigation.js
- docs/architecture/spa-boot.md
- tests/e2e/00.auth-routes.spec.js

Что нельзя делать:
- не переписывать router целиком
- не менять доменные сценарии страниц
- не чинить в этом batch E2E coverage beyond bootstrap-related issues
- не трогать receipts как домен

После изменений обязательно проверить:
- `F5` на `/dashboard`
- `F5` на `/cards`
- `F5` на `/profile/:id`
- `F5` на `/production/plan`
- direct URL entry
- отсутствие второго bootstrap pipeline
- route correctness после `/` -> landingTab redirect

Формат ответа:
1. Какие именно расхождения bootstrap order были в коде.
2. Что именно изменил в последовательности bootstrap.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Обновлялся ли docs/architecture/spa-boot.md.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Выровнен порядок bootstrap и старта live для in-scope маршрутов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой сайт.
2. Если страница открывается с `/`, после входа должен открыться домашний маршрут пользователя.
3. Открой `/cards` и нажми `F5`.
4. Открой `/profile/ID_ТЕКУЩЕГО_ПОЛЬЗОВАТЕЛЯ` и нажми `F5`.
5. Открой `/production/plan` и нажми `F5`.
6. Во всех случаях должен открываться именно тот маршрут, который указан в адресной строке.
7. Не должно быть прыжков на другой экран после того, как страница уже открылась.
8. Если после входа или `F5` маршрут теряется, batch не закрыт.

