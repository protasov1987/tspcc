# Stage 4 Batch 6

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
удалить остаточную зависимость approval/input/provision от snapshot-save path и добить audit/conflict behavior.

Цель:
- завершить cutover Stage 4 на explicit commands
- убрать оставшиеся approval-related writes с `/api/data` и `saveData()`
- убедиться, что audit/log side effects и conflict UX сохранены

Что нужно сделать:
1. Найти оставшиеся approval/input/provision write-path на snapshot-save.
2. Удалить или отключить их только после полного перевода на новые команды.
3. Добить обязательные diagnostics и audit/log side effects.
4. Убедиться, что conflict:
   - не выбрасывает с route
   - не закрывает рабочий контекст
   - дает понятное сообщение
5. Не трогать files domain.

Что нельзя делать:
- не удалять legacy path раньше времени
- не ломать старые business rules ради cleanup
- не начинать Stage 5
- не переписывать unrelated cards UI

После изменений обязательно проверить:
- хотя бы один approval-related write больше не проходит через `/api/data`
- input control и provision тоже не зависят от snapshot-save
- audit/log side effects не потеряны

Формат ответа:
1. Какие snapshot-based paths убрал.
2. Какие conflict/audit моменты добил.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Удалены snapshot-пути для согласования, input control и provision карточек"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой карточку, связанную с согласованием.
2. Выполни одно действие из Stage 4:
   - отправка на согласование
   - approve
   - reject
   - input control
   - provision
3. После каждого действия проверь:
   - ты остался на нужном экране
   - карточка не закрылась сама
   - маршрут не потерялся
4. Если можешь, открой вторую вкладку с той же карточкой и попробуй вызвать конфликт.
5. При конфликте должно быть понятное сообщение, а не тихая поломка.
6. Если после batch хоть одно действие Stage 4 снова работает только через старое поведение или ломает маршрут, batch не закрыт.
