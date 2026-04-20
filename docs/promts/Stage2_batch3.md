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
ввести shared client-side write/conflict execution pattern на основе уже зрелых production/workspace flows.

Цель:
- стандартизовать клиентский паттерн:
  - execute write
  - parse success / conflict / common error
  - route-safe behavior
  - targeted refresh hook
  - user-safe message
- не переводя в этой задаче cards/directories/approvals на новый write API

Что нужно сделать:
1. Найти повторяющиеся client-side паттерны в `js/app.73.receipts.js` и `js/app.75.production.js`:
   - `apiFetch(...)`
   - `res.ok / res.status === 409`
   - `forceRefreshWorkspaceProductionData(...)`
   - `refreshProductionIssueRouteAfterMutation(...)`
   - route-preserving refresh
2. Ввести minimal reusable client helper / helpers для:
   - success-path
   - `409 Conflict`
   - обычной ошибки
   - targeted refresh callback
   - сохранения текущего route context
3. Подключить helper только к нескольким representative mature flows:
   - минимум один workspace action
   - минимум один workspace modal flow
   - если это помогает без риска, один production issue route flow
4. Не делать массовую замену всех write-сценариев.
5. Не менять semantics сообщений, доступов и бизнес-логики.

Что нельзя делать:
- не переписывать весь клиентский write-layer разом
- не переводить snapshot-based домены на новые endpoint'ы
- не менять route semantics
- не ломать уже существующий production/workspace conflict handling
- не трогать receipts-domain

После изменений обязательно проверить:
- helper реально reusable, а не одноразовый
- после conflict route context не теряется
- targeted refresh продолжает работать
- обычный success-path не стал хуже

Формат ответа:
1. Где именно внедрил shared client helper.
2. Что именно он теперь стандартизует.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлен общий клиентский паттерн записи и обработки конфликтов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Перейди в `/workspace`, если у тебя есть доступ.
3. Выполни одно привычное действие, которое точно сохраняло состояние до batch.
4. Проверь:
   - ты остался на том же экране
   - не было прыжка на `/dashboard`
   - интерфейс не ушёл в пустое состояние
5. Если есть известный stale/conflict сценарий:
   - воспроизведи его
   - убедись, что после конфликта экран остаётся тем же
   - данные обновляются точечно, а не через поломанный reload
6. Если после обычного действия теряется маршрут или ломается контекст, batch не закрыт.
