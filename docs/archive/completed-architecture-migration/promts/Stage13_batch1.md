# Stage 13 Batch 1

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
- Это Stage 13: Remove Legacy Snapshot and Transitional Overlaps.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 14:
  - не делать final diagnostics/E2E/perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-12 целиком.
- Допустимо убирать только ту legacy-переходность, которая уже реально заменена новой моделью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 13 из docs/architecture/migration-plan.md:
`Stage 13. Remove Legacy Snapshot and Transitional Overlaps`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все остаточные legacy-механизмы в in-scope perimeter:
   - `/api/data` as critical write path
   - client `saveData()` for critical domains
   - route / write / live overlaps
   - shadow correctness hacks
   - legacy messaging overlap
2. Подтвердить, какие из них уже реально не нужны после Stage 1-12.
3. Составить карту безопасного удаления:
   - что можно удалить сразу
   - что должно сначала получить replacement confirmation
4. Отдельно учесть Stage 8 и receipts carve-out:
   - `/api/data` может оставаться для чтения, non-critical сценариев или
     frozen `receipts`, но не как critical write-path in-scope доменов
   - Stage 8 protection, которая не дает legacy snapshot перезаписать planning
     slices, нельзя удалять до подтверждения, что snapshot writes больше не
     могут прийти из in-scope критичных flows
5. Найти все unresolved adapters without removal path.
6. Составить точную карту разрывов между current-state и Stage 13.

Дополнительно, с учетом практического опыта Stage 4, для каждого остаточного overlapping UI flow, где есть action, modal, dialog, side panel, deeplink или detail-route confirm path, отдельно зафиксировать:
- какой primary path должен остаться
- какой legacy / overlap path должен быть удален
- local invalid-state / no-request path
- server-side conflict / rejected-command path
- какие routes участвуют: list / detail / deeplink
- можно ли доказать корректность после cleanup реальным two-tab / multi-client сценарием, а не только искусственным `409` через interceptor или mock

Что нужно проверить обязательно:
- js/app.00.state.js
- js/app.40.store.js
- js/app.50.auth.js
- js/app.70.render.cards.js
- js/app.75.production.js
- js/app.81.navigation.js
- server.js
- db.js
- docs/architecture/current-state.md
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где еще используется `/api/data` как критичный write-path.
2. Где еще используется client `saveData()` для in-scope критичных сценариев.
3. Где еще есть параллельные route/write/live pipelines.
4. Где correctness еще держится на local giant mutable snapshot или shadow hacks.
5. Где еще живет legacy messaging overlap.
6. Какие transitional overlaps уже можно удалить без риска.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта остаточной legacy-переходности.
2. Что уже безопасно удалять.
3. Что еще нельзя удалять и почему.
4. Где граница между Stage 13 и Stage 14.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой несколько основных экранов сайта.
2. Убедись, что после аудита ничего само не поменялось.
