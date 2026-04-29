# Stage 3 Batch 1

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
- Это Stage 3: Migrate Cards Core.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 4 и Stage 5:
  - не трогать approvals как отдельный домен
  - не трогать input control
  - не трогать provision
  - не трогать card files как домен
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно не повторять общий аудит с нуля, а перепроверить и зафиксировать как рабочую основу
уже полученные выводы Stage 3 audit для `Stage 3. Migrate Cards Core`.

Пока НЕ вноси изменения в код.
Нужно только:
1. Перепроверить по коду и подтвердить как принятые следующие audit findings:
   - create/update сейчас идут через `saveCardDraft()` с локальной мутацией `cards[]` и `saveData()`
   - delete идет через `confirmDeletion()` с локальной чисткой `cards[]` и `productionShiftTasks[]`, затем `saveData()`
   - archive как write-path сейчас живет в derived view (`js/app.73.receipts.js`) через `card.archived = true` + `saveData()`
   - repeat / duplicate не пишет на сервер сразу, а только готовит draft; финальная запись потом снова идет через `saveCardDraft()`
   - cards list/query сейчас живет на `GET /api/data?scope=cards-basic` и `GET /api/cards-live`
   - card detail сейчас открывается из уже загруженного `cards[]`; отдельного `GET /api/cards/:id` или эквивалента для cards core еще нет
   - `card.rev` уже существует в `db.js` и live-path, но generic cards writes еще не используют обязательный `expectedRev -> 409`
2. Зафиксировать точную границу Stage 3 против соседних этапов:
   - Stage 4: send to approval, approve/reject, return rejected to draft, input control, provision
   - Stage 5: upload/delete/resync card files и file-linked side effects
   - Stage 10: derived views `/workorders`, `/archive`, `/items`, `/ok`, `/oc` не переписывать как отдельный домен, только минимальные adapters когда это строго нужно
3. Подтвердить точный рабочий порядок Stage 3 batches 2-7 по результатам аудита:
   - Batch 2: server-side cards core API foundation для list/detail/create/update
   - Batch 3: client cutover для `/cards/new`, `/cards/:id`, `/card-route/:qr`, create/update/detail fetch
   - Batch 4: stale update conflict-path и targeted card refresh без потери route
   - Batch 5: delete/archive/repeat cutover
   - Batch 6: list/query cutover для `/cards` и compatibility с derived views
   - Batch 7: final Stage 3 closeout
4. Отдельно оценить текущее E2E покрытие Stage 3 и зафиксировать gaps:
   - `tests/e2e/00.auth-routes.spec.js` покрывает route/bootstrap, но не cards core writes
   - `tests/e2e/01.pages-and-modals-smoke.spec.js` покрывает только smoke открытия модалок, но не create/edit/delete/archive/repeat/conflict
   - dedicated Stage 3 E2E для create/edit/delete/archive/repeat/conflict сейчас отсутствуют
5. Составить точную карту, в каком batch какие E2E должны появиться или быть обновлены.

Что нужно проверить обязательно:
- js/app.40.store.js
- js/app.70.render.cards.js
- js/app.00.state.js
- js/app.50.auth.js
- js/app.73.receipts.js
- js/app.74.approvals.js
- js/app.75.production.js
- server.js
- db.js
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нельзя делать:
- не менять код
- не менять docs
- не делать version bump

Формат ответа:
1. Подтвержденные audit findings Stage 3.
2. Точная граница Stage 3 vs Stage 4/5/10.
3. Финальный порядок Stage3_batch2-7.
4. Точная карта E2E gaps и в каком batch их закрывать.
5. Нужна ли ручная проверка прямо сейчас. Если не нужна — так и напиши.
```

## Ручная проверка после Prompt

Не нужна, если ИИ только перепроверяет аудит и ничего не меняет.

Если хочешь быстро перестраховаться:

1. Открой `/cards`.
2. Открой одну карточку.
3. Убедись, что после перепроверки ничего само не поменялось.
