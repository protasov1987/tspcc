# Stage 14 Batch 1

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
- Это Stage 14: Final Diagnostics, E2E and Performance Hardening.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Это финальный stage доказательства достижения target architecture, а не новый продуктовый refactor.
- Performance work разрешен только после подтверждения correctness и только после измерений.
- Нельзя делать необоснованные perf-оптимизации "на глаз".
- Сначала проведи точную диагностику по коду и тестам, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 14 из docs/architecture/migration-plan.md:
`Stage 14. Final Diagnostics, E2E and Performance Hardening`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все недостающие элементы финального доказательства достижения target architecture.
2. Разделить scope Stage 14 по зонам:
   - normalized diagnostics
   - E2E coverage
   - correctness proof
   - measured performance hardening
3. Проверить соответствие:
   - Stage 14 section
   - `Test Plan`
   - `Global Exit Criteria`
   - `Definition Of Failure`
4. Составить точную карту gaps:
   - какие diagnostics tags еще неполные
   - каких E2E еще не хватает
   - какие critical scenarios еще не доказаны
   - где есть perf-риски без baseline measurement
5. Отдельно проверить временное примечание про realtime E2E `/workspace` и допуск выше `1000ms`.
6. Отдельно проверить proof, добавленный после Stage 8:
   - planning revision не равна и не зависит от global `meta.revision`
   - unrelated non-planning writes не создают stale planning conflict
   - legacy snapshot write не может перезаписать planning slices
   - `/production/gantt/:card` и `/production/shifts/:key` имеют route-local
     refresh/conflict proof

Дополнительно, с учетом практического опыта Stage 4, отдельно найти gaps, где proof пока опирается только на искусственный `409`, mock-live или interceptor, но не доказывает:
- real two-tab / multi-client scenario
- local invalid-state / no-request path
- route-safe refresh / fallback на list, detail и deeplink routes, если такие маршруты есть
- отсутствие silent no-op / silent close / lone `alert(...)` / hidden `return` path после конкурентного изменения

Что нужно проверить обязательно:
- docs/architecture/target-architecture.md
- docs/architecture/migration-plan.md
- docs/architecture/change-checklist.md
- tests/e2e/**
- js/app.00.state.js
- js/app.40.store.js
- js/app.50.auth.js
- js/app.75.production.js
- js/app.81.navigation.js
- server.js
- db.js

Что нужно подтвердить по коду и тестам:
1. Где уже есть `[BOOT]`, `[ROUTE]`, `[LIVE]`, `[DATA]`, `[CONFLICT]`.
2. Какие route families уже покрыты E2E и какие еще нет.
3. Какие conflict scenarios уже покрыты и какие нет.
4. Есть ли доказательство correctness with live unavailable.
5. Есть ли baseline performance measurement и post-fix measurement.
6. Какие временные test tolerances еще остались.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта gaps финального proof-stage.
2. Что уже соответствует Stage 14.
3. Какие batch нужно делать следующими и в каком порядке.
4. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой несколько ключевых экранов.
2. Убедись, что после аудита ничего само не поменялось.
