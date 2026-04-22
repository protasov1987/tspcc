# Stage 5 Batch 6

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
убрать остаточную зависимость card files от legacy refresh-path и добить local-state / conflict UX.

Цель:
- завершить cutover file-domain карточки на explicit commands
- убрать зависимость file-domain от `GET /api/data?scope=cards-basic` как обязательного refresh-path после file mutations
- убедиться, что после file write локальная карточка не остается со старым `rev`
- добить понятный conflict behavior без Stage 6

Что нужно сделать:
1. Исходить из результатов аудита:
   - прямого file write через `/api/data` уже нет
   - legacy проблема осталась в refresh/read-path после file действий и stale-state сценариев
2. Найти места, где после upload/delete/resync клиент:
   - ждет live update как единственную коррекцию
   - держит старый `card.rev`
   - вынужденно падает обратно на `cards-basic` refresh-path
3. Минимально добить local-state update после file операций:
   - использовать `cardRev` и свежий file-linked payload из ответа
   - синхронизировать `cards` / `activeCardDraft` без отдельного file store refactor
4. Добить conflict UX:
   - понятное сообщение
   - сохранение route
   - точечный refresh карточки
5. Убедиться, что `cardRev` после file операций используется дальше последовательно.
6. Не менять в этом batch основной legacy read-path списка карточек через `cards-basic`, если он остается нужен вне file mutation flow.
7. Не трогать Stage 6.

Что нельзя делать:
- не писать в документации, что read-side карточек полностью мигрирован, если список все еще грузится через `cards-basic`
- не ломать старые business rules ради cleanup
- не начинать directories migration
- не переписывать unrelated cards UI
- не делать отдельный file store refactor

После изменений обязательно проверить:
- file operations после success не требуют обязательного fallback на `cards-basic` refresh
- локальная карточка не остается со старым `rev` после file write
- conflict не выбрасывает пользователя с карточки
- input-control modal больше не вынужден получать свежую карточку только потому, что upload оставил stale local rev, если это можно исправить локальным применением ответа

Формат ответа:
1. Какие legacy refresh / stale-state paths убрал или ослабил.
2. Что именно добил в conflict UX и `cardRev` consistency.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Убрана остаточная зависимость файлов карточек от legacy refresh-пути и улучшена обработка конфликтов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой карточку с файлами.
2. Выполни по одному тестовому действию:
   - upload
   - delete
   - resync, если доступен
3. После каждого действия проверь:
   - ты остался на той же карточке
   - список файлов обновился правильно
   - маршрут не потерялся
4. Если можешь:
   - открой вторую вкладку с той же карточкой
   - в первой измени файлы
   - во второй попробуй выполнить устаревшее file-действие
5. Во второй вкладке должен быть понятный конфликт, а не тихая перезапись.
6. После конфликтного сценария проверь, что карточка сама возвращается в актуальное состояние без полного сброса экрана.
7. Если хоть одно file-действие еще оставляет интерфейс со старым списком файлов или старым `rev`, batch не закрыт.
