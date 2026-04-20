# Stage 3 Batch 1

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
- Это Stage 3: Migrate Cards Core.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 4 и Stage 5:
  - не трогать approvals как отдельный домен
  - не трогать input control
  - не трогать provision
  - не трогать card files как домен
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 3 из docs/architecture/migration-plan.md:
`Stage 3. Migrate Cards Core`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path cards core.
2. Отделить cards core от соседних доменов:
   - approvals
   - input control
   - provision
   - card files
   - production derived views
3. Подтвердить, какие операции Stage 3 реально входят в cards core:
   - create
   - update
   - delete
   - archive
   - repeat
   - detail fetch
   - list/query
   - route-local refresh
4. Найти, где cards core сейчас зависит от:
   - saveData()
   - /api/data
   - global arrays
   - production side effects
5. Составить точную карту разрывов между current-state и Stage 3.

Что нужно проверить обязательно:
- js/app.40.store.js
- js/app.70.render.cards.js
- js/app.00.state.js
- js/app.50.auth.js
- js/app.73.receipts.js
- js/app.75.production.js
- server.js
- db.js
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где создается карточка.
2. Где сохраняется generic card edit.
3. Где удаляется карточка.
4. Где архивируется карточка.
5. Где делается repeat / duplicate.
6. Где загружается cards list.
7. Где загружается card detail.
8. Где сейчас `card.rev` уже участвует, а где еще нет.
9. Какие UI-сценарии Stage 3 можно перевести без затрагивания Stage 4/5.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current cards core read/write paths.
2. Что уже соответствует Stage 3.
3. Где cards core еще зависит от `/api/data`.
4. Где граница между Stage 3 и Stage 4/5.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой `/cards`.
2. Открой одну карточку.
3. Убедись, что после аудита ничего само не поменялось.
