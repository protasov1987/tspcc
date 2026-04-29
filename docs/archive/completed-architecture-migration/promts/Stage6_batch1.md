# Stage 6 Batch 1

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
- Это Stage 6: Migrate Directories.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 7 и дальше:
  - не делать security migration
  - не делать production migration
  - не делать messaging migration
- Нельзя заново переписывать Stage 3/4/5 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для directory-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 6 из docs/architecture/migration-plan.md:
`Stage 6. Migrate Directories`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path directory-domain.
2. Разделить scope Stage 6 по доменам:
   - departments / centers
   - operations
   - areas
   - employees assignment
   - shift times
3. Отделить Stage 6 от соседних этапов:
   - Stage 5 card files
   - Stage 7 security
   - production dependencies, которые нельзя ломать
4. Найти, где directories сейчас зависят от:
   - saveData()
   - /api/data
   - global arrays
   - security-side checks
   - production-side consumers
5. Составить точную карту разрывов между current-state и Stage 6.

Дополнительно, с учетом практического опыта Stage 4, для каждого in-scope UI flow, где есть action, modal, dialog, side panel, deeplink или detail-route confirm path, отдельно зафиксировать:
- open path
- confirm / submit path
- local invalid-state / no-request path
- server-side conflict / rejected-command path
- какие routes участвуют: list / detail / deeplink
- можно ли доказать route-safe refresh реальным two-tab / multi-client сценарием, а не только искусственным `409` через interceptor или mock

Если для какого-то subdomain таких open/confirm flows нет, это тоже нужно явно написать, а не оставлять неявным допущением.

Что нужно проверить обязательно:
- js/app.40.store.js
- js/app.70.render.cards.js
- js/app.75.production.js
- js/app.81.navigation.js
- server.js
- db.js
- docs/business-rules/directories-and-security.md
- docs/business-rules/production-and-workspace.md
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где редактируются departments / centers.
2. Где редактируются operations.
3. Где редактируются areas.
4. Где редактируются employees assignment.
5. Где редактируются shift times.
6. Какие directory-сущности уже имеют revision или должны ее получить.
7. Где обязательны permission checks.
8. Где production зависит от areas / shift times и historical texts.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current directory read/write paths.
2. Что уже соответствует Stage 6.
3. Где directory writes еще зависят от `/api/data`.
4. Где граница между Stage 6 и Stage 7/8.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой любой экран справочников.
2. Проверь, что список открывается как раньше.
3. Убедись, что после аудита ничего само не поменялось.
