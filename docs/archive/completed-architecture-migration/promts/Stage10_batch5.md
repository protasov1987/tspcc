# Stage 10 Batch 5

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
перевести `/items`, `/ok`, `/oc` на source-domain compatible read-model и
доказать согласованность с реальным flow.

Актуальный baseline после Stage10_batch1:
- все три route используют `tpl-items` и route config в `js/app.73.receipts.js`
- `buildItemsPageBlocks()` -> `collectItemsPageInstances()` читает глобальные
  `cards`, `card.flow.items`, `card.flow.samples`, `flow.archivedItems`
- read metadata частично использует `initialSnapshot` fallback
- write-path для `/items`, `/ok`, `/oc` не найден: фильтры/сортировка/пагинация
  являются local UI state
- double-click по route cell делает deeplink в `/workorders/:qr` или `/archive/:qr`

Цель:
- `/items`, `/ok`, `/oc` остаются производными read-model витринами
- данные берутся из cards/production flow source state, а не из несогласованной
  legacy copy
- витрины не получают собственные write-path
- deeplinks из витрин ведут на стабильные `/workorders/:qr` или `/archive/:qr`

Что нужно сделать:
1. Проверить:
   - `js/app.73.receipts.js`
   - `js/app.00.state.js`
   - `js/app.50.auth.js`
   - `js/app.40.store.js`
   - `js/app.75.production.js`
   - `server.js`
   - `tests/e2e/00.auth-routes.spec.js`
   - `tests/e2e/08.cards-core-list-compat.spec.js`
2. Явно выделить/использовать read primitive для items page blocks, если это
   уменьшает legacy coupling без big refactor.
3. Проверить и, если replacement готов, убрать зависимость от `initialSnapshot`
   там, где она противоречит current cards/production source contract.
   Если убрать нельзя без смены business meaning, оставить как documented
   transitional fallback с явным boundary.
4. Подтвердить, что route-critical data для `/items`, `/ok`, `/oc` достаточна
   для flow-derived данных и не опирается на stale aggregated snapshot.
5. Добавить/расширить E2E:
   - `/items`, `/ok`, `/oc` open + F5
   - отсутствие writes в `/api/data` при фильтрах/сортировке/пагинации
   - consistency after cards/flow source update, если такой сценарий можно
     построить минимально
   - deeplink из route cell в workorders/archive detail сохраняет route stability
6. Не трогать receipts и не начинать Stage 11.

Что нельзя делать:
- не создавать `/api/items/*`, `/api/ok/*`, `/api/oc/*` write-model
- не менять бизнес-смысл статусов GOOD/DELAYED/DEFECT/DISPOSED/PENDING
- не переносить execution migration из Stage 9
- не удалять legacy snapshot глобально как Stage 13 cleanup

После изменений обязательно проверить:
- `/items`, `/ok`, `/oc` открываются и переживают F5
- фильтры/сортировки/пагинация не пишут на сервер
- данные согласованы с `card.flow.items/samples/archivedItems`
- deeplink ведет на правильный route

Формат ответа:
1. Какие items/ok/oc read paths изменил.
2. Как доказана согласованность с flow.
3. Что сделано с `initialSnapshot` fallback.
4. Какие автоматические тесты добавлены/изменены.
5. Что нужно проверить вручную — чек-лист для обычного пользователя.
6. Остаточные риски и к какому batch они относятся.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Витрины items, ok и oc согласованы с source-domain flow"

После bump проверь, что запись появилась в docs/version-log.html и создана
локальная backup-ветка с commit по правилам AGENTS.md.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой:
   - `/items`
   - `/ok`
   - `/oc`
2. На каждой странице нажми `F5`.
3. Проверь поиск, фильтр статуса, даты, сортировку и пагинацию.
4. Если есть известное изделие/образец, проверь, что оно попадает в правильную витрину.
5. Дважды кликни по номеру маршрутной карты в таблице, если такая строка есть:
   - должна открыться правильная карта в `/workorders/:qr` или `/archive/:qr`
6. Если фильтры или сортировка вызывают сохранение на сервер, batch не закрыт.
