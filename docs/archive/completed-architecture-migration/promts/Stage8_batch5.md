# Stage 8 Batch 5

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
довести client-side planning UI до targeted refresh и route-local behavior без heavy local shadow state.

Audit baseline из Stage8_batch1:
- `productionScheduleState` и `productionShiftsState` содержат допустимые
  UI-настройки, но не должны быть источником истины после write
- старые paths мутировали `productionSchedule`, `productionShifts`,
  `productionShiftTasks` локально и затем делали `saveData()`
- после Batch 3/4 новые writes должны применять server response, а не
  доказывать корректность локальной мутацией

Цель:
- убрать зависимость корректности planning UI от локальных shadow/pending моделей
- сохранить responsive UX без потери server-truth
- обеспечить route-local refresh на planning pages

Что нужно сделать:
1. Найти client-side точки, где planning-side correctness держится на local shadow state.
2. Заменить их на:
   - targeted refresh нужного production slice
   - безопасный pending UX как чисто UI-слой
   - route-local refresh
3. Явно разделить:
   - допустимый UI-only state: selected cell/card, week, visible columns,
     filters, scroll/focus
   - недопустимый correctness state: локально созданные schedule/tasks/shifts,
     которые считаются сохраненными до server ack
4. Проверить open/confirm/local-invalid/server-rejected paths для:
   - schedule assignment actions
   - plan modal add/remove/move/auto-plan
   - shifts board actions
   - shift-close detail actions
   - gantt open/read refresh
5. Сохранить текущий смысл planning UI.
6. Не переписывать execution-side production.
7. Не ломать existing planning calculations и validations.

Что нельзя делать:
- не строить новую correctness модель на еще более сложных pending caches
- не ломать existing routes
- не менять business meaning planning pages
- не начинать Stage 9
- не удалять UI-only state, который нужен для UX, если он не участвует в
  server-truth correctness

После изменений обязательно проверить:
- local shadow state больше не является основой корректности
- route-local refresh работает на planning pages
- UI остается предсказуемым после success/error/conflict
- no-request/local-invalid paths показывают понятное сообщение и не закрывают
  контекст молча
- server rejected/conflict paths делают targeted refresh и сохраняют route

Формат ответа:
1. Какие client-side planning paths добил.
2. Что именно изменил в refresh/pending behavior.
3. Какие local-invalid/no-request и server-rejected/conflict paths проверил.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Planning UI переведен на targeted refresh без опоры на локальную shadow-state модель"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой `/production/plan`.
2. Выполни одно безопасное планировочное действие.
3. Проверь:
   - UI обновился понятно
   - не осталось ощущения, что страница показывает старую «локальную фантазию»
   - после `F5` состояние совпадает
4. Повтори на `/production/schedule` или `/production/shifts`.
5. Если после ошибки или отказа UI остается в неверном состоянии, batch не закрыт.
