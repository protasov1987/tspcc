# Stage 2 Batch 3

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
- Это Stage 2: Introduce Shared Domain Write and Conflict Contract.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 3 и дальше: не переводить конкретные домены на новые write API полностью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 2:
ввести client-side shared command execution pattern для write/conflict handling без полной доменной миграции.

Цель:
- подготовить общий клиентский слой для будущих domain writes
- стандартизовать обработку:
  - server write response
  - `409 Conflict`
  - user-safe error message
  - сохранение текущего маршрута
  - targeted refresh hook
- не переводя в этой задаче конкретные домены полностью

Что нужно сделать:
1. Найти лучшее место для общего client-side write wrapper / command helper.
2. Ввести минимальный reusable pattern для:
   - успешной записи
   - обработки `409`
   - обработки обычной ошибки
   - route-safe поведения
   - вызова targeted refresh callback
3. Не переписывать все существующие доменные writes.
4. Подключить helper только там, где это нужно минимально для проверки работоспособности Stage 2, без фактической миграции Stage 3+.

Что нельзя делать:
- не менять бизнес-логику доменов
- не начинать массовую замену всех save flows
- не менять route semantics
- не ломать существующую production conflict handling

После изменений обязательно проверить:
- wrapper можно использовать повторно
- при ошибке или конфликте route context не теряется
- обычное поведение приложения не ухудшилось

Формат ответа:
1. Где именно внедрил shared client helper.
2. Что именно он теперь стандартизует.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлен общий клиентский паттерн обработки записи и конфликтов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Перейди в один экран, где обычно можно что-то сохранить.
3. Выполни одно привычное действие сохранения, которое точно работало до этого.
4. Проверь:
   - после сохранения ты остался на том же экране
   - страница не перекинула тебя на `/dashboard`
   - не появилось внезапное пустое состояние
5. Если есть действие, которое раньше показывало понятную ошибку:
   - проверь, что ошибка все еще читаемая и не техническая мешанина
6. Если после обычного сохранения маршрут теряется или экран слетает, batch не закрыт.
