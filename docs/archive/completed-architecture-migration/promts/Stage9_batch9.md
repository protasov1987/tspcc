# Stage 9 Batch 9

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
- Нельзя в этой задаче выполнять Stage 10 и дальше.
- Нельзя заново переписывать Stage 1-8 целиком.
- Нельзя делать big refactor "заодно".
- Это финальная приемка Stage 9, а не implementation batch.
- Нельзя менять файлы приложения.
- Нельзя делать version bump.
- Если найдены blockers — перечисли их и предложи отдельный следующий implementation batch.
```

## Промт

```text
Нужно выполнить финальную проверку Stage 9 end-to-end после Batch 8.

Цель:
- подтвердить, что Stage 9 полностью соответствует target architecture для
  workspace/execution layer
- убедиться, что write-path cutover и execution revision/refresh contract не
  оставили скрытых legacy-overlap
- не начать Stage 10 раньше времени
- ничего не исправлять в этом batch

Что нужно сделать:
1. Повторить финальный audit against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/current-state.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/production-and-workspace.md
   - docs/business-rules/workorders-archive-and-items.md
2. Проверить весь Stage 9 scope:
   - workspace
   - personal operations
   - identify
   - transfer
   - material issue / return
   - drying
   - delayed
   - defects
   - repair
   - dispose
3. Подтвердить write-path criteria:
   - no in-scope execution writes through `saveData()`
   - no in-scope execution writes through `/api/data`
   - no stale parallel client path
   - remaining `saveData()` usages explicitly classified as Stage 10/13,
     adjacent legacy, or out-of-scope
4. Подтвердить revision criteria:
   - execution uses `expectedFlowVersion`
   - actual revision source is `card.flow.version`
   - stale execution revision gives `409`
   - planning revision is not used as execution revision
   - ordinary execution command does not create planning false-conflict
5. Подтвердить route and UX criteria:
   - success stays on route
   - conflict stays on route
   - targeted refresh works for list/detail/deeplink routes
   - user gets clear message on validation/conflict
   - local invalid-state/no-request paths are visible and safe
6. Подтвердить, что Stage 10 functionality не смешана в Stage 9:
   - `/workorders`
   - `/workorders/:qr`
   - `/archive`
   - `/archive/:qr`
   - `/items`
   - `/ok`
   - `/oc`
7. Если Stage 9 еще не закрыт:
   - не вносить исправления
   - перечислить blockers
   - предложить отдельный следующий implementation batch с минимальным scope

Критерий завершения Stage 9:
- все in-scope execution writes идут через explicit production commands
- сохраняется `expectedFlowVersion -> 409`
- conflict означает stay on route, clear message, targeted refresh
- no silent overwrite
- no correctness via pending-state tricks
- route-safe refresh доказан на реально доступных execution routes
- Stage 8 planning contract не откатился
- Stage 10 derived views migration еще не начат

Формат ответа:
1. Выполнен ли Stage 9 полностью или нет.
2. Финальная таблица execution write-paths и их API.
3. Финальная таблица execution revision/conflict checks.
4. Результат проверки отсутствия in-scope execution writes через snapshot-save.
5. Классификация оставшихся `saveData()` / `/api/data` usages.
6. Какие тесты/сценарии проверил автоматически.
7. Что нужно проверить вручную — отдельным чек-листом для обычного пользователя.
8. Если Stage 9 не закрыт: blockers и минимальный следующий implementation batch.
9. Какие остаточные риски остались.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 9.

## Зафиксированный follow-up после Stage 9

- Для `/production/delayed`, `/production/delayed/:qr`, `/production/defects`
  и `/production/defects/:qr` route-safe refresh может быть принят по
  synthetic `409`/API conflict test, если нет безопасного реального two-tab UI
  path без файловых операций или модалок.
- Это не блокирует закрытие Stage 9, если representative real two-tab proof
  уже покрыт на `/workspace` или `/workspace/:qr`.
- Если позже будет найден безопасный real two-tab сценарий для delayed/defects,
  его нужно оформить отдельным Stage 9 test-hardening batch, а не смешивать со
  Stage 10 derived views migration.

### Stage 9 считается принят вручную, если:

- execution actions работают и сохраняют данные
- bypass write-path для in-scope execution больше не является рабочим путем
- conflict и targeted refresh работают
- pending-state tricks не являются основой корректности
- planning Stage 8 не откатился
- Stage 10 не был затронут без отдельной задачи
