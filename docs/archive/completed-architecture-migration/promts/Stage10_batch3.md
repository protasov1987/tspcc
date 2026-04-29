# Stage 10 Batch 3

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
- Это Stage 10: Migrate Derived Production Views.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 11 и дальше:
  - не делать messaging/profile migration
  - не делать realtime normalization
  - не делать final legacy cleanup за пределами derived views
- Нельзя заново переписывать Stage 1-9 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для derived-view consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 10:
добить route-safe proof и multi-client behavior для `/workorders` после
Batch 2.

Цель:
- доказать, что `/workorders` и `/workorders/:qr` не только читают правильный
  source-domain state, но и стабильно переживают stale/open/confirm cases
- закрыть практический пробел Stage10_batch1: route stability не должна быть
  доказана только F5-smoke или искусственным `409`

Что нужно сделать:
1. Проверить актуальный код после Batch 2:
   - `js/app.73.receipts.js`
   - `js/app.00.state.js`
   - `js/app.10.utils.js`
   - `js/app.40.store.js`
   - `js/app.75.production.js`
   - `server.js`
   - `tests/e2e/00.auth-routes.spec.js`
   - `tests/e2e/02.workspace-realtime.spec.js`
   - `tests/e2e/07.cards-core-lifecycle.spec.js`
2. Для каждого action-capable workorders flow подтвердить:
   - action вообще относится к Stage 10 surface или должен оставаться Stage 9
   - open path на list/detail
   - confirm/submit path
   - local invalid-state/no-request path
   - server conflict/rejected-command path
   - route-safe refresh без потери `/workorders` или `/workorders/:qr`
3. Добавить или расширить E2E именно на real two-tab/multi-client сценарий,
   если такой action остается доступен из workorders.
4. Если после Batch 2 в `/workorders` больше нет submit/confirm action,
   явно зафиксировать это тестом или диагностикой:
   - read-only derived view
   - no `/api/data` writes from workorders
   - stable list/detail routes
5. Не переносить workspace execution tests целиком в этот batch. Использовать
   Stage 9 tests как baseline, но Stage 10 проверять на workorders routes.

Что нельзя делать:
- не возвращать workorders actions на `saveData()`
- не создавать специальную workorders revision model
- не менять business meaning operations/flow
- не трогать archive/items/ok/oc сверх минимальной общей инфраструктуры
- не начинать Stage 11/13

После изменений обязательно проверить:
- F5 на `/workorders`
- F5 на `/workorders/:qr`
- Back/Forward list/detail
- no `/api/data` write from workorders
- real stale/conflict/no-request path там, где есть action

Формат ответа:
1. Какие workorders flows проверены как action-capable.
2. Где доказан local invalid/no-request path.
3. Где доказан server conflict/rejected-command path.
4. Какие автоматические тесты добавлены/изменены.
5. Что нужно проверить вручную — чек-лист для обычного пользователя.
6. Остаточные риски и почему они не блокируют переход к Batch 4.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Для workorders подтверждены route-safe сценарии и отсутствие legacy writes"

После bump проверь, что запись появилась в docs/version-log.html и создана
локальная backup-ветка с commit по правилам AGENTS.md.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/workorders`.
2. Открой detail `/workorders/:qr`.
3. Нажми `F5` на list и detail.
4. Проверь Back/Forward между list/detail.
5. Если на странице есть доступные действия:
   - открой действие
   - если можно, подтверди на тестовой карте
   - убедись, что маршрут остался прежним или перешел только туда, куда ожидает бизнес-сценарий
6. Если доступных действий нет, убедись, что страница ведет себя как read-only витрина.
