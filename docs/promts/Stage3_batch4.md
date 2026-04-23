# Stage 3 Batch 4

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
Нужно реализовать только один batch Stage 3:
добить conflict-control и targeted refresh для generic card edit после client cutover detail/create/update routes.

Цель:
- после Batch 3 обычное редактирование карточки уже должно ходить в новый API
- теперь нужно довести Stage 3 contract до target-state для edit conflict-path:
  - `expectedRev`
  - `409 Conflict`
  - stay on current card route
  - targeted refresh текущей карточки
- не переносить сюда delete/archive/repeat и не смешивать с Stage 4/5

Что нужно сделать:
1. Найти все create/update code paths cards core, где:
   - `expectedRev` еще не передается
   - conflict молча теряется
   - локальное mutable state остается источником истины дольше, чем нужно
2. Довести update-path до явного revision-safe поведения.
3. После `409` обеспечить:
   - понятное user-safe сообщение
   - сохранение текущего маршрута `/cards/:id` или `/card-route/:qr`
   - targeted refresh текущей карточки и нужного list/detail state
4. Не использовать full app reload как единственный способ восстановить UI после конфликта.
5. Если нужен reuse shared Stage 2 foundation, использовать его, а не изобретать второй conflict pipeline.

Что нельзя делать:
- не переносить delete/archive/repeat в этот batch
- не трогать approvals/input control/provision/files
- не ломать текущий detail route карточки
- не придумывать fake conflict для create, если реальный сценарий касается update

После изменений обязательно проверить:
- stale generic card update дает `409`
- после конфликта пользователь остается на том же card route
- targeted refresh реально подтягивает актуальную карточку с сервера
- update success-path не деградировал после добавления conflict-control

Что сделать с тестами:
- здесь обязателен dedicated Playwright E2E на conflict-path
- если подходящего spec еще нет, создай отдельный Stage 3 spec для multi-tab / two-page stale update scenario
- минимум проверить:
  - одна и та же карточка открыта в двух вкладках
  - первая вкладка успешно сохраняет
  - вторая получает `409`
  - маршрут сохраняется
  - актуальное состояние карточки подтягивается без full reload

Формат ответа:
1. Как теперь работает conflict-path generic card edit.
2. Где именно добавлен targeted refresh после `409`.
3. Какие automated checks добавил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлена обработка конфликтов ревизий для редактирования карточек"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой одну и ту же карточку в двух вкладках браузера.
2. В первой вкладке измени одно безопасное поле и сохрани.
3. Во второй вкладке, не обновляя страницу, попробуй сохранить старую версию карточки.
4. Проверь:
   - есть понятное сообщение о конфликте
   - ты остался на той же карточке
   - страница не улетела на `/dashboard`
   - после конфликта отображается актуальная версия карточки
5. Если конфликт тихо перетирает данные или ломает маршрут, batch не закрыт.
