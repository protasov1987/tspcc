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
ввести client-side cards core layer и перевести на него card detail/create/update routes без затрагивания delete/archive/repeat.

Цель:
- перевести первоочередные Stage 3 сценарии, найденные аудитом:
  - `/cards/new`
  - `/cards/:id`
  - `/card-route/:qr`
  - create
  - update
  - detail fetch
- не трогать пока delete/archive/repeat, потому что это отдельный batch
- сохранить route stability и текущий UI смысл карточки

Что нужно сделать:
1. Найти лучшее место для cards client facade / service / action layer.
2. Перевести через него:
   - detail fetch по `id` и `qr`
   - create draft card
   - generic update existing card
3. Перевести `saveCardDraft()` и связанные detail-route сценарии с `saveData()` на новый cards core API.
4. Сохранить временную совместимость с остальным приложением:
   - если derived views и live patches еще зависят от глобального `cards[]`, допустим минимальный adapter
   - но source of truth для этих Stage 3 сценариев должен уже быть новый cards core path
5. Сохранить current route behavior:
   - `/cards/new`
   - `/cards/:id`
   - `/card-route/:qr`
6. Не трогать:
   - `/cards` list/query как отдельный primary read cutover
   - delete
   - archive
   - repeat
   - approvals
   - files
   - input control
   - provision

Что нельзя делать:
- не делать полный rewrite всего cards UI
- не начинать Stage 4/5
- не ломать derived production views
- не оставлять create/update на `saveData()` для этих переведенных routes

После изменений обязательно проверить:
- `/cards/new`, `/cards/:id`, `/card-route/:qr` работают через новый cards layer
- create/update больше не идут через `saveData()` в этих core-сценариях
- detail fetch больше не зависит только от заранее загруженного `cards[]`
- route не теряется после create/update и после `F5`

Что сделать с тестами:
- в этом batch уже нужен dedicated Playwright E2E для Stage 3 success-path
- если подходящего теста нет, добавь отдельный spec, а не перегружай `00.auth-routes` и `01.pages-and-modals-smoke`
- минимальный обязательный охват:
  - direct open `/cards/:id`
  - open `/cards/new`
  - create success-path
  - update success-path
  - `F5`/direct URL stability на detail route

Формат ответа:
1. Где именно внедрил cards client layer.
2. Какие detail/create/update сценарии уже переведены.
3. Какие E2E или automated checks добавил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Маршруты создания и редактирования карточек переведены на отдельный core API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/cards/new`.
2. Убедись, что форма создания открывается нормально.
3. Если безопасно, создай новую тестовую карточку.
4. После создания проверь:
   - маршрут не улетел на `/dashboard`
   - открылась новая карточка или корректный detail route
5. Открой существующую карточку по прямому URL `/cards/<id или qr>`.
6. Измени одно безопасное поле и сохрани.
7. Проверь:
   - ты остался на карточке
   - `F5` открывает ту же карточку
   - не появилось грубых ошибок
8. Если create/update/detail route стали нестабильными, batch не закрыт.
