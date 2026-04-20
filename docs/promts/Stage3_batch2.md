# Stage 3 Batch 2

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
подготовить server-side cards core API foundation для чтения и базового revision-safe write contract.

Цель:
- создать отдельный cards core server API вместо опоры на aggregated `/api/data`
- не затрагивая approvals/input control/provision/files

Что нужно сделать:
1. Добавить или выделить серверные cards core endpoints / handlers для:
   - list/query
   - detail fetch
   - create
   - update
2. Для create/update встроить Stage 2 contract:
   - `id`
   - `rev`
   - `expectedRev`
   - `409 Conflict`
3. Не переносить сюда:
   - approval lifecycle
   - file operations
   - input control
   - provision
4. Сохранить текущую business-семантику карточки:
   - create draft card
   - generic edit semantics
   - current card fields
5. Если уже есть полезные server helpers из Stage 2, использовать их.

Что нельзя делать:
- не менять stage semantics approval
- не трогать card files
- не менять production business logic
- не ломать существующие snapshot flows до фактического client cutover

После изменений обязательно проверить:
- новые cards core endpoints работают
- create/update дают корректный revision-safe ответ
- `card.rev` увеличивается при успешной записи
- stale revision дает `409`

Формат ответа:
1. Какие server-side cards core endpoints добавил или выделил.
2. Что именно теперь поддерживает revision-safe contract.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлен серверный API карточек с поддержкой ревизий для core-операций"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой `/cards`.
2. Убедись, что список карточек открывается как раньше.
3. Открой одну карточку.
4. Если есть безопасный тестовый сценарий:
   - создай новую карточку
   - или измени одно неопасное поле в существующей карточке
5. После сохранения проверь:
   - страница не улетела на `/dashboard`
   - карточка открылась/осталась на своем месте
   - не появилось грубых ошибок
6. Если после batch обычное открытие списка или карточки сломалось, batch не закрыт.
