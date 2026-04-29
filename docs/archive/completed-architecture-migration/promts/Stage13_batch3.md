# Stage 13 Batch 3

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
- Это Stage 13: Remove Legacy Snapshot and Transitional Overlaps.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 14:
  - не делать final diagnostics/E2E/perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-12 целиком.
- Допустимо убирать только ту legacy-переходность, которая уже реально заменена новой моделью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 13:
убрать legacy workorders / execution write leftovers из `js/app.73.receipts.js`,
не трогая receipts как домен.

Цель:
- закрыть оставшиеся `saveData()` usages в in-scope workorders/execution UI
- оставить primary production execution commands единственным write-path
- не менять frozen receipts carve-out

Что нужно сделать:
1. Повторно найти все `saveData()` в `js/app.73.receipts.js`.
2. Разделить файл по смыслу:
   - in-scope workorders / workspace / production execution
   - out-of-scope receipts
3. Работать только с in-scope workorders/execution paths:
   - executor / additionalExecutors legacy writes
   - manual qty legacy writes
   - operation comments fallback branch, который еще пишет через `saveData()`
4. Для каждого action-capable flow определить primary path:
   - operation comments: `/api/production/operation/comment`
   - production operation actions: existing `/api/production/operation/*`
     или `/api/production/personal-operation/*`
   - если для executor/additionalExecutors/manual qty нет безопасного
     replacement command, оставить UI read-only/blocked с понятным сообщением,
     как уже делает `guardWorkordersLegacyWriteAction`, и не отправлять request
5. Обязательно сохранить:
   - `/workorders` list
   - `/workorders/:qr` detail
   - `/workspace`
   - `/workspace/:qr`
   - `/production/delayed`
   - `/production/delayed/:qr`
   - `/production/defects`
   - `/production/defects/:qr`
6. Для modal/dialog flows явно проверить:
   - primary path
   - удаленный legacy path
   - local invalid-state / no-request path
   - server-side conflict / rejected-command path
   - real two-tab / multi-client proof where possible

Что нельзя делать:
- не удалять `saveData()` раньше времени
- не ломать текущие доменные команды
- не менять business semantics экранов ради cleanup
- не трогать receipts как домен
- не править `js/app.73.receipts-list.js`
- не переносить весь файл `app.73` в новую архитектуру

После изменений обязательно проверить:
- `js/app.73.receipts.js` больше не вызывает `saveData()` из in-scope
  workorders/execution action paths
- operation comment работает через `/api/production/operation/comment`
- blocked legacy executor/qty actions не отправляют `/api/data`
- stale modal/detail cases не дают silent close / silent no-op

Формат ответа:
1. Какие `js/app.73.receipts.js` paths изменил.
2. Чем они заменены или почему заблокированы как no-request path.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Убраны legacy saveData-записи из workorders execution"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой основные экраны, где раньше часто было сохранение.
2. Проверь комментарий операции в `/workorders/:qr` или `/workspace/:qr`, если есть доступная операция.
3. Проверь:
   - данные сохраняются
   - после `F5` остаются
   - маршрут не теряется
4. Попробуй legacy-поля исполнителей/количества: если они заблокированы, должно
   быть понятное сообщение, а не тихое исчезновение изменения.
