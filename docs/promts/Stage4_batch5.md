# Stage 4 Batch 5

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
перевести provision на отдельный command path без затрагивания files domain.

Цель:
- убрать provision write-операции с generic snapshot-save
- сохранить текущий смысл provision
- не смешивать этот batch с file migration из Stage 5

Что нужно сделать:
1. Найти серверный и клиентский path provision.
2. Выделить отдельные commands / handlers для provision.
3. Сохранить текущие правила:
   - кто может выполнять provision
   - как меняется состояние карточки
   - какие audit/log side effects обязательны
4. Не переносить file-domain в этот batch.
5. При конфликте сохранять route и контекст.

Что нельзя делать:
- не делать Stage 5 file migration
- не менять business meaning provision
- не ломать approval/input control
- не подменять server truth локальным shadow-state

После изменений обязательно проверить:
- provision больше не зависит от snapshot-save path
- карточка остается на том же route
- состояние карточки обновляется корректно

Формат ответа:
1. Какие provision paths перевел.
2. Что именно сохранил из business semantics.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Provision карточек переведен на отдельные команды без потери маршрута"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой карточку, для которой доступен provision.
2. Выполни действие provision.
3. Проверь:
   - карточка осталась на месте
   - маршрут не изменился сам
   - видимый результат соответствует ожиданию
4. Обнови страницу через `F5`.
5. Убедись, что состояние provision сохранилось.
6. Если provision перестал работать или начал зависеть от несвязанных действий с файлами, batch не закрыт.
