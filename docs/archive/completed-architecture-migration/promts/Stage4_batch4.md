# Stage 4 Batch 4

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
- Это Stage 4: Migrate Approval, Input Control and Provision.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 5 и дальше:
  - не трогать card files как отдельный домен
  - не делать directories/security migration
  - не делать production migration
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 4:
перевести input control на отдельный command path без затрагивания files domain.

Цель:
- убрать input control write-операции с generic snapshot-save
- сохранить текущую business semantics input control
- не смешивать этот batch с file migration из Stage 5

Что нужно сделать:
1. Найти серверный и клиентский path input control.
2. Выделить отдельные commands / handlers для input control.
3. Сохранить текущие правила:
   - кто может выполнять input control
   - как меняется состояние карточки
   - какие побочные эффекты обязательны
4. Если input control зависит от attachment state, не переносить file-domain в этот batch:
   - существующий upload/delete/resync файлов остается на текущих file endpoints
   - новый Stage 4 command работает только с card-state, comment, stage transition и уже существующим `inputControlFileId`
5. Если текущий UI перед input control сначала загружает файл, оставь upload как отдельный шаг через существующий file API, а не переноси file command сюда.
6. При конфликте сохранять route и контекст.

Что нельзя делать:
- не делать Stage 5 file migration
- не менять business meaning input control
- не ломать approval/provision
- не подменять server truth локальным pending-state
- не добавлять в этом batch `expectedRev` в file endpoints

После изменений обязательно проверить:
- input control больше не зависит от snapshot-save path
- карточка остается на том же route
- stage transition `APPROVED -> WAITING_PROVISION/PROVIDED` сохраняется
- сценарий с уже существующим input-control файлом не ломается

Формат ответа:
1. Какие input control paths перевел.
2. Что именно сохранил из business semantics.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Input control карточек переведен на отдельную команду"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой карточку, для которой доступен input control.
2. Выполни действие input control.
3. Проверь:
   - карточка осталась открыта
   - маршрут не поменялся сам по себе
   - статус и видимый результат соответствуют ожиданию
4. Обнови страницу через `F5`.
5. Проверь, что состояние карточки не потерялось.
6. Если в этом сценарии используется файл ПВХ, проверь, что существующая загрузка файла не сломалась.
7. Если input control перестал работать или начал требовать действия с файлами, которых раньше не требовал, batch не закрыт.
