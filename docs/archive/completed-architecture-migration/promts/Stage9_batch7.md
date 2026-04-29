# Stage 9 Batch 7

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
- Нельзя в этой задаче выполнять Stage 10 и дальше:
  - не делать derived views migration
  - не делать messaging / realtime migration
  - не делать final legacy cleanup за пределами execution-layer
- Нельзя заново переписывать Stage 1-8 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для execution-layer consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно закрыть основной Stage 9 cutover после Batch 2-6.
Это НЕ финальная приемка Stage 9: после этого batch должны быть отдельные
Batch 8 для contract/proof hardening и Batch 9 для финальной проверки без
исправлений.

Цель:
- подтвердить, что основной execution write-path cutover выполнен
- добрать только минимальные исправления в workspace/execution layer
- не начать Stage 10 раньше времени

Что нужно сделать:
1. Проверить весь Stage 9 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/production-and-workspace.md
   - docs/business-rules/workorders-archive-and-items.md
2. Подтвердить Stage 9 scope:
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
3. Для каждого subdomain дать current path:
   - client open path
   - client confirm path
   - server endpoint
   - revision source
   - refresh path
4. Подтвердить, что Stage 10 functionality не смешана в Stage 9.
5. Если Stage 9 cutover еще не закрыт, внести только минимальные добивающие
   изменения в in-scope execution paths.

Дополнительно, с учетом практического опыта Stage 4, Stage 9 нельзя считать
закрытым, если:
- конкурентные UI-сценарии execution actions проверены только через
  искусственный `409`, а в реальном UI возможен local invalid-state /
  no-request path
- action доступен на разных routes или в разных UI-контекстах, но proof
  получен только для одного из них
- после конкурентного изменения остаются silent no-op / silent close /
  lone `alert(...)` / hidden `return` paths без понятного сообщения и
  targeted refresh
- отсутствие open/confirm flow в каком-то execution-сценарии просто
  предполагается, а не подтверждено явно

Критерий завершения Stage 9 cutover:
- все in-scope execution writes идут через explicit production commands
- сохраняется `expectedFlowVersion -> 409`
- execution concurrency основан на `card.flow.version`, а не на
  `meta.domainRevisions.productionPlanning`
- Stage 8 planning revision инкрементится только от planning mutations, а не
  от обычных execution commands
- conflict означает:
  - stay on route
  - show clear message
  - targeted production refresh
- no silent overwrite
- no correctness via pending-state tricks
- для action-capable execution flows отдельно доказаны `local invalid-state /
  no-request` и `server-side conflict` paths
- route-safe refresh подтвержден на list/detail/deeplink routes, где action
  реально доступен
- Stage 10 derived views migration еще не начат

Формат ответа:
1. Выполнен ли основной Stage 9 cutover или нет.
2. Финальная карта open/confirm/server/refresh paths по subdomain.
3. Что именно еще пришлось добить.
4. Какие тесты/сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом.
6. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен основной cutover execution-layer производства"

После bump проверь, что запись появилась в docs/version-log.html.
```

Важно: после этого batch Stage 9 еще не считается полностью закрытым, если
не доказаны отдельный execution revision/refresh contract, отсутствие
планировочных false-conflicts и финальная acceptance-проверка без исправлений.

## Ручная проверка после Prompt

Обязательна. Это ручная приемка Stage 9 cutover перед отдельными Batch 8/9.

### Финальный чек-лист для чайника

1. Открой основные execution-экраны:
   - `/workspace`
   - `/workspace/:qr`
   - `/production/delayed`
   - `/production/defects`
2. На доступных экранах выполни по одному безопасному тестовому действию.
3. После каждого действия проверь:
   - данные сохранились
   - маршрут не потерялся
   - после `F5` все осталось
4. Проверь сценарии ошибки/конфликта:
   - должно быть понятное сообщение
   - не должно быть тихой перезаписи
5. Убедись, что derived views не были переделаны заодно.
