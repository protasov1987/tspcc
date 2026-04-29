# Stage 8 Batch 9

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
Нужно выполнить финальную проверку Stage 8 end-to-end после Batch 8.

Цель:
- подтвердить, что Stage 8 полностью соответствует target architecture для
  production planning layer
- убедиться, что planning write-path cutover и planning revision model не
  оставили скрытых legacy-overlap
- не начать Stage 9 раньше времени
- ничего не исправлять в этом batch: это финальная приемка, а не implementation
  batch

Что нужно сделать:
1. Повторить финальный audit against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/current-state.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/production-and-workspace.md
   - docs/business-rules/workorders-archive-and-items.md
2. Проверить весь Stage 8 scope:
   - production schedule
   - production plan
   - production shifts
   - shift-close detail route
   - gantt read/detail route
   - planning validations
3. Подтвердить write-path criteria:
   - no planning writes through `saveData()`
   - no planning writes through `/api/data`
   - no stale parallel client path
   - no duplicate shift-close handlers
4. Подтвердить revision criteria:
   - planning `expectedRev` сравнивается с planning-domain revision
   - `meta.revision` не является actual planning revision
   - unrelated non-planning write не инвалидирует planning `expectedRev`
   - successful planning mutation инкрементит relevant planning revision
   - stale planning revision дает `409`
5. Подтвердить route and UX criteria:
   - success остается на текущем route
   - conflict остается на текущем route
   - route-local targeted refresh работает для list/detail/deeplink routes
   - user получает понятное сообщение при validation/conflict
6. Подтвердить, что Stage 9 functionality не смешана в Stage 8:
   - workspace/execution actions не были мигрированы в этом batch
   - delayed/defects/repair/dispose не переписаны "заодно"
   - derived views migration не начата
7. Если Stage 8 еще не закрыт:
   - не вносить исправления в рамках этого batch
   - перечислить blockers
   - предложить отдельный следующий implementation batch с минимальным scope

Критерий завершения Stage 8:
- no planning writes through snapshot-save
- используются только targeted production slice updates
- planning имеет отдельную revision/conflict model, не основанную на
  `meta.revision`
- no correctness based on heavy local shadow state
- route-local refresh работает для planning pages
- planning validations сохранены
- action-capable planning flows имеют доказанные `local invalid-state /
  no-request` и `server-side conflict` paths
- `/production/gantt/:card` подтвержден как read/detail route после planning
  mutations
- Stage 9 execution migration еще не начат

Что нельзя делать в этом batch:
- менять файлы приложения
- менять бизнес-логику
- делать version bump
- начинать Stage 9
- исправлять найденные blockers "по ходу проверки"

Формат ответа:
1. Выполнен ли Stage 8 полностью или нет.
2. Финальная таблица in-scope planning write-paths и их API.
3. Финальная таблица planning revision entities / increments / conflict checks.
4. Результат проверки отсутствия planning writes через snapshot-save.
5. Доказательство, что unrelated non-planning writes не создают stale planning conflict.
6. Какие тесты/сценарии проверил автоматически.
7. Что нужно проверить вручную — отдельным чек-листом для обычного пользователя.
8. Если Stage 8 не закрыт: blockers и минимальный следующий implementation batch.
9. Какие остаточные риски остались.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 8.

### Финальный чек-лист для чайника

1. Открой основные planning-экраны:
   - `/production/schedule`
   - `/production/plan`
   - `/production/shifts`
   - `/production/shifts/<ключ смены>`, если есть открытая/закрытая смена
   - `/production/gantt/<карта>`, если есть планируемая карта
2. Для каждого экрана выполни по одному безопасному тестовому действию, если
   у тебя есть доступ.
3. После каждого действия проверь:
   - данные сохранились
   - маршрут не потерялся
   - после `F5` все осталось
4. Проверь сценарии ошибки/валидации:
   - должно быть понятное сообщение
   - экран не должен ломаться
5. Если можешь, попробуй конфликтный сценарий в двух вкладках:
   - должен быть конфликт, а не тихая перезапись
   - после конфликта маршрут должен сохраниться
6. Проверь ложный конфликт:
   - открой planning-экран
   - выполни unrelated действие вне planning в другой вкладке
   - planning save не должен падать только из-за unrelated изменения
7. Убедись, что workspace/execution не были "переделаны заодно".

### Stage 8 считается принятым вручную, если:

- planning pages работают и сохраняют данные
- snapshot-path для planning writes больше не является рабочим путем
- planning revision не основана на глобальном `meta.revision`
- targeted refresh и route-local behavior работают
- validations и conflict behavior не сломаны
- shift-close detail-route работает отдельно от списка смен
- gantt работает как актуальное read/detail представление
- Stage 9 не был затронут без отдельной задачи
