# Stage 8 Batch 4

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
перевести production shifts и shift-close на explicit planning API, сохранив
gantt как route-safe read/detail view.

Цель:
- убрать shifts и shift-close writes с snapshot-save
- сохранить текущий смысл смен и gantt-представления
- не ломать planning-related route stability

Что нужно сделать:
1. Найти server-side и client-side flow для production shifts, shift-close и gantt.
2. Перевести shifts writes на explicit planning API:
   - open shift
   - close shift from board, если этот path ещё существует
   - lock/fix shift
   - unfix shift
3. Перевести shift-close writes на explicit planning API:
   - set/clear row decision draft
   - transfer remaining qty to future shift
   - replan remaining qty
   - finalize shift close with snapshot
4. Проверить и устранить риск дублирующих client definitions для
   `setProductionShiftCloseAction` / `finalizeProductionShiftClose`, если он
   сохраняется после Batch 3.
5. Gantt не считать отдельным write-domain: он должен получать route-local
   refresh после planning mutations и оставаться read/detail view.
6. Сохранить обязательные правила:
   - planning validations
   - targeted production slice update
   - route-local refresh для `/production/shifts` и `/production/gantt/:...`
7. Не переносить сюда Stage 9 execution behavior.
8. Не ломать schedule/plan scenarios, уже переведенные раньше.

Что нельзя делать:
- не менять business meaning shifts
- не ломать existing gantt view semantics
- не делать full production refactor
- не строить корректность на локальных cache-magic обходах
- не переносить workspace/execution actions
- не добавлять fake gantt write endpoint, если write-path отсутствует

После изменений обязательно проверить:
- shifts/shift-close writes больше не зависят от snapshot-save
- route-local refresh работает
- targeted updates не ломают смежные planning pages
- gantt route `/production/gantt/:...` открывается после shift/plan changes и
  не требует F5 для актуального planning view
- `rg "saveData\\(" js/app.75.production.js` больше не показывает in-scope
  schedule/shifts/shift-close planning writes

Формат ответа:
1. Какие shifts/shift-close paths перевел.
2. Что именно сохранил из planning view semantics.
3. Как подтвердил, что gantt остался корректным read/detail route.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Смены и закрытие смен переведены на отдельный planning API производства"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/production/shifts`.
2. Измени одну безопасную настройку смены, если у тебя есть доступ.
3. Проверь:
   - изменения сохранились
   - маршрут не потерялся
   - после `F5` все осталось
4. Открой один gantt-маршрут, если он у тебя используется.
5. Проверь, что gantt открывается и не выглядит сломанным.
6. Если после работы со сменами ломается gantt или наоборот, batch не закрыт.
