# Stage 13 Batch 8

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
- Нельзя в этой задаче выполнять Stage 14.
- Нельзя заново переписывать Stage 1-12 целиком.
- Допустимо убирать только ту legacy-переходность, которая уже реально заменена новой моделью.
- Нельзя делать big refactor "заодно".
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 13:
добить removal-path и carve-out proof после cleanup cutover, с учетом
конкретной карты Stage13_batch1 audit.

Цель:
- не оставить unresolved adapter без removal path
- доказать, что `/api/data` больше не является critical write-path in-scope
- сохранить frozen `receipts` carve-out без расширения legacy роли

Что нужно сделать:
1. Провести audit после Batch 7:
   - `/api/data` usages
   - client `saveData()` usages
   - adapters / compatibility paths
   - route/write/live overlaps
   - legacy messaging overlap
   - docs/code drift after Stage 13 changes
2. Для каждого remaining legacy/adapter path явно классифицировать:
   - removed
   - allowed read/non-critical compatibility
   - out-of-scope receipts carve-out
   - temporary adapter with explicit removal path
   - blocker
3. Классифицировать как минимум эти ожидаемые remaining paths:
   - GET `/api/data` and scoped reads: allowed read compatibility или blocker
   - `POST /api/data`: removed/disabled или temporary compatibility with removal path
   - `preserveProtectedSlicesForLegacySnapshot`: keep guard with removal path или removed with proof
   - `js/app.73.receipts.js` leftovers: receipts carve-out или blocker
   - live fallback refresh: Stage 12 safety fallback или removable overlap
   - production areas layout localStorage migration: temporary adapter или removed
   - `/api/messages/*`: removed; docs must not claim it is active
4. Проверить Stage 8 protection:
   - если legacy snapshot protection для planning еще нужна, оставить с
     removal path
   - если не нужна, удалить только после proof, что snapshot writes больше не
     могут прийти из critical in-scope flows
5. Добавить или расширить tests/audit checks там, где cleanup proof слабый.
   Минимальные proof categories:
   - no `POST /api/data` for migrated UI actions
   - snapshot cannot overwrite planning/security/chat protected slices
   - two-tab stale action paths still show conflict/no-request behavior
6. Не начинать Stage 14.

Что нельзя делать:
- не удалять compatibility path без replacement proof
- не расширять receipts legacy carve-out
- не объявлять adapter harmless без removal path
- не делать perf/diagnostics hardening как цель этого batch
- не считать synthetic `409` единственным proof, если UI action имеет real
  two-tab/multi-client path

Формат ответа:
1. Финальная классификация remaining legacy/adapters.
2. Что удалено, что осталось и почему.
3. Какие tests/audit checks подтверждают cleanup.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остаточные риски и почему они не блокируют Stage 13.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Cleanup получил финальное подтверждение removal-path и carve-out"

После bump проверь, что запись появилась в docs/version-log.html.

Если менялись только docs/tests non-site без файлов приложения, применяй
Versioning Rule из AGENTS.md: bump нужен только для файлов сайта.
```

## Ручная проверка после Prompt

Обязательна.

1. Открой основные экраны сайта и выполни безопасные действия сохранения.
2. Проверь, что critical writes сохраняются через domain behavior.
3. Проверь, что после `F5` состояние совпадает.
4. Убедись, что receipts не менялся как часть cleanup.
5. Убедись, что чат работает через обычный профильный интерфейс.
6. Если какой-то adapter остался без понятного removal path, batch не закрыт.
