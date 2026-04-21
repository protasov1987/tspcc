# Stage 4 Batch 7

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
Нужно закрыть Stage 4 end-to-end после предыдущих batch.

Цель:
- подтвердить, что Stage 4 действительно выполнен полностью
- не начать Stage 5 раньше времени
- добрать только минимальные проверки и исправления для approvals, input control и provision

Что нужно сделать:
1. Проверить весь Stage 4 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/cards-and-approval.md
   - docs/business-rules/workorders-archive-and-items.md
2. Подтвердить, что Stage 4 теперь покрывает:
   - send to approval
   - role-based approvals
   - reject with reason
   - return rejected to draft
   - input control
   - provision
   - stage transitions
   - audit/log side effects
3. Подтвердить, что Stage 5 functionality не смешана в Stage 4.
4. Если Stage 4 еще не закрыт, внести только минимальные добивающие изменения.

Критерий завершения Stage 4:
- никакой approval/input/provision write не использует `saveData()`
- stage semantics `DRAFT -> ON_APPROVAL -> REJECTED/APPROVED -> WAITING_* -> PROVIDED -> PLANNING -> PLANNED` сохранены
- reject reason сохранен
- audit trail и обязательные side effects сохранены
- conflict сохраняет route и context
- существующие file endpoints могут оставаться integration point для input control, но Stage 5 files migration еще не начат как отдельная доменная миграция
- legacy read-path `GET /api/data?scope=cards-basic` / `/api/cards-live` сам по себе не считается blocker для закрытия Stage 4, если Stage 4 write-path уже domain-based

Формат ответа:
1. Выполнен ли Stage 4 полностью или нет.
2. Что именно еще пришлось добить.
3. Какие тесты/сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен переход согласования, input control и provision карточек на отдельные команды"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 4.

### Финальный чек-лист для чайника

1. Открой карточку, которую можно отправить на согласование.
2. Выполни отправку на согласование.
3. Если у тебя есть доступ:
   - сделай approve
   - или reject с причиной
4. Проверь:
   - маршрут не потерялся
   - карточка не закрылась сама
   - статус меняется как ожидалось
5. Если доступен сценарий возврата rejected в draft:
   - выполни его
   - проверь, что карточка действительно вернулась в draft
6. Если доступен input control:
   - выполни действие
   - проверь, что результат сохранился после `F5`
7. Если доступен provision:
   - выполни действие
   - проверь, что результат сохранился после `F5`
8. Если можешь, вызови конфликт в двух вкладках:
   - в первой измени состояние карточки
   - во второй попробуй выполнить устаревшее действие
   - должен быть конфликт, а не тихая перезапись
9. Убедись, что files domain не был "переделан заодно", кроме допустимой интеграции уже существующего file API.

### Stage 4 считается принятым вручную, если:

- send to approval работает
- approve/reject работают
- reject reason не теряется
- return to draft сохраняет старый смысл
- input control работает
- provision работает
- конфликт не теряет маршрут
- Stage 5 files не были затронуты как отдельная доменная миграция
