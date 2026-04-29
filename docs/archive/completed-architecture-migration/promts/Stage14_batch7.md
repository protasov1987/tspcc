# Stage 14 Batch 7

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
Нужно закрыть implementation/proof gaps Stage 14 перед финальной acceptance.
Это НЕ финальная приемка всей migration-program: после этого batch должен быть
отдельный Batch 8, который только проверяет итоговое состояние без исправлений.

Цель:
- добить последние gaps по diagnostics, E2E и measured performance hardening
- подготовить доказательства для `Global Exit Criteria`
- не объявлять migration-plan завершенным внутри implementation batch

Что нужно сделать:
1. Проверить весь Stage 14 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - all docs/business-rules/*.md
2. Подтвердить выполнение:
   - normalized diagnostics `[BOOT]`, `[ROUTE]`, `[LIVE]`, `[DATA]`, `[CONFLICT]`
   - full E2E coverage for in-scope critical routes and conflict scenarios
   - perf work only after correctness completion and measurement
3. Явно подтвердить production proof после Stage 8/9:
   - planning writes не идут через snapshot-save
   - planning conflict model использует `meta.domainRevisions.productionPlanning`,
     а не global `meta.revision`
   - execution writes используют explicit commands и `expectedFlowVersion`
   - derived/realtime/final cleanup не откатили эти контракты
4. Проверить `Global Exit Criteria`.
5. Проверить, что `Definition Of Failure` больше не выполняется ни по одному пункту.
6. Подготовить данные для финальной приемки:
   - `receipts` не является частью current migration completion criteria
   - `receipts` не менялся в рамках этого плана
7. Если остается хоть один gap, назвать его прямо и оформить минимальный
   следующий implementation step, а не объявлять миграцию завершенной.

Дополнительно, с учетом практического опыта Stage 4, финальный успех нельзя объявлять, если proof держится только на synthetic `409`, mock-live или happy-path:
- для action-capable flows должен быть отдельно доказан real two-tab / multi-client scenario
- local invalid-state / no-request paths не могут оставаться неявными
- list/detail/deeplink route-safe refresh должен быть подтвержден там, где такие маршруты реально есть
- silent no-op / silent close / lone `alert(...)` / hidden `return` после конкурентного изменения считаются failure, а не мелкой доработкой

Что нельзя делать:
- не объявлять успех без доказательства
- не скрывать residual risks
- не подменять отсутствие E2E устными уверениями
- не считать временный тестовый допуск target SLA

Формат ответа:
1. Какие final proof gaps были закрыты.
2. Какие exit criteria теперь готовы к финальной acceptance-проверке.
3. Какие тесты и измерения это доказывают.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски или незакрытые gaps остались, если они есть.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершена финальная диагностика, E2E-подтверждение и performance hardening целевой архитектуры"

После bump проверь, что запись появилась в docs/version-log.html.
```

Важно: финальное объявление завершения migration-program выполняется только в
Stage14_batch8, где нельзя менять файлы приложения и нельзя исправлять найденные
blockers "по ходу проверки".

## Ручная проверка после Prompt

Обязательна. Это ручная проверка final proof gaps перед Stage14_batch8.

### Финальный чек-лист для чайника

1. Открой основные маршруты сайта:
   - `/cards`
   - `/cards/:id`
   - `/approvals`
   - `/departments`
   - `/users`
   - `/production/plan`
   - `/workspace`
   - `/workorders`
   - `/archive`
   - чат / профиль
2. На доступных экранах выполни по одному безопасному тестовому действию.
3. После каждого действия проверь:
   - данные сохраняются
   - маршрут не теряется
   - после `F5` состояние остается
4. Проверь конфликтный сценарий хотя бы в одной критичной зоне:
   - должна быть ошибка-конфликт, а не тихая перезапись
5. Проверь live/fallback:
   - при наличии второй вкладки данные обновляются
   - без доверия к live после `F5` состояние совпадает
6. Если умеешь, открой `F12 -> Console`:
   - есть полезные `[BOOT]`, `[ROUTE]`, `[LIVE]`, `[DATA]`, `[CONFLICT]`
   - нет бесконечного спама
7. Убедись, что `receipts` не трогали как часть этой migration-program.

### Stage 14 proof gaps считаются закрытыми вручную, если:

- весь in-scope perimeter работает по target architecture
- критичные writes domain-based
- route / boot / live correctness стабильны
- conflicts не теряются
- business-rules сохранены
- diagnostics и E2E действительно доказывают это состояние
