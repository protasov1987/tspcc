# Stage 8 Batch 1

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
- Это Stage 8: Migrate Production Planning Layer.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 9 и дальше:
  - не делать workspace/execution migration
  - не делать derived views migration
  - не делать messaging / realtime migration
- Нельзя заново переписывать Stage 1-7 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для planning-layer consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 8 из docs/architecture/migration-plan.md:
`Stage 8. Migrate Production Planning Layer`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path planning-side production.
2. Разделить scope Stage 8 по зонам:
   - production schedule
   - production plan
   - production shifts
   - gantt
   - planning validations
3. Отделить Stage 8 от соседних этапов:
   - Stage 7 security
   - Stage 9 workspace / execution
   - Stage 10 derived views
4. Найти, где planning сейчас зависит от:
   - saveData()
   - /api/data
   - heavy local shadow state
   - pending overlays как основы корректности
   - shared global arrays
5. Составить точную карту разрывов между current-state и Stage 8.

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
1. Где выполняются planning writes.
2. Где строится production schedule.
3. Где редактируются shifts.
4. Где строится и обновляется gantt.
5. Где находятся planning validations.
6. Где planning-side уже использует revision/conflict model, а где еще нет.
7. Какие planning pages используют local shadow state как основу корректности.
8. Какие UI-сценарии Stage 8 можно перевести без начала Stage 9.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current planning read/write paths.
2. Что уже соответствует Stage 8.
3. Где planning writes еще зависят от `/api/data` или snapshot-save.
4. Где граница между Stage 8 и Stage 9/10.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой `/production/plan`.
2. Открой `/production/schedule`.
3. Убедись, что после аудита ничего само не поменялось.
