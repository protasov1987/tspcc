# Stage 12 Batch 9

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
- Это Stage 12: Normalize Realtime For Entire In-Scope Perimeter.
- Это финальная приемка Stage 12, а не implementation batch.
- Нельзя менять файлы приложения.
- Нельзя делать version bump.
- Нельзя начинать Stage 13.
- Если найдены blockers — перечисли их и предложи отдельный следующий implementation batch.
```

## Промт

```text
Нужно выполнить финальную проверку Stage 12 end-to-end после Batch 8.

Цель:
- подтвердить, что Stage 12 полностью соответствует target architecture для realtime/live behavior
- убедиться, что все проблемы из read-only аудита Stage 12 закрыты
- убедиться, что no-live/fallback proof не оставил hidden correctness dependency
- убедиться, что не повторены ошибки, найденные после `/workspace/:qr` Batch 2:
  lost events в debounce/in-flight/pending/ignore-window, stale cache reads,
  silently stale open subcontexts, synthetic-only proof
- ничего не исправлять в этом batch

Что нужно сделать:
1. Повторить финальный audit against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/current-state.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/*.md
2. Проверить весь Stage 12 scope:
   - production/workspace live
   - cards live
   - directories/security live
   - messaging live
   - fallback refresh
   - `[LIVE]` diagnostics
   - bootstrap/live start order
3. Подтвердить закрытие конкретных audit gaps:
   - production planning live refresh uses `/api/production/planning/slice`
   - production planning live does not replace `meta.domainRevisions.productionPlanning`
   - production execution live does not bypass `expectedFlowVersion -> 409`
   - workspace/execution refreshes card/flow through server truth
   - cards `card.*` events do not directly become working state
   - cards fallback uses `/api/cards-live` or route-safe targeted refresh
   - directories/security live no longer relies on direct mutation of `ops`, `areas`, `centers`, `users`, `accessLevels`
   - directories/security parse/handler errors are not silent and schedule fallback
   - messaging active conversation has full refresh/fallback
   - messaging unread/read/delivered correctness is server-based
   - chat has `[LIVE]` diagnostics and normalized parse warnings
   - repeated/overlapping live events do not get lost in any normalized domain
   - ignore/suppression windows schedule retry instead of silent no-op
   - live/fallback refresh reads server truth forced/no-cache or documented equivalent
   - visible open subcontexts are synchronized route-safe after live/fallback refresh
4. Подтвердить global Stage 12 criteria:
   - realtime нигде не обязателен для correctness
   - live only signals refresh
   - bootstrap never depends on live
   - standardized event/fallback behavior exists across in-scope domains
   - diagnostics useful and not noisy
   - real two-tab/multi-client proof exists for the major live families; synthetic
     events are not the only acceptance evidence
5. Подтвердить, что Stage 13 functionality не смешана в Stage 12:
   - no final legacy cleanup
   - no `/api/data` removal
   - no `saveData()` removal
   - no legacy messaging migration
6. Если Stage 12 еще не закрыт:
   - не вносить исправления
   - перечислить blockers
   - предложить отдельный следующий implementation batch

Формат ответа:
1. Выполнен ли Stage 12 полностью или нет.
2. Финальная таблица live paths и fallback refresh behavior.
3. Результат проверки отсутствия live correctness dependency.
4. Результат проверки закрытия audit gaps.
5. Результат проверки hardening после опыта Batch 2:
   repeated/overlapping events, ignore-window retry, no-cache reads, open subcontext sync,
   real two-tab proof.
6. Какие тесты/сценарии проверил автоматически.
7. Что нужно проверить вручную — отдельным чек-листом для обычного пользователя.
8. Если Stage 12 не закрыт: blockers и минимальный следующий implementation batch.
9. Какие остаточные риски остались.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 12.

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
- Stage 13 не был затронут без отдельной задачи
