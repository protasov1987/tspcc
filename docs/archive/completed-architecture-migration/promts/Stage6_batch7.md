# Stage 6 Batch 7

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
Нужно закрыть Stage 6 end-to-end после предыдущих batch.

Цель:
- подтвердить, что Stage 6 действительно выполнен полностью
- не начать Stage 7 раньше времени
- добрать только минимальные проверки и исправления для directory-domain

Что нужно сделать:
1. Проверить весь Stage 6 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/directories-and-security.md
   - docs/business-rules/production-and-workspace.md
2. Подтвердить, что Stage 6 теперь покрывает:
   - departments / centers
   - operations
   - areas
   - employees assignment
   - shift times
3. Подтвердить, что Stage 7 functionality не смешана в Stage 6.
4. Если Stage 6 еще не закрыт, внести только минимальные добивающие изменения.
5. В ответе явно зафиксировать для каждого action-capable flow:
   - open path
   - confirm / submit path
   - local invalid-state / no-request path
   - server-side conflict / rejected-command path
   - какие реальные routes участвуют

Дополнительно, с учетом практического опыта Stage 4, Stage 6 нельзя считать закрытым, если:
- конкурентные UI-сценарии для directory actions проверены только через искусственный `409`, а в реальном UI возможен local invalid-state / no-request path
- directory action доступен на разных routes или в разных UI-контекстах, но proof получен только для одного из них
- после конкурентного изменения остаются silent no-op / silent close / lone `alert(...)` / hidden `return` paths без понятного сообщения и route-safe refresh
- отсутствие open/confirm flow в каком-то directory-сценарии просто предполагается, а не подтверждено явно
- для list-only subdomain искусственно придуман detail/deeplink route вместо честной фиксации, что таких routes сейчас нет

Критерий завершения Stage 6:
- нет directory writes через `/api/data`
- сервер валидирует права и revision where needed
- department delete guard сохранен
- operation type guard сохранен
- historical text preservation сохранен
- production dependencies on areas / shift times не сломаны
- для action-capable directory flows отдельно доказаны `local invalid-state / no-request` и `server-side conflict` paths
- route-safe refresh подтвержден на list/detail/deeplink routes, где directory action реально доступен
- для `/departments`, `/operations`, `/areas`, `/employees`, `/shift-times` есть реальный two-tab / multi-client proof, а не только mock/interceptor
- Stage 7 security migration еще не начат

Формат ответа:
1. Выполнен ли Stage 6 полностью или нет.
2. Что именно еще пришлось добить.
3. Какие тесты/сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен переход справочников на отдельные доменные API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 6.

### Финальный чек-лист для чайника

1. Открой основные экраны справочников:
   - `/departments`
   - `/operations`
   - `/areas`
   - `/employees`
   - `/shift-times`
2. Для каждого экрана попробуй одно безопасное изменение.
3. После каждого изменения проверь:
   - данные сохранились
   - маршрут не потерялся
   - после `F5` все осталось
4. Для двух-трех экранов проведи сценарий в двух вкладках:
   - одна вкладка сохраняет новое состояние
   - вторая пытается сохранить устаревшее
5. Проверь, что конфликт не скрывается и экран не "молчит".
6. Проверь защитные правила:
   - нельзя удалить подразделение, если для него должен действовать запрет
   - нельзя сломать operation type guard
7. Открой один-два экрана, которые используют справочники:
   - карточку
   - `/production/plan`
8. Проверь, что они продолжают открываться и выглядят нормально.
9. Если есть исторические карточки или старые данные:
   - их тексты операций не должны неожиданно сломаться
10. Убедись, что users/access levels и другой security-domain не был "переделан заодно".

### Stage 6 считается принятым вручную, если:

- все основные справочники редактируются и сохраняются
- snapshot-path для directory writes больше не является рабочим путем
- защитные правила не сломаны
- real two-tab conflict path подтвержден и не сводится к молчаливому no-op
- production и cards продолжают читать directory data корректно
- Stage 7 не был затронут без отдельной задачи
