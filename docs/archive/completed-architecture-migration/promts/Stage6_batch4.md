# Stage 6 Batch 4

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
перевести employees assignment на отдельный domain API без начала Stage 7 security migration.

Цель:
- убрать assignment write-path из snapshot merge через `/api/data`
- сохранить только department assignment semantics, не втягивая весь users/security CRUD
- сделать поведение `/employees` и связанных directory-screen route-safe и conflict-aware

Что нужно сделать:
1. Найти server-side и client-side flow employees assignment:
   - `/employees`
   - связанные refresh path на `/departments`, если они зависят от live update
2. Перевести изменение `users[].departmentId` на explicit domain API.
3. Сохранить обязательные правила:
   - permission checks
   - current assignment behavior
   - совместимость с существующими users payload/read-model
4. Добавить понятный rejected-command / conflict path вместо silent return,
   если пользователь отсутствует, устарел state или операция недоступна.
5. Не затрагивать в этом batch:
   - users CRUD
   - access levels
   - password rules
   - landing tab / inactivity timeout

Что нельзя делать:
- не начинать security migration "заодно"
- не менять business semantics users/access levels
- не переводить сюда unrelated security endpoints
- не трогать shift times и production planning

После изменений обязательно проверить:
- employees assignment больше не идет через snapshot merge в `/api/data`
- `/employees` корректно переживает save, `F5` и two-tab conflict
- связанный refresh `/departments` не ломается, если он зависит от assignment changes

Формат ответа:
1. Какие employees assignment paths перевел.
2. Где сохранил границу между Stage 6 и Stage 7.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Назначение сотрудников переведено на отдельный API справочников"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/employees`.
2. Измени подразделение у одного тестового сотрудника.
3. Сохрани и проверь:
   - назначение сохранилось
   - маршрут не потерялся
   - после `F5` состояние осталось
4. Если можешь, открой `/employees` в двух вкладках и попробуй конкурентное изменение одного сотрудника.
5. Проверь:
   - есть понятная реакция на конфликт или устаревшее состояние
   - экран не завис и не ушел на другой маршрут
6. После изменения быстро открой `/departments`, если этот экран использует живое обновление сотрудников.
7. Если изменение назначения молча не сработало или внезапно затронуло users/access levels, batch не закрыт.
