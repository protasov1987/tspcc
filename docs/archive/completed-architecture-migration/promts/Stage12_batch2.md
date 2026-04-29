# Stage 12 Batch 2

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
- Это Stage 12: Normalize Realtime For Entire In-Scope Perimeter.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 11, Stage 13 или Stage 14:
  - не мигрировать `/api/messages/*`
  - не удалять `/api/data`, `saveData()` и legacy snapshot overlaps
  - не делать final legacy cleanup
  - не делать общий perf hardening или финальную диагностику всего проекта
- Нельзя заново переписывать Stage 1-11 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для realtime consistency.
- Нельзя делать big refactor "заодно".
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 12:
нормализовать production/workspace live как первый implementation batch после аудита.

Причина приоритета:
- аудит показал явный Stage 8/9 contract-gap именно в production/workspace live
- planning live должен сигналить refresh через `/api/production/planning/slice`
- execution/workspace live должен refresh card/flow state от server truth
- incoming `card.*` live payload не должен применяться как рабочий state production/workspace

Известные live paths из аудита:
- общий SSE `/api/events/stream`
- `startCardsSse()` в `js/app.00.state.js`
- `cards:changed` branch, который вызывает `scheduleProductionLiveRefresh()` / `scheduleWorkspaceLiveRefresh()`
- structured events `card.created`, `card.updated`, `card.deleted`, `card.files-updated`
- planning slice helpers в `js/app.75.production.js`
- route-safe targeted refresh foundation в `js/app.10.utils.js`

Что нужно сделать:
1. Точно найти production/workspace ветки в общих `cards:changed` и `card.*` handlers.
2. Сделать узкий патч только для production/workspace behavior:
   - live event только сигналит refresh/reconcile
   - не использовать incoming live payload как source of truth
   - не делать прямой upsert/remove карточки как production/workspace state
3. Для planning routes:
   - refresh должен идти через route-local `/api/production/planning/slice`
   - не подменять `meta.domainRevisions.productionPlanning` live payload'ом
   - не откатываться на общий broad `loadDataWithScope(DATA_SCOPE_PRODUCTION)`, если доступен planning slice
4. Для workspace/execution routes:
   - live должен инициировать server refresh card/flow state
   - live не должен обходить Stage 9 `expectedFlowVersion -> 409` write-conflict model
   - rejected-command/conflict correctness должна оставаться серверной
5. Сохранить route stability для:
   - `/workspace`
   - `/workspace/:qr`
   - production planning routes
   - card/detail routes, если они затрагиваются только как dependency
6. Сохранить или добавить точечные `[LIVE]` diagnostics по production/workspace:
   - event received
   - targeted refresh scheduled
   - refresh failed/fallback scheduled
   - без spam
7. Не трогать в этом batch cleanup cards/directories/security/messaging, кроме минимальных shared helpers, если без них нельзя закрыть production/workspace gap.

Что нельзя делать:
- не делать production/workspace live обязательным для correctness
- не применять incoming `card.*` payload как production/workspace state
- не ломать Stage 8 planning slice contract
- не ломать Stage 9 `expectedFlowVersion` conflict model
- не исправлять cards/directories/messaging "заодно"
- не начинать Stage 13 cleanup

После изменений обязательно проверить:
- production planning live refresh идет через `/api/production/planning/slice`
- workspace/execution live refresh идет через server truth, а не live payload
- `expectedFlowVersion` conflict behavior не обходится live reconcile
- fallback/no-live поведение не ломает маршрут
- bootstrap не начал зависеть от live

Формат ответа:
1. Какие production/workspace live paths перевел.
2. Как теперь работает planning slice refresh и workspace/execution refresh.
3. Как подтверждено, что live payload не стал source of truth.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Нормализован live-режим production и workspace через server refresh"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/workspace` или production planning route в двух вкладках.
2. Во второй вкладке выполни одно безопасное production/workspace действие, если у тебя есть права.
3. Вернись в первую вкладку.
4. Проверь:
   - данные обновились или понятно догрузились
   - маршрут не потерялся
   - экран не сломался
5. Обнови первую вкладку через `F5`.
6. Проверь, что итоговое состояние совпадает с серверным.
7. Если production/workspace становится корректным только из-за live payload без server refresh, batch не закрыт.
