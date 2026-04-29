# Stage 6 Batch 5

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
- Это Stage 6: Migrate Directories.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 7 и дальше:
  - не делать security migration
  - не делать production migration
  - не делать messaging migration
- Нельзя заново переписывать Stage 3/4/5 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для directory-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 6:
перевести shift times на отдельный domain API отдельным batch после core directories и employees assignment.

Цель:
- убрать write-path `shift times` из snapshot save
- сохранить production compatibility, потому что shift times напрямую участвуют в planning/workspace behavior
- не смешивать эту миграцию с areas, которые уже должны быть закрыты в batch 2-3

Что нужно сделать:
1. Найти server-side и client-side flow только для shift times:
   - route `/shift-times`
   - save / confirm path
   - live refresh / SSE path
2. Перевести save shift times на explicit domain API.
3. Сохранить обязательные правила:
   - permission checks
   - revision checks where needed
   - current business semantics, включая нормализацию значений
4. Сделать понятным local invalid-state / no-request path и server conflict path.
5. Обеспечить targeted refresh `shift times` без redirect и подтвердить,
   что production readers продолжают получать совместимые данные.

Что нельзя делать:
- не менять production business logic
- не смешивать этот batch с planning migration
- не возвращаться к areas migration
- не ломать existing identifiers/texts, которые уже используются production
- не трогать users/access levels

После изменений обязательно проверить:
- shift times больше не зависят от `/api/data`
- production dependencies не сломаны
- route и контекст не теряются после save/conflict
- two-tab proof есть хотя бы для `/shift-times`

Формат ответа:
1. Какие shift times paths перевел.
2. Что именно сделал для сохранения production compatibility.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Времена смен переведены на отдельный API справочников"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/shift-times`.
2. Измени одно безопасное время смены и сохрани.
3. Проверь:
   - изменения сохранились
   - маршрут не потерялся
   - после `F5` все осталось
4. Если можешь, открой `/shift-times` в двух вкладках и попробуй конкурентное сохранение.
5. После этого открой один production-экран, который использует эти данные, например `/production/plan`.
6. Проверь, что экран открывается и не выглядит сломанным.
7. Если после изменения справочника production-экран ломается или конфликт молча проглатывается, batch не закрыт.
