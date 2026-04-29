# Stage 6 Batch 3

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
добить conflict-handling, route-safe refresh и cleanup для core directories после batch 2.

Цель:
- убрать остаточные legacy-path и silent no-op в:
  - departments / centers
  - operations
  - operation-area bindings
  - areas
- довести эти flow до реального revision-safe поведения
- подготовить надежную базу перед переходом к employees assignment

Что нужно сделать:
1. Проверить все action-capable flow из batch 2 по матрице:
   - open path
   - confirm / submit path
   - local invalid-state / no-request path
   - server-side conflict / rejected-command path
2. Убрать остаточные hidden `return`, silent close, lone `alert(...)` или last-write-wins,
   если они мешают понятному поведению пользователя.
3. Добить targeted refresh и consistent UI response для list routes:
   - `/departments`
   - `/operations`
   - `/areas`
4. Проверить, что operation-area bindings и area type change не оставляют рассинхрон между `/operations` и `/areas`.
5. Добавить или расширить automated coverage на реальные two-tab / multi-client сценарии,
   а не только на искусственный `409`.

Что нельзя делать:
- не возвращать write-path в `/api/data`
- не трогать employees assignment и shift times
- не начинать users / access levels migration
- не придумывать новые маршруты вместо исправления текущих list-flow

После изменений обязательно проверить:
- local invalid-state path и server conflict path различимы и понятны пользователю
- `/departments`, `/operations`, `/areas` остаются route-safe после save/delete/conflict
- остаточные snapshot-зависимости для core directories действительно убраны
- automatic proof покрывает реальные конкурентные сценарии

Формат ответа:
1. Какие core directory flow добил после batch 2.
2. Где убрал silent no-op / hidden return / weak conflict-path.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Усилена conflict-обработка справочников подразделений, операций и участков"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой в двух вкладках `/departments`, `/operations` или `/areas`.
2. В первой вкладке измени сущность и сохрани.
3. Во второй вкладке попробуй сохранить устаревшее состояние.
4. Проверь:
   - есть понятное сообщение о конфликте или отклонении
   - экран не "молчит"
   - маршрут не теряется
5. На `/departments` отдельно проверь запрет удаления подразделения с сотрудниками.
6. На `/operations` отдельно проверь, что проблемный сценарий смены типа операции по-прежнему запрещен.
7. Если конфликт или локальная невалидность приводят к молчаливому "ничего не произошло", batch не закрыт.
