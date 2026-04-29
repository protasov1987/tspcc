# Stage 5 Batch 1

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
- Это Stage 5: Complete Card Files.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 6 и дальше:
  - не делать directories/security migration
  - не делать production migration
  - не делать messaging migration
- Нельзя заново переписывать Stage 3/4 целиком.
- Допустимо трогать только те места Stage 3/4, которые нужны для file-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно выполнить точный технический аудит Stage 5 из docs/architecture/migration-plan.md:
`Stage 5. Complete Card Files`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Найти все текущие read/write-path file-domain карточки.
2. Отделить Stage 5 от соседних этапов:
   - Stage 3 cards core
   - Stage 4 approvals/input control/provision
   - Stage 6 directories
3. Подтвердить, какие операции Stage 5 реально входят в scope:
   - upload
   - delete
   - resync
   - attachment-linked side effects
   - card/file consistency
4. Найти, где file-domain сейчас зависит от:
   - saveData()
   - /api/data
   - global arrays
   - input-control linkage
   - duplicate PARTS_DOCS guards
5. Составить точную карту разрывов между current-state и Stage 5.

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
- server.js
- db.js
- docs/business-rules/cards-and-approval.md
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нужно подтвердить по коду:
1. Где выполняется upload файлов карточки.
2. Где выполняется delete файлов карточки.
3. Где выполняется resync файлов карточки.
4. Где хранится и обновляется связь файлов с карточкой.
5. Где участвует или должен участвовать `card.rev`.
6. Где обеспечивается duplicate `PARTS_DOCS` rule.
7. Где есть side effects для input control и соседних сценариев.
8. Какие UI-сценарии Stage 5 можно перевести без начала Stage 6.

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Карта current card files read/write paths.
2. Что уже соответствует Stage 5.
3. Где file-domain еще зависит от `/api/data`.
4. Где граница между Stage 5 и Stage 6.
5. Какой batch нужно делать первым.
6. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только делает аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой карточку с файлами.
2. Проверь, что список файлов открывается как раньше.
3. Убедись, что после аудита ничего само не поменялось.
