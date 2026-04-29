# Stage 6 Batch 2

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
- Это Stage 6: Migrate Directories.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 7 и дальше:
  - не делать security migration
  - не делать production migration
  - не делать messaging migration
- Нельзя заново переписывать Stage 3/4/5 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для directory-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только первый прикладной batch Stage 6 по итогам аудита:
перевести core directory writes на отдельные domain API для:
- departments / centers
- operations
- operation-area bindings
- areas

Цель:
- убрать самый крупный и "чистый" кусок snapshot-writes из `/api/data`
- создать минимально достаточный server/client contract именно для core directories
- не смешивать этот batch с employees assignment, shift times, Stage 7 и Stage 8

Что нужно сделать:
1. Найти и перевести с snapshot path все write-сценарии для:
   - create / update / delete departments
   - create / update / delete operations
   - add / remove operation-area bindings
   - create / update / delete areas
2. Ввести для этих сценариев explicit domain API и server-side helpers:
   - permission checks
   - revision / conflict check с понятным rejected-command path
   - targeted response по измененному directory slice
3. Сохранить уже существующие business protections:
   - department delete guard
   - operation type guard
   - historical text preservation для карточек и связанных данных
   - совместимость areas с текущими production readers
4. Убрать hidden `return` / silent no-op там, где action действительно выполняется,
   или сделать local invalid-state path явно понятным пользователю.
5. Обеспечить route-safe refresh без redirect:
   - `/departments`
   - `/operations`
   - `/areas`
6. Добавить автоматические проверки по реальным flow, а не только по искусственному `409`.

Что нельзя делать:
- не трогать employees assignment
- не трогать shift times
- не начинать users / access levels migration
- не менять production business logic
- не придумывать detail/deeplink routes там, где сейчас есть только list route
- не оставлять working write-path через `/api/data` для этих четырех subdomain

После изменений обязательно проверить:
- departments / operations / operation-area bindings / areas больше не пишут через `saveData()` и `/api/data`
- server-side conflict path существует и отдает понятный результат
- local invalid-state path не маскируется в silent no-op
- two-tab proof есть хотя бы для list routes `/departments`, `/operations`, `/areas`

Формат ответа:
1. Какие core directory paths перевел с snapshot path.
2. Где включены permission / revision / conflict rules.
3. Какие business guards и compatibility points сохранил.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Справочники подразделений, операций и участков переведены на доменные API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой по отдельности:
   - `/departments`
   - `/operations`
   - `/areas`
2. На каждом экране выполни одно безопасное изменение и сохрани.
3. Проверь:
   - маршрут не потерялся
   - после `F5` данные не пропали
   - нет redirect на другой экран
4. На `/operations` отдельно проверь добавление и удаление привязки участка к операции.
5. Если есть возможность, открой один и тот же экран в двух вкладках и попробуй конкурентное изменение.
6. Если одно из действий молча "ничего не сделало" без понятного сообщения или экран сломался, batch не закрыт.
