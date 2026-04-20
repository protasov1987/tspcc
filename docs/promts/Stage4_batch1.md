# Stage 4 Batch 1

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
- Это Stage 4: Migrate Approval, Input Control and Provision.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 5 и дальше:
  - не трогать card files как отдельный домен
  - не делать directories/security migration
  - не делать production migration
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 4 из docs/architecture/migration-plan.md:
`Stage 4. Migrate Approval, Input Control and Provision`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path approval, input control и provision.
2. Отделить Stage 4 от соседних этапов:
   - Stage 3 cards core
   - Stage 5 card files
   - production derived views
3. Подтвердить, какие операции Stage 4 реально входят в scope:
   - send to approval
   - role-based approvals
   - reject with reason
   - return rejected to draft
   - input control
   - provision
   - stage transitions
   - audit/log side effects
4. Найти, где Stage 4 сейчас зависит от:
   - saveData()
   - /api/data
   - global arrays
   - file side effects
   - production side effects
5. Составить точную карту разрывов между current-state и Stage 4.

Что нужно проверить обязательно:
- js/app.40.store.js
- js/app.70.render.cards.js
- js/app.75.production.js
- js/app.81.navigation.js
- server.js
- db.js
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js
- docs/business-rules/cards-and-approval.md

Что нужно подтвердить по коду:
1. Где карточка отправляется на согласование.
2. Где выполняется approve.
3. Где выполняется reject и сохраняется reason.
4. Где карточка возвращается в draft.
5. Где выполняется input control.
6. Где выполняется provision.
7. Какие side effects и логи обязательны.
8. Какие UI-сценарии Stage 4 можно перевести без затрагивания files.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current approval/input/provision read/write paths.
2. Что уже соответствует Stage 4.
3. Где Stage 4 еще зависит от `/api/data`.
4. Где граница между Stage 4 и Stage 5.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой карточку.
2. Открой экран согласований, если он доступен.
3. Убедись, что после аудита ничего само не поменялось.
