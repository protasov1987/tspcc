# Stage 4 Batch 3

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
перевести client-side approval flows на новые explicit server commands без потери route/context.

Цель:
- убрать approval-related core writes с snapshot path
- сохранить текущие экраны `/approvals`, `/cards`, `/cards/:id`
- сделать conflict behavior безопасным:
  - понятное сообщение
  - сохранение route
  - точечный refresh карточки и/или approval списка
- не переписывать read-path `cards-basic` / `cards-live` заодно

Что нужно сделать:
1. Найти и перевести client-side actions в `js/app.70.render.cards.js` и `js/app.74.approvals.js` для:
   - send to approval
   - approve
   - reject
   - return rejected to draft
2. Перевести их на новые server commands.
3. Сохранить текущие permission checks и UX-смысл экранов.
4. При конфликте не выбрасывать пользователя с текущего route.
5. Использовать route-safe patch/refresh вместо `saveData()` + full snapshot mutation.
6. Не переносить сюда input control, provision и files.

Что нельзя делать:
- не менять business rules approvals
- не ломать `/cards`, `/cards/:id`, `/approvals`
- не делать полный client refactor карточки
- не переписывать realtime
- не переписывать route-critical loading

После изменений обязательно проверить:
- approval действия больше не опираются на generic snapshot-save
- route сохраняется после success и conflict на `/approvals` и на карточке
- approval list и card detail обновляются точечно, без потери контекста
- stale `expectedRev` дает понятный conflict UX

Формат ответа:
1. Какие client-side approval actions перевел.
2. Что именно изменил в conflict and refresh behavior.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Клиентские действия согласования карточек переведены на отдельные команды"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/approvals`.
2. Открой карточку из согласований.
3. Выполни действие согласования, которое тебе доступно.
4. Проверь:
   - ты остался на том же экране
   - маршрут не потерялся
   - после `F5` открывается тот же маршрут
5. Если есть возможность:
   - открой одну и ту же карточку в двух вкладках
   - в первой выполни действие
   - во второй повтори устаревшее действие
6. Во второй вкладке должен быть понятный конфликт, а не тихая перезапись или выброс на другой экран.
