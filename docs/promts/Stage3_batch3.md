# Stage 3 Batch 3

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
добавить server-side cards core actions для delete, archive и repeat без затрагивания Stage 4/5.

Цель:
- перенести core lifecycle actions карточки на отдельный server domain API
- сохранить текущие business-rules:
  - archive is archive
  - repeat создает новую draft-card
  - delete чистит связанные core side effects, не ломая production context

Что нужно сделать:
1. Добавить или выделить серверные actions для:
   - delete
   - archive
   - repeat / duplicate
2. Для write operations использовать:
   - `expectedRev`
   - `409 Conflict`
   - `card.rev`
3. Сохранить текущие правила:
   - archive не равен delete
   - repeat создает новую draft-сущность
   - delete не оставляет осиротевшие core references
4. Не трогать:
   - approvals
   - files
   - input control
   - provision

Что нельзя делать:
- не разархивировать карту вместо repeat
- не менять смысл archive/delete
- не ломать derived production views

После изменений обязательно проверить:
- archive работает как раньше по бизнес-смыслу
- repeat создает новую draft-карту
- delete не ломает cards list/detail
- stale revision на этих действиях корректно дает `409`

Формат ответа:
1. Какие server-side actions добавил/изменил.
2. Какие business-rules сохранил явно.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Переведены core-действия карточек archive repeat delete на серверный API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/cards`.
2. Выбери тестовую карточку, которую безопасно использовать.
3. Проверь archive:
   - отправь карточку в архив
   - она должна исчезнуть из активного списка
   - но не должна вести себя как удалённая совсем
4. Открой архивный раздел, если он у тебя есть в интерфейсе:
   - карточка должна там появиться
5. Проверь repeat:
   - повтор из архива должен создать новую карточку-черновик
   - старая архивная карточка не должна “превратиться” в новую
6. Проверь delete только если у тебя есть безопасная тестовая карточка:
   - удаление не должно ломать список карточек
   - после удаления не должно быть битого перехода или пустого сломанного экрана
7. Если archive/repeat/delete поменяли смысл, batch не закрыт.
