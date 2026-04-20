# Stage 5 Batch 6

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
- Это Stage 5: Complete Card Files.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 6 и дальше:
  - не делать directories/security migration
  - не делать production migration
  - не делать messaging migration
- Нельзя заново переписывать Stage 3/4 целиком.
- Допустимо трогать только те места Stage 3/4, которые нужны для file-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 5:
удалить остаточную зависимость card files от snapshot-save path и добить conflict UX.

Цель:
- завершить cutover file-domain карточки на explicit commands
- убрать оставшиеся file writes с `/api/data` и `saveData()`
- убедиться, что conflict behavior безопасен и понятен

Что нужно сделать:
1. Найти оставшиеся upload/delete/resync write-path на snapshot-save.
2. Удалить или отключить их только после полного перевода на новые file commands.
3. Добить conflict UX:
   - понятное сообщение
   - сохранение route
   - точечный refresh карточки
4. Убедиться, что `cardRev` после file операций используется дальше последовательно.
5. Не трогать Stage 6.

Что нельзя делать:
- не удалять legacy path раньше времени
- не ломать старые business rules ради cleanup
- не начинать directories migration
- не переписывать unrelated cards UI

После изменений обязательно проверить:
- file operations больше не идут через `/api/data`
- snapshot-save не является основным write-path для файлов карточки
- conflict не выбрасывает пользователя с карточки

Формат ответа:
1. Какие snapshot-based file paths убрал.
2. Что именно добил в conflict UX и `cardRev` consistency.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Удалены snapshot-пути для файлов карточек и улучшена обработка конфликтов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой карточку с файлами.
2. Выполни по одному тестовому действию:
   - upload
   - delete
   - resync, если доступен
3. После каждого действия проверь:
   - ты остался на той же карточке
   - список файлов обновился правильно
   - маршрут не потерялся
4. Если можешь:
   - открой вторую вкладку с той же карточкой
   - в первой измени файлы
   - во второй попробуй выполнить устаревшее file-действие
5. Во второй вкладке должен быть понятный конфликт, а не тихая перезапись.
6. Если хоть одно file-действие еще ведет себя как старое snapshot-сохранение и ломает маршрут, batch не закрыт.
