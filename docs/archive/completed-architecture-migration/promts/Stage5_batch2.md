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
подготовить revision-safe server-side contract для уже существующих card file write endpoints.

Цель:
- не вводя новую бизнес-логику, сделать upload/delete/resync карточки revision-safe
- встроить `expectedRev -> 409 / updated card payload`
- не менять read-model списка карточек и не тащить сюда Stage 6 / production / receipts migration

Что нужно сделать:
1. Найти и актуализировать именно существующие server endpoints / handlers для:
   - `POST /api/cards/:cardId/files`
   - `DELETE /api/cards/:cardId/files/:fileId`
   - `POST /api/cards/:cardId/files/resync`
2. Для каждой file operation встроить единый contract:
   - клиент передает `expectedRev`
   - сервер проверяет текущий `card.rev`
   - при mismatch возвращается `409` с кодом вида `STALE_REVISION`
   - при успехе возвращается не голый `ok`, а данные, достаточные для client-side sync:
     - минимум `cardRev`
     - и дополнительно либо свежий file-slice карточки (`attachments`, `inputControlFileId`, `filesCount`, `rev`), либо целиком свежая `card`
3. Сохранить card/file consistency в одной доменной операции, включая:
   - `attachments[]`
   - `inputControlFileId`
   - `filesCount`
   - `rev`
4. Сохранить duplicate `PARTS_DOCS` rule на сервере.
5. Сохранить совместимость shared attachment store для `TECH_SPEC`, `TRPN`, `PARTS_DOCS`, но не начинать migration production / receipts.
6. Не менять в этом batch:
   - `GET /api/data?scope=cards-basic` как текущий legacy read-path списка
   - preview/download endpoints
   - directories/security/production migration

Что нельзя делать:
- не менять business meaning карточки
- не ломать существующие file types и file categories
- не убирать проверки, которые защищают от дублей или расхождения card/file state
- не делать client cutover в этом batch больше, чем строго нужно
- не строить новый file store на клиенте
- не объявлять, что Stage 5 read-side уже мигрирован, если `cards-basic` все еще остается list refresh path

После изменений обязательно проверить:
- upload/delete/resync поддерживают revision-safe contract
- успешная операция возвращает `cardRev` и согласованный file-linked payload
- stale revision дает `409`
- duplicate `PARTS_DOCS` guard сохранен
- `inputControlFileId` не теряется при upload/delete/resync

Формат ответа:
1. Какие server-side file endpoints / handlers актуализировал.
2. Как именно теперь работает `expectedRev -> 409 / success payload`.
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
6. Если можешь, открой ту же карточку во второй вкладке и создай конфликт:
   - во второй вкладке должно быть понятное сообщение о конфликте
7. Если upload или delete сразу сломались, batch не закрыт.
