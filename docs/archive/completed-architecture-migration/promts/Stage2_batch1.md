# Stage 2 Batch 1

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
Нужно выполнить точный технический аудит Stage 2 из docs/architecture/migration-plan.md:
`Stage 2. Introduce Shared Domain Write and Conflict Contract`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие write-path в in-scope perimeter:
   - snapshot-save через `/api/data`
   - отдельные domain write endpoint'ы
   - conflict-enabled endpoint'ы
   - клиентские wrappers / повторяющиеся паттерны write execution
   - места, где UI сначала мутирует локальное состояние, а потом вызывает `saveData()`
2. Подтвердить, какие части shared contract уже фактически существуют.
3. Подтвердить по коду, где уже есть:
   - `meta.revision`
   - `card.rev`
   - `flow.version`
   - `expectedFlowVersion`
   - `409`
   - targeted refresh
   - route-safe refresh / сохранение route context после конфликта
   - `[DATA]` diagnostics
   - live/event envelope с `entity/id`
4. Подтвердить, чего еще НЕТ или что не доведено до shared contract:
   - `expectedRev`
   - shared conflict envelope с едиными полями
   - shared client write/conflict helper
   - `[CONFLICT]` diagnostics
   - явная legacy-boundary для `/api/data`
5. Составить карту разрывов между current-state и Stage 2.
6. Предложить точный новый порядок Stage 2 batches 2-6 без выполнения Stage 3+.

Что нужно проверить обязательно:
- js/app.00.state.js
- js/app.40.store.js
- js/app.50.auth.js
- js/app.70.render.cards.js
- js/app.72.directories.pages.js
- js/app.73.receipts.js
- js/app.74.approvals.js
- js/app.75.production.js
- js/app.90.usersAccess.js
- js/app.95.messenger.js
- server.js
- db.js
- tests/e2e/02.workspace-realtime.spec.js

Важно:
- в `js/app.73.receipts.js` анализируй workspace/workorders/derived-view/write части
- receipts-domain как отдельный домен не менять и не использовать как justification

Что нужно подтвердить по коду:
1. Где используется `/api/data` как read-path и как write-path.
2. Какие домены уже имеют отдельные endpoint'ы.
3. Где уже есть серверный `409 Conflict`.
4. Где конфликт уже правильно сохраняет route context.
5. Где уже есть targeted refresh вместо full reload.
6. Какие mature paths безопаснее всего использовать как reference implementation Stage 2.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта текущих write-path.
2. Что уже соответствует Stage 2.
3. Что именно пока отсутствует как shared foundation.
4. Новый порядок Stage 2 batches 2-6.
5. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой сайт.
2. Открой карточку и убедись, что интерфейс живой.
3. Открой `/workspace`, если есть доступ.
4. Открой `/production/plan`.
5. Убедись, что после аудита ничего не поменялось само по себе.
