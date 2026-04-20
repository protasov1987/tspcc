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
   - snapshot-save
   - domain endpoints
   - conflict-enabled endpoints
   - client wrappers around writes
2. Подтвердить, какие части shared contract уже фактически существуют.
3. Найти, где уже есть:
   - `rev`
   - `expectedRev`
   - `flow.version`
   - `409`
   - conflict UI handling
   - targeted refresh
   - `[DATA]` / `[CONFLICT]` diagnostics
4. Составить карту разрывов между current-state и Stage 2.
5. Предложить точный порядок Stage 2 batches без выполнения Stage 3+.

Что нужно проверить обязательно:
- js/app.40.store.js
- js/app.50.auth.js
- js/app.70.render.cards.js
- js/app.72.directories.pages.js
- js/app.74.approvals.js
- js/app.75.production.js
- js/app.90.usersAccess.js
- js/app.95.messenger.js
- server.js
- db.js
- tests/e2e/02.workspace-realtime.spec.js

Что нужно подтвердить по коду:
1. Где используется `/api/data`.
2. Какие домены уже имеют отдельные endpoint'ы.
3. Где уже есть серверный `409 Conflict`.
4. Где конфликт уже правильно сохраняет route context.
5. Где клиентские writes сейчас идут через local mutation + saveData().
6. Где можно безопасно внедрить shared server/client primitives без доменной миграции.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта текущих write-path.
2. Что уже соответствует Stage 2.
3. Где именно отсутствует shared contract.
4. Какой batch нужно делать первым.
5. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой сайт.
2. Открой карточку и попробуй просто посмотреть, что интерфейс живой.
3. Открой `/users` или `/accessLevels`, если есть доступ.
4. Открой `/production/plan`.
5. Убедись, что после аудита ничего не поменялось само по себе.
