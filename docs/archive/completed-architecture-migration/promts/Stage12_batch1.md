# Stage 12 Batch 1

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
- Это Stage 12: Normalize Realtime For Entire In-Scope Perimeter.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 13 и дальше:
  - не делать final legacy cleanup
  - не делать final diagnostics / perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-11 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для realtime consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 12 из docs/architecture/migration-plan.md:
`Stage 12. Normalize Realtime For Entire In-Scope Perimeter`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие realtime/live-path в in-scope perimeter.
2. Разделить scope Stage 12 по зонам:
   - cards live
   - directories / security live
   - production / workspace live
   - messaging live
   - fallback refresh
   - `[LIVE]` diagnostics
3. Отделить Stage 12 от соседних этапов:
   - Stage 11 messaging migration
   - Stage 13 final cleanup
   - Stage 14 final diagnostics/perf hardening
4. Найти, где realtime сейчас:
   - обязателен для correctness
   - участвует в bootstrap
   - подменяет server-truth instead of signaling refresh
   - шумит ложными offline/noise сообщениями
5. Для production live отдельно проверить Stage 8/9 contracts:
   - planning live должен сигналить route-local refresh
     `/api/production/planning/slice`, а не мутировать planning state как truth
   - execution live должен сигналить refresh card/flow state, а не обходить
     `expectedFlowVersion`
6. Составить точную карту разрывов между current-state и Stage 12.

Дополнительно, с учетом практического опыта Stage 4, для каждого in-scope UI flow, где live-update, concurrent refresh или user action может пересекаться с текущим route/context, отдельно зафиксировать:
- open / subscribe path
- refresh / reconcile path
- local no-request / no-refresh invalid-state path
- server-side conflict / rejected-command path, если он существует для связанного домена
- какие routes участвуют: list / detail / deeplink
- можно ли доказать route-safe fallback реальным two-tab / multi-client сценарием, а не только искусственным событием или mock-live

Что нужно проверить обязательно:
- js/app.00.state.js
- js/app.81.navigation.js
- js/app.40.store.js
- js/app.75.production.js
- server.js
- db.js
- docs/business-rules/cards-and-approval.md
- docs/business-rules/directories-and-security.md
- docs/business-rules/production-and-workspace.md
- docs/business-rules/messaging-profile-and-notifications.md
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где и как подключается realtime/live transport.
2. Какие домены получают live events.
3. Где live event инициирует refresh, а где пытается быть источником истины.
4. Есть ли зависимость bootstrap от live connection.
5. Где есть fallback refresh и где его не хватает.
6. Как логируются `[LIVE]` события.
7. Есть ли шумный offline/noise spam.
8. Какие live-path можно нормализовать без начала Stage 13.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current realtime/live paths.
2. Что уже соответствует Stage 12.
3. Где realtime еще нужен для correctness или мешает bootstrap.
4. Где граница между Stage 12 и Stage 13/14.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой сайт в двух вкладках.
2. Открой один и тот же экран в обеих вкладках.
3. Убедись, что после аудита ничего само не поменялось.
