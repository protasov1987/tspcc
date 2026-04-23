# Stage 5 Batch 4

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
перевести file delete и file resync на новый revision-safe contract.

Цель:
- добить delete/resync caller'ы на том же shared file contract, что и upload
- сохранить card/file consistency
- не ломать duplicate guards, implicit resync flow и соседние сценарии

Что нужно сделать:
1. Найти client-side и server-side path для:
   - delete file
   - resync file
2. Учитывать, что resync может быть не отдельной кнопкой, а implicit path перед preview/download.
3. Перевести delete/resync на explicit revision-safe file contract:
   - передавать `expectedRev`
   - принимать `cardRev` и согласованный file-linked payload или свежую `card`
4. После успешной операции:
   - обновлять текущую карточку точечно
   - не оставлять локальную карточку со старым `rev`
4. При конфликте:
   - оставлять пользователя на карточке
   - показывать понятное сообщение
   - делать route-safe точечный refresh
5. Сохранить duplicate `PARTS_DOCS` rule.
6. Если explicit user-facing resync action отсутствует, это нужно явно зафиксировать в ответе и проверить реальный trigger path вместо выдуманного UI.

Что нельзя делать:
- не ломать существующие file lists
- не удалять защиту от дублей
- не менять unrelated card core behavior
- не трогать directories/security/production
- не придумывать новый resync UX, если его сейчас нет
- не тянуть сюда migration shared business flows `TECH_SPEC` / `TRPN` / `PARTS_DOCS`

После изменений обязательно проверить:
- delete/resync используют revision-safe contract
- card/file state остается согласованным
- duplicate `PARTS_DOCS` rule не потерян
- conflict path доказан не только искусственным `409`, но и реальным stale-state сценарием там, где это возможно

Формат ответа:
1. Какие delete/resync paths перевел.
2. Что именно изменил в consistency/conflict behavior.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Удаление и пересинхронизация файлов карточек переведены на отдельный контракт"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой карточку с уже загруженным тестовым файлом.
2. Удали этот файл.
3. Проверь:
   - файл исчез из списка
   - карточка осталась открыта
   - маршрут не потерялся
4. Если в интерфейсе нет отдельной кнопки resync, проверь реальный сценарий, где resync вызывается автоматически.
5. Проверь, что после `F5` итоговое состояние осталось правильным.
6. Если есть правило на дубли `PARTS_DOCS`, попробуй сценарий, который раньше мог дать дубль:
   - дубль не должен проходить молча
7. Если можешь, создай конфликт во второй вкладке:
   - delete/resync со старым состоянием не должны проходить молча
8. Если delete/resync сломались или начали вести себя нестабильно, batch не закрыт.
