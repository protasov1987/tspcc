# Stage 3 Batch 6

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
добить `/cards` list/query cutover и compatibility с derived views после migration create/update/delete/archive/repeat.

Цель:
- cards core уже должен жить через отдельный API
- теперь нужно убедиться, что:
  - `/cards`
  - `/cards/:id`
  - `/card-route/:qr`
  - `/cards/new`
  корректно переживают local refresh и не зависят как primary read-path от aggregated `/api/data`
- при этом derived views должны остаться совместимыми без отдельной миграции их домена

Что нужно сделать:
1. Перевести `/cards` list/query на cards core read-path, если после предыдущих batches там еще остался primary read через aggregated snapshot.
2. Проверить route-local refresh карточки после create/update/archive/delete/repeat.
3. Убедиться, что cards core cutover не ломает:
   - `/workorders`
   - `/archive`
   - `/items`
   - `/ok`
   - `/oc`
   в их текущем business-смысле.
4. Допустим только минимальный compatibility layer:
   - синхронизация нужного card state в shared client model
   - минимальные adapters для derived views
5. Не переходить в Stage 4/5 и не переписывать derived views как отдельный домен.

Что нельзя делать:
- не менять approval/file logic
- не переписывать derived views целиком
- не менять их business-семантику
- не возвращать cards routes обратно на `/api/data` как primary source of truth

После изменений обязательно проверить:
- `/cards` list/query больше не живет как primary read на aggregated `/api/data`
- route-local refresh карточки работает
- derived views не потеряли согласованность после core cards migration
- archive/repeat semantics сохранены

Что сделать с тестами:
- если dedicated E2E на `/cards` list/query после cutover еще нет, добавь его в этом batch
- минимум нужен automated check на:
  - открытие `/cards`
  - корректное отображение списка после одного из core writes
  - smoke compatibility для `/archive` и `/workorders`
- для `/items`, `/ok`, `/oc` добавь smoke/assertions только если фикстуры стабильны; если нет, явно зафиксируй почему это оставлено на финальный Stage 3 closeout

Формат ответа:
1. Какие compatibility проблемы нашел после cards core cutover.
2. Что именно добил в `/cards` list/query и adapters.
3. Какие automated checks добавил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Список карточек и совместимость связанных экранов доведены после перехода на core API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/cards`.
2. Убедись, что список карточек отображается нормально.
3. Открой одну карточку из списка.
4. Выполни одно безопасное действие, которое уже было переведено ранее, например сохранение безопасного поля или archive/repeat на тестовой карте.
5. Вернись в `/cards` и проверь, что список обновился корректно.
6. Нажми `F5` на карточке.
7. Убедись, что открывается та же карточка.
8. Открой `/archive`.
9. Если архивная карточка есть:
   - архив все еще отображается нормально
10. Открой `/workorders`, `/items`, `/ok`, `/oc`, если они доступны:
   - страницы должны открываться как раньше
   - не должно быть пустых или сломанных состояний только из-за cards core migration
11. Если после cards core migration связанные страницы перестали отображать карточки нормально, batch не закрыт.
