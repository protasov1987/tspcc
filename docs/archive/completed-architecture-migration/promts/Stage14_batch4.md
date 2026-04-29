# Stage 14 Batch 4

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
- Это Stage 14: Final Diagnostics, E2E and Performance Hardening.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Это финальный stage доказательства достижения target architecture, а не новый продуктовый refactor.
- Performance work разрешен только после подтверждения correctness и только после измерений.
- Нельзя делать необоснованные perf-оптимизации "на глаз".
- Сначала проведи точную диагностику по коду и тестам, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 14:
добить domain and conflict E2E coverage across cards, directories/security, production, derived views и messaging.

Цель:
- доказать success-path и conflict-path по критичным доменам
- закрыть пробелы по revision/conflict model и business scenarios
- не менять business behavior ради тестов

Что нужно сделать:
1. Проверить существующие domain E2E и сверить их с `Test Plan`.
2. Добрать недостающие тесты для:
   - cards: create/edit/delete/archive/repeat, approval, input control, provision, files, stale `expectedRev`
   - directories/security: delete guards, operation type guard, access level effects, `Abyss`, passwords, `landingTab`, inactivity timeout
   - production planning: schedule/plan/shifts/shift-close/gantt,
     planning-domain revision, unrelated non-planning write does not stale
     planning `expectedRev`, legacy snapshot cannot overwrite planning slices
   - production execution: workspace actions, delayed/defect/repair/dispose,
     stale `expectedFlowVersion`
   - derived views: consistency after source-domain updates
   - messaging/profile: privacy, deeplink, delivered/read, push subscribe/unsubscribe/test
3. Для action-capable flows явно разделить и покрыть оба класса конфликтных сценариев:
   - local invalid-state / no-request stale-open path
   - server-side `409` / rejected-command path
4. Если действие доступно и из list route, и из detail/deeplink route, покрыть оба маршрута.
5. Не считать synthetic interceptor-based `409` достаточным доказательством там, где UI реально позволяет заранее открыть modal/dialog/panel и затем нажать confirm на устаревшем состоянии.
6. Убедиться, что тесты отражают текущие business-rules и target architecture одновременно.
7. Не ослаблять реальные проверки ради стабилизации CI.
8. Не смешивать этот batch с realtime normalization, кроме случаев, когда тест явно проверяет fallback.

Что нельзя делать:
- не менять business rules ради green tests
- не подменять conflict-path искусственным happy-path
- не ослаблять security/privacy checks
- не убирать существующие сложные сценарии без причины

После изменений обязательно проверить:
- domain and conflict E2E покрывают критичные сценарии
- revision/conflict model действительно проверяется в тестах
- business-rules не подменены тестовыми упрощениями
- real two-tab / multi-client stale-open scenarios покрыты там, где UI их допускает
- отдельно доказаны `local invalid-state / no-request` и `server-side 409` paths
- покрытие есть не только для list routes, но и для detail/deeplink routes, где action реально доступен

Формат ответа:
1. Какие domain/conflict E2E добавил или добил.
2. Какие critical scenarios теперь покрыты.
3. Какие тесты прогнал автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добрано E2E покрытие доменных success и conflict сценариев"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Выполни один безопасный сценарий по карточке.
2. Выполни один безопасный сценарий по production.
3. Проверь один сценарий по пользователю/правам, если у тебя есть доступ.
4. Если есть возможность, открой одну и ту же сущность в двух вкладках и попробуй вызвать конфликт.
5. Если конфликт все еще может тихо потерять данные, batch не закрыт.
