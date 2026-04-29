# Stage 8 Batch 3

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
- Это Stage 8: Migrate Production Planning Layer.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 9 и дальше:
  - не делать workspace/execution migration
  - не делать derived views migration
  - не делать messaging / realtime migration
- Нельзя заново переписывать Stage 1-7 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для planning-layer consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 8:
перевести production schedule writes на explicit planning API и аккуратно
дожать уже существующий production plan API там, где audit выявил недобор.

Цель:
- убрать production schedule writes с snapshot-save
- не переписывать заново production plan, который уже использует
  `/api/production/plan/commit` и `/api/production/plan/auto`
- сохранить / усилить targeted refresh для `/production/plan`, если audit
  Batch 2 показал недостающие response/check pieces
- сохранить planning math и business semantics
- обеспечить targeted refresh вместо полной перезагрузки

Что нужно сделать:
1. Найти server-side и client-side flow для production schedule и plan.
2. Перевести schedule core writes на explicit planning API:
   - add employees to schedule cell
   - delete assignment / delete day-column assignments
   - paste employee / cell / day schedule clipboard
3. Для production plan не делать full rewrite; проверить и при необходимости
   минимально добить существующие paths:
   - manual add via shift plan modal
   - remove task
   - drag/move task
   - auto-plan dry-run/save
   - targeted response `card + tasksForCard + affectedCells`
   - validation/conflict envelope from Batch 2
4. Сохранить обязательные правила:
   - planning validations
   - существующую math и доменный смысл
   - targeted production slice update
5. Обеспечить route-local refresh для `/production/schedule` и `/production/plan`.
6. Не переносить сюда execution-side действия из Stage 9.

Что нельзя делать:
- не менять planning math
- не ломать существующие визуальные и бизнес-инварианты planning-side
- не строить корректность на local shadow state
- не смешивать этот batch с shifts/gantt больше, чем строго нужно
- не переносить shift lifecycle / shift-close в этот batch
- не превращать уже работающий plan API в новый несовместимый API

После изменений обязательно проверить:
- planning writes schedule/plan больше не зависят от snapshot-save
- targeted slice update работает
- route не теряется после save/error
- `rg "saveData\\(" js/app.75.production.js` больше не показывает schedule
  assignment writes, но может ещё показывать shifts/shift-close до Batch 4
- `/production/plan` по-прежнему открывает modal, add/remove/move/auto-plan не
  теряют route

Формат ответа:
1. Какие schedule paths перевел.
2. Что именно сохранил из planning semantics.
3. Что именно проверил/добил в уже существующем plan API.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "План и расписание производства переведены на отдельный planning API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/production/schedule`.
2. Выполни одно безопасное планировочное действие, если у тебя есть права.
3. Проверь:
   - действие сохранилось
   - маршрут не потерялся
   - после `F5` состояние осталось
4. Открой `/production/plan`.
5. Выполни одно безопасное действие планирования.
6. Проверь:
   - экран не улетел на другой маршрут
   - данные обновились без полной поломки страницы
7. Если после действия planning-экран ломается или теряет маршрут, batch не закрыт.
