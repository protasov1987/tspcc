# Stage 8 Batch 6

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
удалить остаточные planning writes с snapshot-save path и добить validations/conflict behavior.

Цель:
- завершить cutover planning-side production на explicit domain API
- убрать оставшиеся planning writes с `/api/data` и `saveData()`
- убедиться, что validations и conflict UX работают безопасно

Что нужно сделать:
1. Повторить audit поиска legacy writes:
   - `rg "saveData\\(" js/app.75.production.js`
   - `rg "/api/data|LEGACY_SNAPSHOT_SAVE_PATH" js server.js`
   - проверить, что найденные calls не являются in-scope planning writes
2. Найти оставшиеся planning write-path на snapshot-save.
3. Удалить или отключить их только после полного перевода на новые planning commands.
4. Добить validations/conflict behavior:
   - понятное сообщение
   - сохранение route
   - targeted refresh
5. Проверить реальные two-tab / multi-client сценарии, а не только mocked 409:
   - schedule assignment conflict
   - plan add/move/remove or auto-plan conflict
   - shift lifecycle conflict
   - shift-close finalize conflict
6. Убедиться, что planning write ни в одном in-scope сценарии не уходит в общий snapshot.
7. Не начинать Stage 9.

Что нельзя делать:
- не удалять legacy path раньше времени
- не ломать planning semantics ради cleanup
- не начинать execution migration
- не переписывать unrelated production UI
- не считать Stage 8 закрытым, если остался хотя бы один in-scope planning
  write через `/api/data`

После изменений обязательно проверить:
- planning writes больше не идут через snapshot-save
- validations и conflict UX не потеряны
- targeted production slice updates реально используются
- route-local refresh подтвержден для list/detail/deeplink planning routes:
  `/production/schedule`, `/production/plan`, `/production/shifts`,
  `/production/shifts/:key`, `/production/gantt/:card`

Формат ответа:
1. Какие snapshot-based planning paths убрал.
2. Что именно добил в validations/conflict behavior.
3. Результат audit-команд по остаточным `saveData()` / `/api/data`.
4. Какие two-tab / multi-client сценарии проверил.
5. Какие сценарии проверил автоматически.
6. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
7. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Удалены snapshot-пути планирования и улучшена обработка конфликтов в planning-layer"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/production/plan`.
2. Выполни одно безопасное планировочное действие.
3. После действия проверь:
   - ты остался на том же маршруте
   - данные обновились
4. Если есть сценарий ошибки или запрета валидации:
   - попробуй его воспроизвести
   - должно быть понятное сообщение
   - экран не должен ломаться
5. Если можешь, открой тот же planning-экран в двух вкладках и попробуй воспроизвести конфликт.
6. Конфликт не должен тихо перетирать данные или выбрасывать на другой экран.
