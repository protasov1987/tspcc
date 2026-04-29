# Stage 12 Batch 12

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
- docs/architecture/realtime-cards.md
- docs/architecture/realtime-directories-security.md
- docs/testing/realtime-production-workspace-checklist.md
- docs/testing/realtime-cards-checklist.md
- docs/testing/realtime-directories-security-checklist.md
- docs/business-rules/auth-and-navigation.md
- docs/business-rules/cards-and-approval.md
- docs/business-rules/directories-and-security.md
- docs/business-rules/production-and-workspace.md
- docs/business-rules/workorders-archive-and-items.md
- docs/business-rules/messaging-profile-and-notifications.md

Важно:
- Это Stage 12: Normalize Realtime For Entire In-Scope Perimeter.
- Это финальная приемка Stage 12 после Batch 10 и Batch 11.
- Это read-only/testing batch.
- Нельзя менять файлы приложения.
- Нельзя делать version bump.
- Нельзя начинать Stage 13.
- Нельзя исправлять blockers "по ходу проверки".
- Если найдены blockers — перечисли их и предложи отдельный следующий implementation batch.
```

## Промт

```text
Нужно выполнить завершающее тестирование Stage 12 end-to-end после Batch 10 и Batch 11.

Цель:
- подтвердить, что Stage 12 теперь полностью закрыт
- подтвердить, что blockers из Batch 9 устранены:
  - production planning `guard-active` noisy/skip blocker
  - workspace realtime SLA blockers
- убедиться, что no-live/fallback proof не оставил hidden correctness dependency
- убедиться, что Stage 13 functionality не смешана в Stage 12
- ничего не исправлять в этом batch

Что нужно сделать:
1. Повторить read-only audit against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/current-state.md
   - docs/architecture/change-checklist.md
   - docs/architecture/realtime-*.md
   - docs/testing/realtime-*.md
   - docs/business-rules/*.md
2. Проверить весь Stage 12 scope:
   - production/workspace live
   - cards live
   - directories/security live
   - messaging live
   - fallback refresh
   - `[LIVE]` diagnostics
   - bootstrap/live start order
3. Подтвердить закрытие Batch 9 blockers:
   - full `25.realtime-production-workspace-contract.spec.js` passes;
   - no `[CONFLICT] fallback refresh skipped ... productionPlanningLive... guard-active`
     critical warning in production planning fallback scenario;
   - full `02.workspace-realtime.spec.js` passes;
   - two-client workspace propagation stays within accepted SLA;
   - 20-client workspace propagation stays within accepted SLA;
   - if SLA was intentionally changed, docs/tests explain why and correctness proof remains intact.
4. Подтвердить закрытие Stage 12 audit gaps:
   - production planning live refresh uses `/api/production/planning/slice`
   - production planning live does not replace `meta.domainRevisions.productionPlanning`
   - production execution live does not bypass `expectedFlowVersion -> 409`
   - workspace/execution refreshes card/flow through server truth
   - cards `card.*` events do not directly become working state
   - cards fallback uses `/api/cards-live` or route-safe targeted refresh
   - directories/security live does not directly mutate `ops`, `areas`, `centers`,
     `users`, `accessLevels` as source of truth
   - directories/security parse/handler errors are not silent and schedule fallback
   - messaging active conversation has full refresh/fallback
   - messaging unread/read/delivered correctness is server-based
   - chat has `[LIVE]` diagnostics and normalized parse warnings
   - repeated/overlapping live events do not get lost in any normalized domain
   - ignore/suppression windows schedule retry instead of silent no-op
   - live/fallback refresh reads server truth forced/no-cache or documented equivalent
   - visible open subcontexts are synchronized route-safe after live/fallback refresh
5. Подтвердить global Stage 12 criteria:
   - realtime нигде не обязателен для correctness
   - live only signals refresh
   - bootstrap never depends on live
   - standardized event/fallback behavior exists across in-scope domains
   - diagnostics useful and not noisy
   - real two-tab/multi-client proof exists for major live families
   - synthetic events are not the only acceptance evidence
6. Подтвердить, что Stage 13 functionality не смешана в Stage 12:
   - no final legacy cleanup
   - no `/api/data` removal
   - no `saveData()` removal
   - no broad legacy messaging cleanup beyond already completed Stage 11 contract

Обязательные автоматические проверки:
- `npx playwright test tests/e2e/00.auth-routes.spec.js`
- `npx playwright test tests/e2e/02.workspace-realtime.spec.js`
- `npx playwright test tests/e2e/20.production-planning-foundation.spec.js`
- `npx playwright test tests/e2e/21.production-execution-contract.spec.js`
- `npx playwright test tests/e2e/23.messaging-profile-deeplink.spec.js`
- `npx playwright test tests/e2e/25.realtime-production-workspace-contract.spec.js`
- `npx playwright test tests/e2e/26.realtime-cards-live-contract.spec.js`
- `npx playwright test tests/e2e/27.realtime-directories-security-contract.spec.js`

Если полный набор слишком тяжелый для одного запуска:
- запускать specs по одному;
- фиксировать точную команду и результат каждого spec;
- не считать Stage 12 закрытым при любом failed или skipped по blocker-причине.

Формат ответа:
1. Выполнен ли Stage 12 полностью или нет.
2. Подтверждение закрытия Batch 9 blockers.
3. Финальная таблица live paths и fallback refresh behavior.
4. Результат проверки отсутствия live correctness dependency.
5. Результат проверки закрытия audit gaps.
6. Результат проверки hardening:
   repeated/overlapping events, ignore-window retry, no-cache reads,
   open subcontext sync, real two-tab/multi-client proof.
7. Какие тесты/сценарии проверил автоматически.
8. Что нужно проверить вручную — отдельным чек-листом для обычного пользователя.
9. Если Stage 12 не закрыт: blockers и минимальный следующий implementation batch.
10. Какие остаточные риски остались.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 12.

### Чек-лист для обычного пользователя

1. Открой сайт в двух вкладках.
2. Проверь cards:
   - создать/изменить/удалить безопасную тестовую МК;
   - вторая вкладка обновляется без `F5`;
   - после `F5` состояние совпадает.
3. Проверь production planning:
   - открыть `/production/plan`;
   - внести безопасное изменение, влияющее на список;
   - обновление видно без `F5`;
   - в консоли нет noisy `guard-active` warnings.
4. Проверь workspace:
   - открыть `/workspace` в двух вкладках;
   - выполнить безопасное действие;
   - вторая вкладка обновляется без `F5` в приемлемое время;
   - `/workspace/<qr>` не теряет маршрут.
5. Проверь directories/security:
   - изменить безопасный справочник или тестового пользователя;
   - другая вкладка обновляется без `F5`;
   - права текущего пользователя не вызывают лишний redirect, если route разрешен.
6. Проверь chat:
   - отправить сообщение между двумя пользователями;
   - unread/read/delivered state обновляется;
   - после `F5` состояние совпадает.
7. Проверь, что сайт открывается после `F5` на защищенных маршрутах.
8. Проверь, что Back/Forward работают без перехода на dashboard.
9. Проверь, что live помогает обновляться, но не нужен для correctness.
10. Убедись, что Stage 13 cleanup не был сделан в рамках Stage 12.

### Stage 12 считается принят вручную, если:

- live помогает обновляться, но не нужен для correctness
- fallback refresh работает
- production planning refresh идет через planning slice
- production execution не обходит `expectedFlowVersion`
- cards/directories/security/messaging не используют live payload как source of truth
- repeated/overlapping events не теряются
- live/fallback refresh не читает stale cache
- открытые модалки/subviews/counters обновляются или получают понятное fallback поведение
- bootstrap не зависит от live
- `[LIVE]` diagnostics полезны и не шумят
- Batch 9 blockers не воспроизводятся
- Stage 13 не был затронут без отдельной задачи

