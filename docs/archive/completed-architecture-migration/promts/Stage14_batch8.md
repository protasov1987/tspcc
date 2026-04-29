# Stage 14 Batch 8

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
- Это финальная acceptance-проверка Stage 14 и всей migration-program.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя менять файлы приложения.
- Нельзя делать version bump.
- Нельзя исправлять найденные blockers "по ходу проверки".
- Если остается хоть один gap, migration-program НЕ считается завершенной.
```

## Промт

```text
Нужно выполнить финальную проверку Stage 14 end-to-end и подтвердить достижение
target architecture для всего in-scope perimeter.

Цель:
- доказать, что migration-plan завершен
- подтвердить `Global Exit Criteria`
- исключить состояния из `Definition Of Failure`
- ничего не исправлять в этом batch

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
3. Проверить `Global Exit Criteria`.
4. Проверить, что `Definition Of Failure` больше не выполняется ни по одному пункту.
5. Явно подтвердить production proof после Stage 8/9:
   - planning writes не идут через snapshot-save
   - planning conflict model использует `meta.domainRevisions.productionPlanning`,
     а не global `meta.revision`
   - execution writes используют explicit commands и `expectedFlowVersion`
   - derived/realtime/final cleanup не откатили эти контракты
6. Явно подтвердить, что:
   - `receipts` не является частью current migration completion criteria
   - `receipts` не менялся в рамках этого плана
7. Если остается хоть один gap:
   - не объявлять миграцию завершенной
   - перечислить blockers
   - предложить отдельный следующий implementation batch с минимальным scope

Формат ответа:
1. Завершена ли миграция полностью или нет.
2. Какие exit criteria подтверждены.
3. Какие тесты и измерения это доказывают.
4. Что нужно проверить вручную — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски или незакрытые gaps остались, если они есть.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка всей migration-program.

### Миграция считается принятой вручную, если:

- весь in-scope perimeter работает по target architecture
- критичные writes domain-based
- route / boot / live correctness стабильны
- conflicts не теряются
- business-rules сохранены
- diagnostics и E2E действительно доказывают это состояние
- receipts не трогали как часть migration-program
