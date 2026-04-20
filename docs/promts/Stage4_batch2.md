# Stage 4 Batch 2

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
подготовить server-side approval lifecycle commands без затрагивания files и соседних доменов.

Цель:
- перевести approval lifecycle на явные server commands
- сохранить business semantics карточки и approvalStage
- встроить conflict-safe behavior поверх card revision model

Что нужно сделать:
1. Добавить или выделить серверные команды для:
   - send to approval
   - approve
   - reject with reason
   - return rejected to draft
2. Сохранить обязательные stage transitions.
3. Сохранить reject reason и audit/log side effects.
4. Использовать Stage 2/3 revision and conflict contract там, где это нужно.
5. Не переносить сюда:
   - card files
   - input control
   - provision

Что нельзя делать:
- не менять business meaning approvalStage
- не ломать role-based approval rules
- не менять generic cards core behavior без необходимости
- не трогать file endpoints

После изменений обязательно проверить:
- send to approval работает через новый command path
- approve/reject дают корректный результат
- reject сохраняет reason
- stale revision дает `409`, если это применимо

Формат ответа:
1. Какие server-side approval commands добавил или выделил.
2. Что именно теперь работает через revision-safe contract.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлены серверные команды согласования карточек с поддержкой ревизий"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой карточку, которую можно отправить на согласование.
2. Выполни отправку на согласование.
3. Проверь:
   - карточка не пропала
   - маршрут не улетел
   - статус изменился ожидаемо
4. Если у тебя есть доступ согласующего:
   - попробуй approve
   - попробуй reject с причиной
5. Проверь, что причина отклонения сохраняется и видна там, где должна быть видна.
6. Если после batch согласование стало падать или вести себя странно, batch не закрыт.
