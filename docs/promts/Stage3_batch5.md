# Stage 3 Batch 5

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
- Это Stage 3: Migrate Cards Core.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 4 и Stage 5:
  - не трогать approvals как отдельный домен
  - не трогать input control
  - не трогать provision
  - не трогать card files как домен
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 3:
перевести core write-сценарии карточек с `/api/data` на отдельный cards core API.

Цель:
- Stage 3 считается незавершенным, пока обычное редактирование карточки зависит от `/api/data`
- нужно убрать эту зависимость для core write-сценариев

Что нужно сделать:
1. Найти все core-scenario calls, которые еще используют:
   - local mutation + saveData()
   - aggregated `/api/data`
2. Перевести только cards core writes на новый cards API:
   - create
   - update
   - delete
   - archive
   - repeat
3. Для stale write обеспечить:
   - `409`
   - понятное сообщение
   - сохранение текущего маршрута
   - targeted refresh карточки
4. Не трогать Stage 4/5 paths.

Что нельзя делать:
- не переносить approvals в этот batch
- не переносить files в этот batch
- не ломать route context карточки
- не делать full app reload как единственное решение конфликтов

После изменений обязательно проверить:
- core card write больше не идет через `/api/data`
- stale card write корректно отрабатывает
- пользователь остается на card route после конфликта
- targeted refresh обновляет карточку без падения интерфейса

Формат ответа:
1. Какие именно core write-сценарии убрал с `/api/data`.
2. Как теперь работает conflict-path.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Core-запись карточек переведена с общего snapshot-save на отдельный API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/cards`.
2. Открой существующую карточку.
3. Измени одно безопасное поле.
4. Сохрани карточку.
5. Проверь:
   - ты остался на карточке
   - маршрут не потерялся
   - страница не улетела на `/dashboard`
   - после обновления `F5` изменения сохранились
6. Создай новую тестовую карточку, если это безопасно.
7. Проверь, что после создания открывается корректная новая карточка или корректный список.
8. Если есть возможность воспроизвести конфликт в двух вкладках:
   - открой одну и ту же карточку в двух вкладках
   - в первой вкладке измени и сохрани
   - во второй вкладке попробуй сохранить старую версию
   - должен быть понятный конфликт, а не тихая перезапись
9. Если после конфликта маршрут теряется или данные тихо перетираются, batch не закрыт.
