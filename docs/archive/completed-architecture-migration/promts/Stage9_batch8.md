# Stage 9 Batch 8

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
- Нельзя делать big refactor "заодно".
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 9:
добить и доказать execution revision/refresh contract после write-path cutover.

Почему это нужно:
- Stage 9 cutover сам по себе не доказывает единый conflict contract.
- По опыту Stage 8 отдельная acceptance невозможна, пока revision/conflict
  модель не доказана отдельно от write-path migration.

Цель:
- доказать, что `expectedFlowVersion -> 409` работает как execution-domain
  contract
- доказать, что execution conflict model не смешана со Stage 8 planning revision
- закрепить route-safe targeted refresh для list/detail/deeplink contexts
- добавить real two-tab proof там, где synthetic `409` недостаточен

Что нужно сделать:
1. Провести audit всех execution commands после Batch 7:
   - `/api/production/flow/*`
   - `/api/production/personal-operation/*`
   - `/api/production/operation/*`
   - workspace / personal operations
   - identify / transfer / material issue / material return
   - drying / delayed / defects / repair / dispose
2. Подтвердить или добить единый contract:
   - клиент отправляет `expectedFlowVersion`
   - сервер сравнивает его с `card.flow.version`
   - stale execution state дает `409 Conflict`
   - conflict payload содержит понятное сообщение и refresh metadata или
     достаточные данные для targeted refresh
3. Проверить, что execution commands не используют
   `meta.domainRevisions.productionPlanning` как фактическую revision.
4. Проверить, что обычные execution commands не инкрементят planning revision,
   если не выполняют явную planning mutation.
5. Добавить или расширить E2E/API coverage:
   - success execution command инкрементит flow version
   - stale `expectedFlowVersion` дает `409`
   - conflict оставляет текущий route/context
   - route-safe refresh работает для `/workspace`, `/workspace/:qr`,
     `/production/delayed`, `/production/defects`
   - real two-tab сценарий проверяет representative action, а не только
     mocked/intercepted 409
6. Для flows без open/confirm modal явно написать, что modal path отсутствует,
   и чем вместо него доказан route-safe refresh.
7. Не начинать Stage 10 и не переписывать realtime normalization.

Что нельзя делать:
- не использовать planning revision как execution revision
- не возвращать execution writes на `/api/data`
- не менять business meaning execution actions
- не переписывать Stage 12 realtime
- не мигрировать derived views

Формат ответа:
1. Как устроен final execution revision/refresh contract.
2. Какие commands используют `expectedFlowVersion`.
3. Где доказано отсутствие planning false-conflicts.
4. Какие тесты/сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом.
6. Остаточные риски и почему они не блокируют Stage 9.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Execution-layer получил финальный contract ревизий и refresh"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/workspace` и один detail route `/workspace/<qr>`, если он доступен.
2. Выполни безопасное execution-действие.
3. Проверь, что маршрут не потерялся и после `F5` состояние сохранилось.
4. Если можешь, повтори конфликт в двух вкладках:
   - во второй вкладке должно быть понятное сообщение о конфликте
   - экран должен остаться на текущем маршруте
5. Убедись, что planning-экраны не получили ложный конфликт от обычного execution-действия.
