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
подготовить server-side cards core API foundation для list/detail/create/update без client cutover соседних сценариев.

Цель:
- создать отдельный cards core server API вместо опоры на aggregated `/api/data`
- заложить server-truth модель для cards core reads и generic create/update
- не затрагивать approvals/input control/provision/files/delete/archive/repeat как user-visible migration

Что нужно сделать:
1. Добавить или выделить серверные cards core endpoints / handlers для:
   - list/query
   - detail fetch
   - create
   - update
2. Для update встроить Stage 2 contract:
   - `id`
   - `rev`
   - `expectedRev`
   - `409 Conflict`
3. Для create вернуть точный серверный результат карточки с актуальным `rev`.
4. Ответы cards core API должны возвращать domain result, а не весь snapshot сайта.
5. Не переносить сюда:
   - delete
   - archive
   - repeat
   - approval lifecycle
   - file operations
   - input control
   - provision
6. Сохранить текущую business-семантику карточки:
   - create draft card
   - generic edit semantics
   - current card fields
7. Если уже есть полезные server helpers из Stage 2, использовать их.
8. Не ломать существующие snapshot flows до фактического client cutover в следующих batches.

Что нельзя делать:
- не менять stage semantics approval
- не трогать card files
- не менять production business logic
- не начинать client migration `/cards` UI в этом batch

После изменений обязательно проверить:
- новые cards core endpoints работают
- create/update дают корректный revision-safe ответ
- detail/list отдают card-domain payload, а не полный snapshot
- `card.rev` увеличивается при успешной записи
- stale revision дает `409`

Что сделать с тестами:
- если новые handlers можно стабильно проверить автоматически без UI cutover, добавь focused automated test
  через Playwright request context или другой уже используемый инструмент проекта
- если такого теста сейчас делать неразумно, это допустимо только при явном объяснении, почему user-visible E2E
  переносится на Batch 3/4
- не раздувай `tests/e2e/00.auth-routes.spec.js` и `tests/e2e/01.pages-and-modals-smoke.spec.js` server-only кейсами

Формат ответа:
1. Какие server-side cards core endpoints добавил или выделил.
2. Что именно теперь поддерживает revision-safe contract.
3. Какие automated checks добавил или почему отложил их до следующего batch.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлен серверный API карточек с поддержкой ревизий для core-операций"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна, но легкая: client behavior в этом batch еще может оставаться прежним.

### Чек-лист для чайника

1. Открой `/cards`.
2. Убедись, что список карточек открывается как раньше.
3. Открой одну карточку.
4. Если есть безопасный тестовый сценарий, открой форму создания или редактирования карточки.
5. После обычного открытия проверь:
   - страница не улетела на `/dashboard`
   - карточка открылась как раньше
   - не появилось грубых ошибок
6. Если после batch обычное открытие списка или карточки сломалось, batch не закрыт.
