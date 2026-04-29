# Stage 8 Batch 8

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
- Это Stage 8: Migrate Production Planning Layer.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 9 и дальше:
  - не делать workspace/execution migration
  - не делать derived views migration
  - не делать messaging / realtime migration
- Нельзя заново переписывать Stage 1-7 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для
  planning-layer consistency.
- Нельзя делать big refactor "заодно".
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 8:
выделить production planning revision model из глобального `meta.revision`.

Почему это нужно:
- Stage 8 уже перевел planning write-path на production domain API.
- Но planning `revision.rev` не должен фактически быть global snapshot
  `meta.revision`.
- По target architecture `expectedRev` должен сравниваться с ревизией
  изменяемой сущности или доменного агрегата.

Цель:
- сделать planning conflict control доменным, а не snapshot-level
- сохранить текущий planning API contract и UX conflict handling
- не начинать Stage 9 execution migration

Что нужно сделать:
1. Провести точный audit текущего planning revision flow:
   - где формируется `getProductionPlanningRevision(...)`
   - где planning response возвращает `revision`
   - где клиент хранит `productionPlanningRevisionState`
   - где planning writes вызывают `assertProductionPlanningExpectedRevision(...)`
   - где database update инкрементит глобальный `meta.revision`
2. Выбрать минимальную модель для Stage 8:
   - предпочтительно coarse-grained domain aggregate revision для planning,
     если per-entity модель слишком велика для одного batch
   - допустимые варианты:
     - `meta.domainRevisions.productionPlanning`
     - или `meta.domainRevisions.production.schedule`,
       `production.plan`, `production.shifts`, `production.shiftClose`
     - или совместимый локальный объект ревизий, если он лучше вписывается в
       текущую JSON-модель
3. Реализовать server-side helpers так, чтобы:
   - `getProductionPlanningRevision(...)` больше не использовал
     `meta.revision` как фактический `rev`
   - planning successful mutations инкрементили relevant planning revision
   - unrelated non-planning writes не инкрементили planning revision
   - existing response shape `revision.entity`, `revision.rev`,
     `revision.source` остался совместимым
4. Обновить conflict checks:
   - `expectedRev` должен сравниваться с planning-domain revision
   - stale planning `expectedRev` должен давать `409`
   - conflict payload должен сохранять `entity`, `expectedRev`, `actualRev`,
     targeted planning slice payload и route-local refresh metadata
5. Сохранить совместимость клиента:
   - `productionPlanningRevisionState` должен получать новую revision model
   - existing planning commands должны продолжать отправлять `expectedRev`
   - после success/conflict должен оставаться route-local targeted refresh
6. Добавить или расширить E2E:
   - planning mutation инкрементит planning revision
   - stale planning revision дает `409`
   - unrelated non-planning write не инвалидирует planning `expectedRev`
   - `/api/production/planning/slice` возвращает revision с source, который
     больше не равен `meta.revision`
7. Не менять business meaning:
   - schedule assignments
   - plan add/move/delete/auto
   - shifts lifecycle
   - shift-close draft/finalize
   - gantt как read/detail route

Что нельзя делать:
- не использовать `meta.revision` как actual planning revision
- не переводить workspace/execution actions
- не переписывать всю persistence layer
- не делать per-entity mega-refactor, если coarse-grained planning revision
  закрывает Stage 8 безопасно
- не ломать legacy snapshot path для еще не мигрированных non-planning доменов

После изменений обязательно проверить:
- planning writes не идут через snapshot-save
- planning revision меняется от planning mutations
- unrelated non-planning write не меняет planning revision
- stale planning expectedRev дает `409`
- route-local refresh и conflict UX сохранились
- Stage 9 functionality не затронута

Формат ответа:
1. Какую planning revision model выбрал и почему.
2. Где теперь хранится planning revision.
3. Какие planning mutations инкрементят revision.
4. Доказательство, что `meta.revision` больше не является actual planning rev.
5. Какие тесты/сценарии проверил автоматически.
6. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
7. Остаточные риски и почему они не блокируют Stage 8.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Planning-layer производства получил отдельную модель ревизий"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/production/schedule`, `/production/plan`, `/production/shifts`.
2. Выполни одно безопасное planning-действие, если есть права.
3. Проверь, что действие сохранилось и маршрут не потерялся.
4. Обнови страницу `F5` и проверь, что состояние осталось.
5. Если можешь, открой planning-экран в двух вкладках:
   - в первой вкладке измени planning
   - во второй попробуй сохранить старое состояние
   - должен быть понятный конфликт, а не тихая перезапись
6. Проверь, что unrelated действие вне planning не создает ложный planning conflict.

### Batch считается принятым вручную, если:

- planning работает как раньше по бизнес-смыслу
- конфликт возникает при реальном устаревшем planning state
- unrelated non-planning изменения не ломают planning save
- экран не выбрасывает на другой route после success/conflict
