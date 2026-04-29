# Stage 12 Batch 11

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
- docs/testing/realtime-production-workspace-checklist.md
- docs/business-rules/auth-and-navigation.md
- docs/business-rules/cards-and-approval.md
- docs/business-rules/directories-and-security.md
- docs/business-rules/production-and-workspace.md
- docs/business-rules/workorders-archive-and-items.md
- docs/business-rules/messaging-profile-and-notifications.md

Важно:
- Это Stage 12: Normalize Realtime For Entire In-Scope Perimeter.
- Это implementation hardening batch после Batch 10.
- Исправлять только workspace realtime acceptance blockers из Batch 9.
- Нельзя менять бизнес-логику workspace/execution.
- Нельзя обходить `expectedFlowVersion -> 409`.
- Нельзя делать general performance rewrite Stage 14.
- Нельзя просто увеличивать SLA/timeout без измерений, причины и документации.
- Нельзя делать correctness через обязательный realtime.
- Нельзя выполнять Stage 13 cleanup:
  no `/api/data` removal, no `saveData()` removal, no final legacy cleanup.
- Нельзя трогать receipts как домен.
- Если нужный Stage 12 helper физически расположен в файле с receipts-кодом,
  трогать можно только этот non-receipts helper; бизнес-логику receipts не менять.
- Сначала измерь и докажи bottleneck, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 12:
закрыть workspace realtime acceptance blockers, найденные в Batch 9.

Контекст blockers:
- `tests/e2e/02.workspace-realtime.spec.js`
  `propagates workspace action between two live clients without F5`
  стабильно получает ~3.8-5.2s при SLA 2500ms.
- `tests/e2e/02.workspace-realtime.spec.js`
  `supports 20 concurrent live clients observing one confirmed change`
  получил ~5.7s при SLA 4500ms.
- При этом correctness сценарии из Stage 12 `25.realtime-production-workspace-contract.spec.js`
  проходят, если исключить Batch 10 blocker.

Цель:
- добиться прохождения workspace realtime acceptance tests без потери correctness
- сохранить server truth модель: live only signals refresh
- не возвращать workspace на synthetic payload patch как source of truth
- не обходить execution conflict model
- не превращать Stage 12 в Stage 14 perf-refactor

Что нужно сделать:
1. Провести измерение workspace realtime path end-to-end:
   - actor click/action submit
   - server response/write duration
   - SSE event delivery
   - observer live scheduler delay
   - observer forced server refresh
   - observer row/detail patch
2. Найти причину превышения SLA:
   - лишний debounce/delay
   - unnecessary production-scope fallback вместо targeted `/api/cards-core/:id`
   - lost target ids leading to broader refresh
   - same-tab suppression accidentally delaying other clients
   - route/detail sync doing full route work where local patch is enough
   - slow test fixture/data path unrelated to live scheduling
3. Исправить минимально в Stage 12 perimeter:
   - observer should prefer targeted card refresh when affected id is known;
   - debounce/in-flight/pending should coalesce without losing ids and without avoidable delay;
   - ignore/suppression windows should schedule retry, not wait longer than needed;
   - open `/workspace` and `/workspace/:qr` contexts should sync route-safe;
   - same-tab local patch should not block other clients from timely server refresh.
4. Если измерение доказывает, что текущий SLA нереалистичен только для локального
   тестового окружения, допускается изменить SLA только при одновременном выполнении:
   - correctness не зависит от live;
   - есть измерение и короткий комментарий в тесте;
   - обновлен соответствующий docs/testing или architecture note;
   - изменение SLA не скрывает lost events, stale cache или stale open subcontext.
   Простое повышение timeout без доказательства запрещено.
5. Проверить, что `/workspace/:qr` hardening после Stage 12 Batch 2 не регресснул:
   - repeated/overlapping events do not get lost
   - no stale cache reads
   - open comments/files/modal contexts synchronize or get clear fallback
   - real two-tab proof exists
6. Не менять production planning fix из Batch 10.
7. Не начинать Stage 13.

Обязательные автоматические проверки:
- `npx playwright test tests/e2e/02.workspace-realtime.spec.js`
- `npx playwright test tests/e2e/25.realtime-production-workspace-contract.spec.js`
- `npx playwright test tests/e2e/00.auth-routes.spec.js`

Дополнительные проверки, если менялись shared live helpers:
- `npx playwright test tests/e2e/26.realtime-cards-live-contract.spec.js`
- `npx playwright test tests/e2e/27.realtime-directories-security-contract.spec.js`

Критерий приемки Batch 11:
- полный `02.workspace-realtime.spec.js` проходит
- two-client и 20-client workspace live tests проходят без `F5`
- `25.realtime-production-workspace-contract.spec.js` продолжает проходить
- workspace live refresh читает server truth forced/no-cache или документированный equivalent
- `expectedFlowVersion -> 409` не обойден
- Stage 13 cleanup не затронут

Формат ответа:
1. Что было причиной workspace realtime SLA blockers.
2. Какие измерения сделал и какие числа получил before/after.
3. Какие минимальные изменения внесены.
4. Почему correctness не зависит от realtime.
5. Таблица: workspace path -> live signal -> refresh path -> UI sync -> SLA result.
6. Какие тесты запущены и результат.
7. Что проверить вручную.
8. Остаточные риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Ускорена live-синхронизация рабочего места без зависимости от realtime"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для обычного пользователя

1. Открой `/workspace` в двух вкладках.
2. В первой вкладке выполни безопасное действие по операции:
   `Начать`, `Пауза` или `Продолжить`.
3. Во второй вкладке убедись, что состояние изменилось без `F5`.
4. Открой `/workspace/<qr>` в двух вкладках.
5. Повтори безопасное действие или добавь комментарий, если сценарий доступен.
6. Убедись, что detail-route не сброшен и открытый контекст обновился.
7. Обнови страницу через `F5` и проверь, что состояние совпадает.
8. Если умеешь, проверь консоль:
   - `[LIVE]` логи есть по делу
   - нет бесконечного spam
   - нет `Версия flow устарела` после обычного live refresh

### Batch 11 считается принятым вручную, если:

- workspace обновляется между вкладками без `F5`
- `/workspace/:qr` не теряет route
- repeated action cycles не создают ложный stale flow
- live остается только сигналом refresh
- fallback/F5 показывают то же server truth состояние
- Stage 13 не затронут

