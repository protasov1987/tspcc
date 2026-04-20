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
стандартизовать `[CONFLICT]` / `[DATA]` diagnostics для shared write-contract.

Цель:
- по логам должно быть понятно:
  - какой write-path отработал
  - какой домен дал конфликт
  - какой entity/id конфликтовал
  - какой expected/actual revision пришел
  - был ли route-safe refresh/fallback
- diagnostics не должны превращаться в шум

Что нужно сделать:
1. Проверить текущие `[DATA]` и conflict-related логи.
2. Добавить недостающие ключевые точки для shared contract.
3. Не переписывать unrelated diagnostics.
4. Не менять бизнес-логику.

Что нельзя делать:
- не переписывать весь logging layer
- не менять route behavior
- не трогать receipts как домен
- не менять realtime

После изменений обязательно проверить:
- конфликтные production сценарии продолжают логироваться
- новые shared write/conflict точки дают понятный trace
- нет чрезмерного log spam

Формат ответа:
1. Чего не хватало в diagnostics.
2. Что именно добавил/изменил.
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
6. Если есть известный conflict-сценарий в production или workspace:
   - воспроизведи его
   - посмотри, есть ли осмысленные `[CONFLICT]` или conflict-related логи
7. В логах должно быть понятно, что произошло.
8. Важно:
   - не должно быть бесконечного спама одинаковыми сообщениями
   - не должно быть полного отсутствия useful diagnostics

Если логов слишком много, они шумные или бесполезные, batch не закрыт.
