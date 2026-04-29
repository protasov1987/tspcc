# Stage 8 Batch 2

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
- Это Stage 8: Migrate Production Planning Layer.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 9 и дальше:
  - не делать workspace/execution migration
  - не делать derived views migration
  - не делать messaging / realtime migration
- Нельзя заново переписывать Stage 1-7 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для planning-layer consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 8:
подготовить server-side foundation для production planning domain API.

Audit baseline из Stage8_batch1:
- production plan core writes уже частично идут через `/api/production/plan/commit`
  и `/api/production/plan/auto`
- `production schedule` writes всё ещё идут через `saveData()` / `/api/data`
- `production shifts` и `shift-close` writes всё ещё идут через `saveData()` / `/api/data`
- `gantt` является read/detail view поверх planning state, отдельного write-path
  у него не обнаружено
- production scoped read payload уже есть, но он широкий и не является полноценным
  planning command response

Цель:
- создать reusable server-side foundation для planning-side production API
- убрать зависимость новых planning writes от aggregated snapshot
- не переводя сразу весь planning UI одним большим куском

Что нужно сделать:
1. Не дублировать уже существующие `/api/production/plan/commit` и
   `/api/production/plan/auto`; использовать их как текущий working pattern.
2. Добавить или выделить server-side helpers для planning-side production,
   которые смогут переиспользоваться в schedule / shifts / shift-close:
   - normalized planning command response
   - targeted production slice response
   - planning revision / conflict envelope
   - validation error envelope
   - route-safe refresh metadata where useful
3. Подготовить минимальные endpoint primitives для следующих batch, если это
   нужно без client cutover:
   - schedule assignment commands
   - shift lifecycle commands
   - shift-close draft/finalize commands
4. Подготовить общий подход для:
   - targeted production slice responses
   - revision/conflict checks where needed
   - planning validation responses
   - точечного обновления schedule / plan / shifts / gantt данных
5. Не менять business meaning planning entities.
6. Не переносить сюда Stage 9 execution actions.
7. Не ломать существующие production reads без необходимости.

Что нельзя делать:
- не делать full client cutover planning UI в этом batch
- не менять routes
- не смешивать planning and execution commands
- не ломать existing planning readers без причины
- не переносить schedule/shifts UI на новые endpoints в этом batch, если для
  этого требуется широкий клиентский refactor
- не создавать второй parallel production API рядом с уже существующим plan API

После изменений обязательно проверить:
- новый planning foundation можно использовать повторно
- validation and conflict responses совместимы с дальнейшим cutover
- targeted production slice response реально существует
- существующие `/production/schedule`, `/production/plan`, `/production/shifts`
  продолжают открываться
- `/api/production/plan/commit` и `/api/production/plan/auto` не сломаны

Формат ответа:
1. Какие server-side primitives или endpoints для planning-domain добавил.
2. Как устроены targeted responses и checks.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие exact legacy write-paths оставлены для Batch 3/4.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлен серверный foundation для planning API производства"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой:
   - `/production/schedule`
   - `/production/plan`
   - `/production/shifts`
2. Убедись, что страницы открываются как раньше.
3. Если planning-экраны начали падать сразу при открытии, batch не закрыт.
