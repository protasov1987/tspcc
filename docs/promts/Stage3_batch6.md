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
добить route-local refresh и cards-core compatibility с derived views после client/server cutover.

Цель:
- cards core уже должен жить через отдельный API
- теперь нужно убедиться, что:
  - `/cards`
  - `/cards/:id`
  - `/card-route/:qr`
  - `/cards/new`
  корректно переживают local refresh и не ломают derived views

Что нужно сделать:
1. Проверить route-local refresh карточки после create/update/archive/delete/repeat.
2. Убедиться, что cards core cutover не ломает:
   - `/workorders`
   - `/archive`
   - `/items`
   - `/ok`
   - `/oc`
   в их текущем business-смысле.
3. Внести только минимальные compatibility fixes, если они нужны.
4. Не переходить в Stage 4/5.

Что нельзя делать:
- не менять approval/file logic
- не переписывать derived views целиком
- не менять их business-семантику

После изменений обязательно проверить:
- route-local refresh карточки работает
- derived views не потеряли согласованность после core cards migration
- archive/repeat semantics сохранены

Формат ответа:
1. Какие compatibility проблемы нашел после cards core cutover.
2. Что именно добил.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Доведена совместимость карточек после перехода на отдельный core API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/cards`.
2. Открой карточку.
3. Измени безопасное поле и сохрани.
4. Не уходя с маршрута, убедись, что карточка обновилась корректно.
5. Нажми `F5` на карточке.
6. Убедись, что открывается та же карточка.
7. Открой `/archive`.
8. Если архивная карточка есть:
   - проверь, что архив все еще отображается нормально
9. Открой `/workorders`, `/items`, `/ok`, `/oc`, если эти страницы доступны:
   - они должны открываться как раньше
   - не должно быть пустых или сломанных состояний только из-за миграции cards core
10. Если после cards core migration связанные страницы перестали отображать карточки нормально, batch не закрыт.
