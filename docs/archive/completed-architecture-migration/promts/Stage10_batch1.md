# Stage 10 Batch 1

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
Нужно выполнить точный технический аудит Stage 10 из docs/architecture/migration-plan.md:
`Stage 10. Migrate Derived Production Views`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path derived production views.
2. Разделить scope Stage 10 по маршрутам:
   - `/workorders`
   - `/workorders/:qr`
   - `/archive`
   - `/archive/:qr`
   - `/items`
   - `/ok`
   - `/oc`
3. Отделить Stage 10 от соседних этапов:
   - Stage 9 execution
   - Stage 11 messaging/profile
   - Stage 13 final legacy cleanup
4. Обязательно учесть source-domain baseline после Stage 8/9:
   - planning source должен читаться из production planning contract /
     targeted slice model, а не из legacy snapshot assumptions
   - execution source должен опираться на Stage 9 flow/command state и
     `expectedFlowVersion`, если Stage 9 уже ввел эти replacement paths
   - derived views не должны становиться третьей production write-model
5. Найти, где derived views сейчас зависят от:
   - legacy source-model
   - bypass write-path
   - aggregated snapshot assumptions
   - несогласованных cards/production reads
6. Составить точную карту разрывов между current-state и Stage 10.

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
- js/app.70.render.cards.js
- js/app.40.store.js
- js/app.81.navigation.js
- server.js
- db.js
- docs/business-rules/workorders-archive-and-items.md
- docs/business-rules/production-and-workspace.md
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где строятся данные для `/workorders` и `/workorders/:qr`.
2. Где строятся данные для `/archive` и `/archive/:qr`.
3. Где строятся данные для `/items`, `/ok`, `/oc`.
4. Есть ли у derived views собственные write-path.
5. Какие derived views еще читают legacy source-model, противоречащую новому cards/production contract.
6. Где должен сохраняться route stability для detail routes.
7. Как реализован repeat из archive и не ломает ли он Stage 3/9 contract.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current derived views read/write paths.
2. Что уже соответствует Stage 10.
3. Где derived views еще зависят от legacy source-model.
4. Где граница между Stage 10 и Stage 11/13.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой `/workorders`.
2. Открой `/archive`.
3. Убедись, что после аудита ничего само не поменялось.
