# Stage 9 Batch 2

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
актуализировать shared execution client/server contract, НЕ создавая новый
production execution API.

Фактический результат Batch 1 audit:
- server-side foundation уже существует:
  - `/api/production/flow/*`
  - `/api/production/personal-operation/*`
  - `/api/production/operation/*`
- базовый execution concurrency contract уже строится на
  `card.flow.version` / `expectedFlowVersion`
- Stage 8 planning уже отделен через `production-planning` API и
  `meta.domainRevisions.productionPlanning`
- часть execution UI находится в `js/app.73.receipts.js`; этот файл можно
  трогать только как shared/workspace execution UI, не как receipts-домен.

Цель:
- не плодить второй execution API рядом с существующим foundation
- выровнять общий client-side write/conflict helper для Stage 9 flows
- подготовить route-safe targeted refresh для последующих batch
- зафиксировать, что execution revision != Stage 8 planning revision

Что нужно сделать:
1. Проверить текущие helpers:
   - `runClientWriteRequest`
   - `captureClientWriteRouteContext`
   - `runClientConflictRefreshOnce`
   - `refreshScopedDataPreservingRoute`
   - `sendFlowVersionConflict`
   - существующие `/api/production/flow/*`,
     `/api/production/personal-operation/*`,
     `/api/production/operation/*`
2. Если есть gaps, минимально усилить существующие helpers, чтобы все Stage 9
   flows могли единообразно делать:
   - send `expectedFlowVersion`
   - server `card.flow.version` check
   - `409 Conflict`
   - stay on current route
   - clear message
   - targeted production/workspace refresh
3. Не добавлять новый parallel execution API, если существующий endpoint уже
   покрывает действие.
4. Отдельно проверить, что обычные execution commands не используют
   `meta.domainRevisions.productionPlanning` как revision source.
5. Отдельно проверить, что legacy `/api/data` остается только compatibility
   boundary и не становится новым Stage 9 write path.
6. Подготовить точечные diagnostics/logs для conflict/refresh, если их не
   хватает для понимания зависания.

Что нельзя делать:
- не делать full client cutover всех execution screens в этом batch
- не переносить Stage 10 derived views
- не менять routes
- не смешивать planning `expectedRev` и execution `expectedFlowVersion`
- не строить correctness на новых pending hacks

После изменений обязательно проверить:
- существующие execution endpoints продолжают работать
- helper можно использовать в Batch 3-6 без копипасты conflict logic
- `expectedFlowVersion -> 409` реально поддерживается существующим foundation
- targeted refresh подходит для `/workspace`, `/workspace/:qr`,
  `/production/delayed`, `/production/defects`

Формат ответа:
1. Какие shared execution helpers усилил или подтвердил без изменений.
2. Почему новый server API не создавался / что именно было переиспользовано.
3. Как устроены `expectedFlowVersion`, conflict и targeted refresh.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Уточнен общий contract execution-команд производства"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой `/workspace`.
2. Открой `/production/delayed` или `/production/defects`, если доступно.
3. Убедись, что экраны открываются как раньше.
4. Если execution-экраны начали падать сразу при открытии, batch не закрыт.
