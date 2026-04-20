# Stage 5 Batch 2

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
подготовить server-side file-domain contract карточки с revision-safe правилами.

Цель:
- перевести file operations карточки на отдельный server contract
- встроить `expectedRev -> new cardRev`
- не ломая текущий UX и соседние домены

Что нужно сделать:
1. Добавить или выделить серверные handlers / endpoints для:
   - file upload
   - file delete
   - file resync
2. Для каждой file operation встроить contract:
   - клиент передает `expectedRev`
   - сервер проверяет текущий `card.rev`
   - при конфликте возвращается `409`
   - при успехе возвращается новый `cardRev`
3. Сохранить card/file consistency в одной доменной операции.
4. Сохранить duplicate `PARTS_DOCS` rule.
5. Не переносить сюда directories/security/production.

Что нельзя делать:
- не менять business meaning карточки
- не ломать существующие file types
- не убирать проверки, которые защищают от дублей или расхождения card/file state
- не делать client cutover в этом batch больше, чем строго нужно

После изменений обязательно проверить:
- upload/delete/resync поддерживают revision-safe contract
- успешная операция возвращает новый `cardRev`
- stale revision дает `409`
- duplicate `PARTS_DOCS` guard сохранен

Формат ответа:
1. Какие server-side file endpoints или handlers добавил/выделил.
2. Как именно теперь работает `expectedRev -> cardRev`.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлен серверный контракт файлов карточек с проверкой ревизии"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой карточку с файлами.
2. Попробуй загрузить один безопасный тестовый файл.
3. Проверь:
   - файл появился в карточке
   - карточка не закрылась
   - маршрут не потерялся
4. Если есть уже загруженный тестовый файл:
   - попробуй удалить его
5. Проверь, что удаление тоже работает без скачка на другой экран.
6. Если upload или delete сразу сломались, batch не закрыт.
