# Stage 12 Batch 10

## Общий префикс для каждого промта

```text
Работай строго по:
- AGENTS.md
- docs/architecture/target-architecture.md
- docs/architecture/migration-plan.md
- docs/architecture/current-state.md
- docs/architecture/change-checklist.md
- docs/architecture/realtime-foundation.md
- docs/architecture/realtime-production-workspace.md
- docs/business-rules/auth-and-navigation.md
- docs/business-rules/cards-and-approval.md
- docs/business-rules/directories-and-security.md
- docs/business-rules/production-and-workspace.md
- docs/business-rules/workorders-archive-and-items.md
- docs/business-rules/messaging-profile-and-notifications.md

Важно:
- Это Stage 12: Normalize Realtime For Entire In-Scope Perimeter.
- Это implementation hardening batch после финальной проверки Batch 9.
- Исправлять только найденный Stage 12 blocker в production planning live/fallback.
- Нельзя менять бизнес-логику production planning.
- Нельзя менять Stage 8/9 write/conflict contracts.
- Нельзя трогать receipts как домен.
- Если нужный Stage 12 helper физически расположен в файле с receipts-кодом,
  трогать можно только этот non-receipts helper; бизнес-логику receipts не менять.
- Нельзя выполнять Stage 13 cleanup:
  no `/api/data` removal, no `saveData()` removal, no final legacy cleanup.
- Нельзя делать Stage 14 performance rewrite.
- Нельзя просто заглушить diagnostic warning без понимания причины.
- Сначала проведи точную диагностику по коду и тесту, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 12:
закрыть production planning live/fallback blocker, найденный в Batch 9.

Контекст blocker:
- Полный прогон `tests/e2e/25.realtime-production-workspace-contract.spec.js`
  падает во втором тесте:
  `planning fallback refresh runs when app live stream is unavailable`.
- В консоли остается:
  `[CONFLICT] fallback refresh skipped { guardKey: productionPlanningLive:plan:/production/plan, reason: guard-active }`.
- Изолированный rerun этого теста проходит.
- Остальные production/workspace Stage 12 tests проходят, если исключить этот тест.

Цель:
- убрать suite-order/state-leak blocker между последовательными planning live/fallback сценариями
- сохранить production planning source-of-truth refresh через `/api/production/planning/slice`
- сохранить полезную диагностику без ложного `[CONFLICT]` noise
- не скрыть реальную проблему простым добавлением warning в ignore-list

Что нужно сделать:
1. Провести точную диагностику:
   - почему `runClientConflictRefreshOnce()` / guardKey
     `productionPlanningLive:plan:/production/plan` остается active при следующем тесте;
   - это реальный незавершенный refresh, overlap нескольких refresh, route cleanup gap,
     stale `sessionStorage` guard или диагностический false positive;
   - почему full spec падает, а isolated test проходит.
2. Проверить affected code paths:
   - `runProductionLiveRefresh()`
   - `scheduleProductionLiveRefresh()`
   - `refreshProductionPlanningRouteLocal()`
   - `runClientConflictRefreshOnce()`
   - route cleanup / stop live hooks for production routes
   - tests/e2e/25.realtime-production-workspace-contract.spec.js
3. Исправить минимально:
   - overlapping production planning live refresh не должен оставлять stale guard;
   - fallback refresh после unavailable app stream должен либо дождаться active refresh,
     либо поставить retry/pending, но не завершаться silent skip;
   - если skip действительно expected, он должен логироваться как `[LIVE]` pending/retry,
     а не как `[CONFLICT]` critical warning;
   - affected hints/reasons не должны теряться при guard-active/pending path.
4. Подтвердить Stage 12 invariants:
   - planning live/fallback reads use `/api/production/planning/slice`
   - reads are forced/no-cache
   - live payload не становится source of truth
   - `meta.domainRevisions.productionPlanning` остается revision source,
     но live refresh не подменяет его локальным payload
   - bootstrap не зависит от live
5. Не менять unrelated production execution, cards, directories/security, messaging.
6. Не начинать Stage 13.

Обязательные автоматические проверки:
- `npx playwright test tests/e2e/25.realtime-production-workspace-contract.spec.js`
- `npx playwright test tests/e2e/26.realtime-cards-live-contract.spec.js`
- если менялись shared live helpers:
  `npx playwright test tests/e2e/27.realtime-directories-security-contract.spec.js`

Критерий приемки Batch 10:
- полный `25.realtime-production-workspace-contract.spec.js` проходит без
  `guard-active` critical console warning
- production planning fallback after previous planning live scenario не теряет refresh
- no-cache planning slice read подтвержден тестом
- `[LIVE]` diagnostics остаются полезными и не шумят
- Stage 13 cleanup не затронут

Формат ответа:
1. Что было причиной `guard-active` blocker.
2. Какие минимальные изменения внесены.
3. Почему это Stage 12 hardening, а не Stage 13/14.
4. Таблица: path -> old behavior -> new behavior -> source of truth.
5. Какие тесты запущены и результат.
6. Что проверить вручную.
7. Остаточные риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Исправлена повторная fallback-синхронизация production planning"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для обычного пользователя

1. Открой `/production/plan`.
2. Открой консоль браузера, если умеешь.
3. В другой вкладке измени безопасные данные карточки, влияющие на production planning.
4. Убедись, что `/production/plan` обновился без `F5`.
5. Обнови `/production/plan` через `F5` и проверь, что состояние совпадает.
6. Если live временно недоступен, убедись, что страница не ломается и после fallback показывает server truth.
7. Проверь, что в консоли нет повторяющегося `[CONFLICT] fallback refresh skipped ... guard-active`.

### Batch 10 считается принятым вручную, если:

- production planning live/fallback не требует ручного `F5`
- route `/production/plan` не теряется
- нет noisy `[CONFLICT] guard-active` warning
- live остается только сигналом refresh
- Stage 13 не затронут

