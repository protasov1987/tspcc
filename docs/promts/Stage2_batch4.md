# Stage 2 Batch 4

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
- Это Stage 2: Introduce Shared Domain Write and Conflict Contract.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 3 и дальше: не переводить конкретные домены на новые write API полностью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 2:
стандартизовать `[CONFLICT]` / `[DATA]` diagnostics вокруг shared write-contract.

Цель:
- по логам должно быть понятно:
  - какой write-path отработал
  - какой домен дал конфликт
  - какой entity/id участвовал
  - какой expected/actual version/revision сравнивался
  - был ли targeted refresh или fallback
  - был ли маршрут сохранён
- diagnostics не должны превращаться в шум

Что нужно сделать:
1. Проверить текущие `[DATA]` diagnostics и текущие conflict traces.
2. Добавить недостающие shared log points в server/client helpers, появившиеся в Batch 2-3.
3. Новый diagnostic trace должен покрывать минимум:
   - write start
   - write success
   - conflict detected
   - targeted refresh started/finished
   - fallback refresh started/finished
   - route-safe re-render / handleRoute re-entry, если она была
4. Использовать устойчивые префиксы:
   - `[DATA]`
   - `[CONFLICT]`
5. Не переписывать unrelated logging layer и не ломать существующие полезные логи.

Что нельзя делать:
- не переписывать весь logging layer
- не менять route behavior
- не трогать realtime semantics
- не трогать receipts как домен
- не добавлять log spam ради “полноты”

После изменений обязательно проверить:
- conflict traces в production/workspace стали понятнее
- `[DATA]` и `[CONFLICT]` дают цельную картину одного write-flow
- нет постоянного мусорного спама в обычной работе

Формат ответа:
1. Чего именно не хватало в diagnostics.
2. Что именно добавил или изменил.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Улучшена диагностика данных и конфликтов для общего write-контракта"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Нужна, если ты умеешь открыть консоль браузера.

### Чек-лист для чайника

1. Открой сайт.
2. Нажми `F12`.
3. Открой вкладку `Console`.
4. Выполни одно обычное действие, которое отправляет запись на сервер.
5. Посмотри, есть ли осмысленные логи с `[DATA]`.
6. Если есть известный conflict-сценарий в workspace или production:
   - воспроизведи его
   - посмотри, есть ли осмысленные `[CONFLICT]` логи
7. В логах должно быть понятно, что произошло, без бесконечного спама одинаковыми сообщениями.
8. Если логи шумные, бесполезные или по ним нельзя понять conflict/write flow, batch не закрыт.
