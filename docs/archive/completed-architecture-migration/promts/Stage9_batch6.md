# Stage 9 Batch 6

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
- Это Stage 9: Migrate Workspace and Execution Layer.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 10 и дальше:
  - не делать derived views migration
  - не делать messaging / realtime migration
  - не делать final legacy cleanup за пределами execution-layer
- Нельзя заново переписывать Stage 1-8 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для execution-layer consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 9:
убрать или явно классифицировать остаточные execution-side bypass write-path,
не заходя в Stage 10.

Фактическая отправная точка из Batch 1 audit:
- core execution commands уже не должны идти через `/api/data`
- остаточные подозрительные paths находятся в основном в `js/app.73.receipts.js`:
  - QR/serial side effects в workspace transfer modal
  - executor / additional executor edits
  - qty inputs
  - operation comments
- часть этих paths может относиться к workorders/derived UI или legacy adjacent
  behavior; их нельзя автоматически тянуть в Stage 9, если они не являются
  execution action correctness path.

Цель:
- завершить cutover именно execution-side production actions
- убрать `saveData()` / `/api/data` из in-scope critical execution write paths
- явно отделить out-of-scope derived/legacy adjacent paths от Stage 9 blockers
- добить conflict UX без pending-state tricks

Что нужно сделать:
1. Провести точный grep/audit по:
   - `saveData(`
   - `/api/data`
   - direct local mutation + save в execution UI
   - raw `apiFetch` execution commands без route-safe conflict handling
2. Для каждого найденного path явно классифицировать:
   - Stage 9 critical execution write
   - Stage 9 adjacent, но не critical
   - Stage 10 derived view
   - non-site / out-of-scope
3. Stage 9 critical paths исправить минимально:
   - перевести на existing production command
   - или убрать snapshot side effect из confirm path
   - или заменить на server-confirmed route-safe path
4. Если path относится к Stage 10 derived views, не мигрировать его сейчас;
   только зафиксировать как Stage 10 blocker/notes.
5. Убедиться, что no correctness via pending-state tricks:
   - disabled/pending UI допустимы
   - pending/local shadow state не должен быть источником истины
6. Проверить, что cleanup не возвращает Stage 8 planning на `/api/data` и не
   смешивает `expectedFlowVersion` с planning `expectedRev`.

Что нельзя делать:
- не удалять legacy `/api/data` целиком раньше Stage 13/final cleanup
- не ломать existing execution semantics ради cleanup
- не переписывать workorders/archive/items/ok/oc как Stage 10
- не строить новую модель на более сложном pending-state
- не переписывать unrelated production UI

После изменений обязательно проверить:
- in-scope execution writes больше не используют обходной write-path
- все оставшиеся `saveData()` usages либо out-of-scope, либо явно documented в ответе
- conflict не выбрасывает с route
- targeted refresh работает после success/error/conflict

Формат ответа:
1. Таблица найденных bypass paths и их классификация.
2. Какие Stage 9 critical bypass paths убрал.
3. Что осталось out-of-scope для Stage 10/13 и почему.
4. Что именно добил в conflict UX и refresh behavior.
5. Какие сценарии проверил автоматически.
6. Что нужно проверить вручную после изменений — отдельным чек-листом.
7. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Удалены критичные обходные пути execution-layer"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/workspace` или другой execution-экран.
2. Выполни одно безопасное действие.
3. После действия проверь:
   - маршрут не потерялся
   - карточка или modal не закрылись сами из-за конфликта
   - состояние обновилось
4. Если можешь, открой тот же объект во второй вкладке и попробуй воспроизвести конфликт.
5. При конфликте должно быть понятное сообщение, а не тихая поломка.
6. Если execution-действие по-прежнему ведет себя как старый snapshot-save path, batch не закрыт.
