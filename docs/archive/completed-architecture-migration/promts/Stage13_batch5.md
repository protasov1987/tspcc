# Stage 13 Batch 5

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
- Это Stage 13: Remove Legacy Snapshot and Transitional Overlaps.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 14:
  - не делать final diagnostics/E2E/perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-12 целиком.
- Допустимо убирать только ту legacy-переходность, которая уже реально заменена новой моделью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 13:
удалить route/write/live overlaps и shadow correctness hacks только там, где
Batch 2-4 уже подтвердили replacement.

Цель:
- убрать переходные overlaps, которые остались после удаления critical
  snapshot writes
- не удалять live fallback, который нужен для Stage 12 correctness proof
- не превращать cleanup в perf/refactor Stage 14

Что нужно сделать:
1. Повторно проверить overlap зоны:
   - `js/app.00.state.js` live direct patch + targeted refresh + fallback refresh
   - `js/app.40.store.js` local global arrays / scoped loading / cards-core store
   - `js/app.70.render.cards.js` active draft / modal stale handling
   - `js/app.75.production.js` planning layout legacy localStorage migration
   - `js/app.81.navigation.js` route compatibility helpers
2. Классифицировать каждый overlap:
   - primary path to keep
   - legacy/overlap path to remove
   - safety fallback to keep temporarily
   - out-of-scope receipts / non-critical compatibility
3. Удалять только доказанно лишнее:
   - duplicate write fallback after domain command success
   - dead compatibility helper after no callers
   - stale local shadow update that can silently diverge from server truth
4. Не удалять:
   - cards/prod/directories/security live fallback refresh
   - `pending` UI state used only as disabled/spinner UX
   - localStorage production areas layout one-time migration unless server layout
     proof exists and tests cover it
5. Сохранить:
   - conflict behavior
   - targeted refresh
   - route stability
   - real two-tab / multi-client safety where action-capable

Что нельзя делать:
- не ломать полезный короткий pending UX
- не убирать live fallback без replacement and proof
- не возвращать correctness в клиент как source of truth
- не смешивать cleanup с performance-оптимизациями
- не редактировать receipts как домен

После изменений обязательно проверить:
- correctness больше не держится на shadow/local snapshot hacks
- pending UI остается только UX-слоем
- server-truth и refresh behavior сохраняются
- no silent close / no silent no-op in modal/dialog/side-panel confirm paths

Формат ответа:
1. Какие конкретные route/write/live/shadow overlaps убрал.
2. Что оставил как safety fallback или UX pending и почему.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Удалены лишние route write live overlap и shadow-state костыли"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Выполни одно безопасное действие, которое раньше показывало pending.
2. Проверь:
   - индикатор pending может появиться
   - но после `F5` итоговое состояние совпадает
   - экран не живет в «локальной фантазии»
3. Открой тот же сценарий во второй вкладке, если возможно, и проверь, что
   stale-действие дает понятное сообщение/refresh.
4. Если после обновления страницы состояние отличается от того, что показывал UI, batch не закрыт.
