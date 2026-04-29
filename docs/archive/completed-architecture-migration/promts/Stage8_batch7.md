# Stage 8 Batch 7

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
Нужно закрыть Stage 8 write-path cutover после предыдущих batch.

Audit baseline, который нужно перепроверить после Batch 2-6:
- schedule writes должны быть сняты с `saveData()` / `/api/data`
- plan writes должны оставаться на explicit `/api/production/plan/*` или
  совместимом planning command API
- shifts и shift-close writes должны быть сняты с `saveData()` / `/api/data`
- gantt должен оставаться read/detail route и получать актуальный planning
  state через route-local refresh
- workspace/execution actions не должны быть мигрированы в рамках Stage 8

Цель:
- подтвердить, что Stage 8 write-path cutover выполнен
- не начать Stage 9 раньше времени
- добрать только минимальные проверки и исправления для production planning layer

Что нужно сделать:
1. Проверить весь Stage 8 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/production-and-workspace.md
   - docs/business-rules/workorders-archive-and-items.md
2. Подтвердить, что Stage 8 теперь покрывает:
   - production schedule
   - production plan
   - production shifts
   - gantt
   - planning validations
3. Выполнить контрольный code audit для write-path cutover:
   - in-scope planning writes не вызывают `saveData()`
   - in-scope planning writes не идут в `/api/data`
   - legacy snapshot path остаётся только для еще не мигрированных non-planning
     доменов, если такие есть
   - no duplicate shift-close handlers / no stale parallel client path
4. Подтвердить, что Stage 9 functionality не смешана в Stage 8.
5. Если Stage 8 еще не закрыт, внести только минимальные добивающие изменения.

Дополнительно, с учетом практического опыта Stage 4, Stage 8 нельзя считать закрытым, если:
- конкурентные UI-сценарии planning actions проверены только через искусственный `409`, а в реальном UI возможен local invalid-state / no-request path
- planning action доступен на разных routes или в разных UI-контекстах, но proof получен только для одного из них
- после конкурентного изменения остаются silent no-op / silent close / lone `alert(...)` / hidden `return` paths без понятного сообщения и route-local refresh
- отсутствие open/confirm flow в каком-то planning-сценарии просто предполагается, а не подтверждено явно
- gantt помечен как migrated write-flow, хотя в коде у него нет собственного
  write-path
- shift-close detail-route не проверен отдельно от `/production/shifts` list

Критерий завершения Stage 8:
- no planning writes through snapshot-save
- используются только targeted production slice updates
- no correctness based on heavy local shadow state
- route-local refresh работает для planning pages
- planning validations сохранены
- для action-capable planning flows отдельно доказаны `local invalid-state / no-request` и `server-side conflict` paths
- route-local refresh подтвержден на list/detail/deeplink routes, где planning action реально доступен
- `/production/gantt/:card` подтвержден как read/detail route после planning mutations
- Stage 9 execution migration еще не начат

Формат ответа:
1. Выполнен ли Stage 8 полностью или нет.
2. Что именно еще пришлось добить.
3. Сводная таблица in-scope planning write-paths и их API.
4. Результат проверки отсутствия planning writes через snapshot-save.
5. Какие тесты/сценарии проверил автоматически.
6. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
7. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен переход planning-layer производства на отдельный domain API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это ручная приемка write-path cutover перед отдельной
planning revision model.

### Чек-лист для чайника

1. Открой основные planning-экраны:
   - `/production/schedule`
   - `/production/plan`
   - `/production/shifts`
   - `/production/shifts/<ключ смены>`, если есть открытая/закрытая смена
   - `/production/gantt/<карта>`, если есть планируемая карта
2. Для каждого экрана выполни по одному безопасному тестовому действию, если у тебя есть доступ.
3. После каждого действия проверь:
   - данные сохранились
   - маршрут не потерялся
   - после `F5` все осталось
4. Проверь сценарии ошибки/валидации:
   - должно быть понятное сообщение
   - экран не должен ломаться
5. Если можешь, попробуй конфликтный сценарий в двух вкладках:
   - должен быть конфликт, а не тихая перезапись
6. Убедись, что planning-side не держится на ложном локальном состоянии:
   - после обновления страницы данные должны совпадать
7. Убедись, что workspace/execution не были “переделаны заодно”.

### Stage 8 write-path cutover считается принятым вручную, если:

- planning pages работают и сохраняют данные
- snapshot-path для planning writes больше не является рабочим путем
- targeted refresh и route-local behavior работают
- validations и conflict behavior не сломаны
- shift-close detail-route работает отдельно от списка смен
- gantt работает как актуальное read/detail представление
- Stage 9 не был затронут без отдельной задачи

Важно: после этого batch Stage 8 еще не считается полностью закрытым, если
production planning revision по-прежнему фактически использует общий
`meta.revision`. Отдельная planning-domain revision model закрывается
следующим batch.
