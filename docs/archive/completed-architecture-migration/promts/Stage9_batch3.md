# Stage 9 Batch 3

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
- Это Stage 9: Migrate Workspace and Execution Layer.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 10 и дальше:
  - не делать derived views migration
  - не делать messaging / realtime migration
  - не делать final legacy cleanup за пределами execution-layer
- Нельзя заново переписывать Stage 1-8 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для execution-layer consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 9:
довести workspace и personal operations до единого execution conflict/refresh
contract на уже существующих production commands.

Фактическая отправная точка:
- workspace start/pause/resume/complete/reset уже идут через
  `/api/production/operation/*`
- personal operations уже идут через
  `/api/production/personal-operation/select|action`
- в `js/app.73.receipts.js` уже есть локальные optimistic/patch helpers и
  отдельные refresh paths; их нужно аудитить как execution UI, а не как
  receipts-домен.

Цель:
- убрать остаточные raw/разнородные conflict paths для workspace/personal
- сохранить текущий смысл workspace и personal operations
- доказать route-safe behavior на `/workspace` и `/workspace/:qr`
- не переводить сюда identify / transfer / material flows

Что нужно сделать:
1. Найти client/server flow для:
   - workspace direct actions: start / pause / resume / complete / reset
   - personal operation select
   - personal operation start / pause / resume / reset
2. Не создавать новые endpoints, если текущие commands уже покрывают действие.
3. Привести client submit paths к общему helper/contract из Batch 2:
   - `expectedFlowVersion`
   - `409`
   - clear message
   - stay on route
   - targeted refresh production/workspace scope
4. Проверить local invalid-state / no-request paths:
   - blocked operation
   - missing card/op/personalOperation
   - role denied
   - duplicate click/action lock
   Эти paths должны давать понятное сообщение или безопасный no-op без потери
   маршрута.
5. Проверить, что pending/action locks используются только как UI disabled
   state, а не как основа correctness.
6. Проверить, что Stage 8 planning revision не используется для этих actions.

Что нельзя делать:
- не менять business meaning workspace actions
- не ломать `/workspace` и `/workspace/:qr`
- не начинать Stage 10 derived views migration
- не переносить identify / transfer / material / drying / delayed flows в этот batch

После изменений обязательно проверить:
- workspace/personal writes не используют `saveData()` или `/api/data`
- conflict сохраняет route и context
- targeted refresh работает на list и detail/deeplink route
- real two-tab conflict для workspace action остается рабочим, не только
  synthetic `409`

Формат ответа:
1. Какие workspace / personal paths изменил или подтвердил.
2. Что именно сохранил из business semantics.
3. Какие local invalid-state / no-request paths проверил.
4. Какие server-side conflict paths проверил.
5. Какие сценарии проверил автоматически.
6. Что нужно проверить вручную после изменений — отдельным чек-листом.
7. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Workspace и личные операции выровнены по execution contract"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/workspace`.
2. Выполни одно безопасное workspace-действие, если есть права.
3. Проверь:
   - действие сохранилось
   - маршрут не потерялся
   - после `F5` состояние осталось
4. Если есть личная операция:
   - выбери изделия или запусти/поставь на паузу личную операцию
   - проверь, что экран не ломается
5. Если можешь, повтори действие во второй вкладке:
   - должен быть понятный conflict/refresh behavior
   - маршрут должен остаться `/workspace` или `/workspace/<qr>`
