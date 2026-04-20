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
ввести client-side cards facade/read model для cards core без полной миграции соседних доменов.

Цель:
- убрать прямую зависимость UI cards core от global snapshot model
- ввести явный cards client layer для:
  - list/query
  - detail fetch
  - create/update/delete/archive/repeat calls
  - route-local refresh

Что нужно сделать:
1. Найти лучшее место для cards client facade.
2. Перевести cards core UI на этот слой настолько, насколько нужно для Stage 3.
3. Сохранить current route behavior:
   - `/cards`
   - `/cards/new`
   - `/cards/:id`
   - `/card-route/:qr`
4. Не тащить в cards facade:
   - approvals
   - input control
   - provision
   - card files
5. Обеспечить route-safe behavior и targeted refresh hooks.

Что нельзя делать:
- не переписывать весь cards UI целиком без необходимости
- не трогать Stage 4/5 functionality
- не ломать derived production views

После изменений обязательно проверить:
- cards list грузится через новый cards layer
- card detail грузится через новый cards layer
- create/update core сценарии больше не завязаны напрямую на `/api/data`
- route-local refresh карточки возможен без full app reload

Формат ответа:
1. Где именно внедрил cards facade/read model.
2. Какие UI-сценарии уже переведены.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Карточки переведены на отдельный клиентский слой для core-сценариев"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/cards`.
2. Убедись, что список карточек отображается как раньше.
3. Открой одну карточку по клику из списка.
4. Обнови страницу `F5` на карточке.
5. Убедись, что открывается та же карточка, а не `/dashboard`.
6. Открой `/cards/new`, если такой сценарий у тебя есть.
7. Создай черновик карточки или открой форму создания.
8. Проверь, что:
   - переходы внутри cards продолжают работать
   - после сохранения или открытия route не теряется
   - карточка открывается по прямому URL
9. Если список или detail карточки начал открываться нестабильно, batch не закрыт.
