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
перевести delete/archive/repeat на отдельный cards core API и cards client layer без начала Stage 4/5.

Цель:
- после Batch 4 create/update conflict-path уже должен быть доведен
- теперь нужно закрыть оставшиеся core lifecycle operations:
  - delete
  - archive
  - repeat
- сохранить текущие business-rules:
  - archive остается soft archive
  - repeat создает новую draft-карту
  - delete чистит связанные `productionShiftTasks` и не оставляет осиротевшие ссылки

Что нужно сделать:
1. Найти все remaining user-visible calls delete/archive/repeat, которые еще используют:
   - local mutation + `saveData()`
   - aggregated `/api/data`
2. Перевести на новый cards API:
   - delete
   - archive
   - repeat
3. Для write operations использовать:
   - `card.rev`
   - `expectedRev`
   - `409 Conflict`
4. Сохранить текущие правила:
   - archive не равен delete
   - repeat не равен unarchive
   - delete по-прежнему чистит связанные core side effects
5. Допустимы только минимальные adapters в местах, где эти действия вызываются из derived views
   (`/workorders`, `/archive`), без переписывания самих derived views целиком.
6. Для stale write обеспечить:
   - `409`
   - понятное сообщение
   - сохранение текущего маршрута
   - targeted refresh карточки или нужного списка
7. Не трогать Stage 4/5 paths.

Что нельзя делать:
- не переносить approvals в этот batch
- не переносить files в этот batch
- не менять смысл archive/repeat/delete
- не делать full app reload как единственное решение
- не переписывать `js/app.73.receipts.js` больше, чем строго нужно для action adapter'ов

После изменений обязательно проверить:
- delete/archive/repeat больше не идут через `/api/data`
- archive переносит карту в архив, а не удаляет ее
- repeat создает новую draft-карту, а не меняет архивную
- delete не оставляет битых ссылок на production tasks
- stale write по этим действиям корректно отрабатывает

Что сделать с тестами:
- здесь обязателен dedicated E2E на delete/archive/repeat
- если подходящего теста нет, добавь отдельный Stage 3 spec или расширь уже созданный dedicated cards core spec
- минимум проверить:
  - archive success-path
  - repeat from archive success-path
  - delete success-path на безопасной тестовой карточке
  - отсутствие route regression и грубых UI поломок

Формат ответа:
1. Какие именно delete/archive/repeat сценарии убрал с `/api/data`.
2. Какие business-rules сохранил явно.
3. Какие automated checks добавил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Delete archive и repeat карточек переведены на отдельный core API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/cards` и выбери безопасную тестовую карточку.
2. Проверь archive:
   - отправь карточку в архив
   - она должна исчезнуть из активного списка
3. Открой `/archive`:
   - карточка должна там появиться как архивная
4. На архивной карточке проверь repeat:
   - должна создаться новая draft-карта
   - старая архивная карточка не должна превратиться в новую
5. Если безопасно, проверь delete на отдельной тестовой карточке:
   - карточка действительно удаляется
   - список не ломается
   - после удаления нет пустого сломанного detail-экрана
6. Если смысл archive/repeat/delete изменился, batch не закрыт.
