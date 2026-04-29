# Stage 10 Batch 4

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
перевести и доказать `/archive` и `/archive/:qr` как derived read-model
поверх cards/production source domains без потери archive/repeat semantics.

Актуальный baseline после Stage10_batch1:
- archive list/detail строятся в `js/app.73.receipts.js`
- `renderArchiveTable()` читает глобальные `cards` и фильтрует
  `archived && cardType === MKI && isCardProductionEligible(card)`
- repeat уже использует cards-core:
  `repeatArchivedCardViaCardsCore()` -> `/api/cards-core/:id/repeat`
- серверный repeat уже требует `expectedRev` и создает новую draft-карту
- отсутствует real two-tab proof для stale repeat route-safe behavior

Цель:
- archive остается производной витриной, а не source-domain
- repeat продолжает создавать новую `DRAFT`, не изменяя архивную карту
- detail route `/archive/:qr` стабилен после F5/direct URL/back-forward
- action repeat имеет понятные local invalid/conflict paths

Что нужно сделать:
1. Проверить:
   - `js/app.73.receipts.js`
   - `js/app.00.state.js`
   - `js/app.40.store.js`
   - `js/app.10.utils.js`
   - `server.js`
   - `tests/e2e/07.cards-core-lifecycle.spec.js`
   - `tests/e2e/08.cards-core-list-compat.spec.js`
2. Убедиться, что archive read использует тот же cards source contract, что
   cards-core lifecycle, и не вводит archive-specific storage/write-model.
3. Если archive read все еще зависит от устаревшего aggregated snapshot
   assumption, заменить на Stage 10-compatible source read foundation.
4. Для repeat покрыть:
   - open path на `/archive` и `/archive/:qr`
   - confirm/submit path
   - local invalid-state/no-request, если архивная карта уже недоступна/неархивна
   - server-side `409` stale `expectedRev`
   - route-safe refresh без потери текущего archive context
5. Добавить real two-tab/multi-client E2E для stale repeat, если его еще нет.
6. Не менять смысл archive и не переносить сюда items/ok/oc.

Что нельзя делать:
- не делать repeat эквивалентом unarchive
- не добавлять `/api/archive/*` write API
- не возвращать repeat/archive на `/api/data`
- не удалять общий legacy snapshot как Stage 13 cleanup
- не начинать Stage 11

После изменений обязательно проверить:
- `/archive` открывается
- `/archive/:qr` открывается и F5 остается на detail
- repeat создает новую draft-карту
- stale repeat дает понятное сообщение и route-safe refresh
- archive не пишет в `/api/data`

Формат ответа:
1. Какие archive paths изменил.
2. Как сохранены archive semantics и repeat creates new draft.
3. Как доказаны local invalid/no-request и server conflict paths.
4. Какие автоматические тесты добавлены/изменены.
5. Что нужно проверить вручную — чек-лист для обычного пользователя.
6. Остаточные риски и к какому batch они относятся.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Архив и repeat подтверждены как source-domain совместимая витрина"

После bump проверь, что запись появилась в docs/version-log.html и создана
локальная backup-ветка с commit по правилам AGENTS.md.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/archive`.
2. Открой одну запись по `/archive/:qr`.
3. Нажми `F5` на detail route.
4. Вернись назад в список и снова открой detail.
5. Если доступен repeat:
   - выполни repeat на тестовой архивной записи
   - должна открыться новая draft-карта
   - старая архивная карта должна остаться в архиве
6. Если repeat меняет архивную карту вместо создания новой, batch не закрыт.
