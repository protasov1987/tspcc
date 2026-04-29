# Stage 9 Batch 1

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
Нужно выполнить точный технический аудит Stage 9 из docs/architecture/migration-plan.md:
`Stage 9. Migrate Workspace and Execution Layer`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path execution-side production.
2. Разделить scope Stage 9 по зонам:
   - workspace
   - personal operations
   - identify
   - transfer
   - material issue / return
   - drying
   - delayed
   - defects
   - repair
   - dispose
3. Отделить Stage 9 от соседних этапов:
   - Stage 8 planning
   - Stage 10 derived views
   - Stage 12 realtime normalization
4. Обязательно учесть фактический результат Stage 8:
   - planning-side уже должен жить через `production-planning` API и
     `meta.domainRevisions.productionPlanning`
   - legacy `/api/data` не должен принимать planning writes обратно
   - execution-side нельзя строить на planning revision; для Stage 9 базовый
     конкурентный контракт — `card.flow.version` / `expectedFlowVersion`
   - если в коде уже есть `/api/production/flow/*` endpoints/helpers, считать
     их текущим foundation и аудитить на gaps, а не создавать второй API рядом
5. Найти, где execution-side сейчас зависит от:
   - saveData()
   - /api/data
   - bypass write-path
   - pending-state tricks как основы корректности
   - local shadow models
6. Составить точную карту разрывов между current-state и Stage 9.

Дополнительно, с учетом практического опыта Stage 4, для каждого in-scope UI flow, где есть action, modal, dialog, side panel, deeplink или detail-route confirm path, отдельно зафиксировать:
- open path
- confirm / submit path
- local invalid-state / no-request path
- server-side conflict / rejected-command path
- какие routes участвуют: list / detail / deeplink
- можно ли доказать route-safe refresh реальным two-tab / multi-client сценарием, а не только искусственным `409` через interceptor или mock

Если для какого-то subdomain таких open/confirm flows нет, это тоже нужно явно написать, а не оставлять неявным допущением.

Что нужно проверить обязательно:
- js/app.75.production.js
- js/app.40.store.js
- js/app.81.navigation.js
- server.js
- db.js
- docs/business-rules/production-and-workspace.md
- docs/business-rules/workorders-archive-and-items.md
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где выполняются workspace actions.
2. Где выполняются personal operations.
3. Где выполняются identify и transfer.
4. Где выполняются material issue / return.
5. Где выполняются drying / delayed / defects / repair / dispose.
6. Где используется `expectedFlowVersion` или его аналог, а где еще нет.
7. Где execution-side correctness держится на pending-state tricks.
8. Какие UI-сценарии Stage 9 можно перевести без начала Stage 10.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current execution read/write paths.
2. Что уже соответствует Stage 9.
3. Где execution writes еще зависят от `/api/data` или snapshot-save.
4. Где граница между Stage 9 и Stage 10/12.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой `/workspace`.
2. Открой любой доступный execution-экран.
3. Убедись, что после аудита ничего само не поменялось.
