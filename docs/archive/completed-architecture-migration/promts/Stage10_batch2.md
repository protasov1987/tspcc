# Stage 10 Batch 2

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
закрыть первый найденный аудитом blocker — `/workorders` как derived-view
не должен зависеть от несогласованного read scope и не должен писать через
legacy snapshot-save.

Актуальный baseline после Stage10_batch1:
- фактическая UI-логика `/workorders` находится преимущественно в
  `js/app.73.receipts.js`, а не в `js/app.75.production.js`
- `/workorders` строится из глобальных `cards`, `productionShiftTasks`,
  `productionShiftTimes`
- route-critical scope для `/workorders` сейчас уходит в `cards-basic`, хотя
  фильтр доступности использует planning-derived `productionShiftTasks`
- в `bindOperationControls()` есть legacy bypass writes через `saveData()`:
  executor, additional executor, qty, op comments
- archive action уже идет через cards-core; execution actions уже должны
  опираться на Stage 9 `expectedFlowVersion`

Цель:
- сделать `/workorders` и `/workorders/:qr` производной read-model витриной
  поверх cards + production source domains
- убрать workorders-owned bypass writes через `/api/data`
- сохранить текущий бизнес-смысл списка/detail
- не вводить собственный workorders write-model

Что нужно сделать:
1. Точно проверить:
   - `js/app.73.receipts.js`
   - `js/app.00.state.js`
   - `js/app.50.auth.js`
   - `js/app.40.store.js`
   - `js/app.75.production.js`
   - `server.js`
   - `db.js`
2. Для `/workorders` обеспечить read baseline:
   - card state берется из cards source contract
   - planning-derived данные не должны зависеть от `cards-basic` assumptions
   - если нужен `productionShiftTasks`, route должен иметь production planning
     source/scope, совместимый со Stage 8 `production-planning` revision model
3. Найти все `saveData()` paths, достижимые из `/workorders` и `/workorders/:qr`.
4. Для каждого такого path принять минимальное Stage 10-совместимое решение:
   - либо перевести на уже существующий source-domain command, если такой command
     уже есть
   - либо убрать action из derived-view surface, если это не должно быть
     production execution action в Stage 10
   - либо явно оставить только временный read-only/no-op guard с понятным
     сообщением и без server write, если command replacement относится к Stage 9
     и еще не готов
5. Не переписывать Stage 9 execution целиком.
6. Не трогать `/archive`, `/items`, `/ok`, `/oc`, кроме минимальной общей
   совместимости, если она нужна для workorders.

Для каждого in-scope workorders action отдельно зафиксировать:
- open path
- confirm / submit path
- local invalid-state / no-request path
- server-side conflict / rejected-command path
- route coverage: `/workorders` list, `/workorders/:qr` detail
- можно ли доказать route-safe refresh реальным two-tab/multi-client сценарием

Что нельзя делать:
- не добавлять новый `/api/workorders/*` write-domain
- не оставлять workorders correctness на `saveData()`
- не менять business meaning workorders
- не ломать `/workorders/:qr`
- не начинать Stage 11/13

После изменений обязательно проверить:
- `/workorders` и `/workorders/:qr` открываются после F5/direct URL
- Back/Forward между list/detail работает
- достижимые workorders actions не пишут в `/api/data`
- если action использует execution command, он передает `expectedFlowVersion`
- conflict/rejected path не сбрасывает пользователя на dashboard

Формат ответа:
1. Какие `/workorders` read/write paths изменил.
2. Какой source-domain contract теперь используется для cards/planning/execution.
3. Какие bypass `saveData()` paths убраны, переведены или явно заблокированы.
4. Какие тесты/сценарии проверил автоматически.
5. Что нужно проверить вручную — чек-лист для обычного пользователя.
6. Остались ли риски и к какому batch они относятся.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Витрина workorders очищена от legacy write-path и согласована с source-domain моделью"

После bump проверь, что запись появилась в docs/version-log.html и создана
локальная backup-ветка с commit по правилам AGENTS.md.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/workorders`.
2. Открой одну запись по `/workorders/:qr`.
3. Нажми `F5` на detail route.
4. Вернись назад в список и снова открой detail.
5. Проверь, что список и detail показывают ожидаемые карты.
6. Выполни только доступные действия в workorders:
   - если действие доступно, оно не должно молча ломаться
   - при конфликте/устаревшем состоянии должен быть понятный toast/message
7. Если после действия маршрут теряется или есть запись в `/api/data`,
   batch не закрыт.
