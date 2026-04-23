# Stage 5 Batch 7

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
Нужно закрыть Stage 5 end-to-end после предыдущих batch.

Цель:
- подтвердить, что Stage 5 действительно выполнен полностью
- не начать Stage 6 раньше времени
- добрать только минимальные проверки и исправления для card files

Что нужно сделать:
1. Проверить весь Stage 5 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/cards-and-approval.md
   - docs/business-rules/workorders-archive-and-items.md
2. Подтвердить, что Stage 5 теперь покрывает:
   - upload
   - delete
   - resync
   - attachment-linked side effects
   - card/file consistency
   - route-safe conflict / refresh behavior для action-capable file flows
3. Подтвердить, что Stage 6 functionality не смешана в Stage 5.
4. Если Stage 5 еще не закрыт, внести только минимальные добивающие изменения.

Дополнительно, с учетом практического опыта Stage 4, Stage 5 нельзя считать закрытым, если:
- конкурентные UI-сценарии для file actions проверены только через искусственный `409`, а в реальном UI возможен local invalid-state / no-request path
- file action доступен на разных routes или в разных UI-контекстах, но proof получен только для одного из них
- после конкурентного изменения остаются silent no-op / silent close / lone `alert(...)` / hidden `return` paths без понятного сообщения и route-safe refresh
- отсутствие open/confirm flow в каком-то file-сценарии просто предполагается, а не подтверждено явно
- нет dedicated proof для upload/delete/resync stale-rev сценариев, а есть только smoke на открытие модалки

Критерий завершения Stage 5:
- file operations принимают `expectedRev`
- file operations возвращают новый `cardRev`
- input-control file linkage остается корректным
- duplicate `PARTS_DOCS` rule сохранен
- file actions не используют snapshot path
- conflict сохраняет route и context
- для action-capable file flows отдельно доказаны `local invalid-state / no-request` и `server-side conflict` paths
- route-safe refresh подтвержден на list/detail/deeplink routes, где file action реально доступен
- file writes не зависят от `/api/data`, но при этом допустимо, что legacy `cards-basic` еще остается list read-path, если он не является write/conflict recovery contract для file-domain
- есть отдельное доказательство по upload/delete/resync, а не только по Stage 4 input-control command path
- Stage 6 directories migration еще не начат

Формат ответа:
1. Выполнен ли Stage 5 полностью или нет.
2. Что именно еще пришлось добить.
3. Какие тесты/сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен переход файлов карточек на отдельный revision-safe контракт"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 5.

### Финальный чек-лист для чайника

1. Открой карточку с файлами.
2. Загрузи один тестовый файл.
3. Проверь:
   - файл появился в списке
   - карточка осталась открыта
   - URL не изменился сам
4. Удали этот же тестовый файл.
5. Проверь:
   - файл исчез
   - после `F5` он не появляется снова
6. Если доступен resync:
   - выполни его
   - проверь, что итоговое состояние после `F5` корректно
7. Если можешь, вызови конфликт в двух вкладках:
   - в первой измени файлы карточки
   - во второй выполни устаревшее file-действие
   - должен быть конфликт, а не тихая перезапись
8. Если есть сценарий с `PARTS_DOCS`:
   - попробуй создать дубль
   - дубль не должен проходить молча
9. Проверь file action в тех UI-контекстах, где он реально доступен:
   - обычная карточка
   - detail / deeplink route
   - другие in-scope routes, если там открывается та же модалка вложений
10. Проверь, что связанные сценарии не сломались:
   - карточка как экран
   - file-linked действие
   - derived views, если они читают файлы
11. Убедись, что directories и другие чужие домены не были "переделаны заодно".

### Stage 5 считается принятым вручную, если:

- upload работает
- delete работает
- resync работает там, где должен работать
- `expectedRev -> cardRev` не ломает пользовательский сценарий
- conflict не теряет маршрут
- duplicate `PARTS_DOCS` rule сохранен
- file linkage и side effects не сломаны
- реальный stale-state сценарий доказан отдельно для file write path, а не только для соседних Stage 4 command path
- Stage 6 не был затронут без отдельной задачи
