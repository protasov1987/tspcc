# Stage 1 Batch 7

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
- Это Stage 1: Stabilize Routing, Bootstrap and Auth For Entire In-Scope Perimeter.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче переводить домены на новые write API.
- Нельзя переписывать realtime.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняется bootstrap order — обязательно обнови docs/architecture/spa-boot.md.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно закрыть Stage 1 end-to-end после предыдущих batch.

Цель:
- подтвердить, что Stage 1 реально закрыт по всему in-scope perimeter
- не начать Stage 2 раньше времени
- если остались только единичные Stage 1 gaps, добить их минимально

Что нужно сделать:
1. Проверить Stage 1 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/auth-and-navigation.md
2. Запустить и при необходимости обновить только Stage 1 related checks:
   - login with direct URL
   - `F5` on protected routes
   - direct URL entry
   - back / forward
   - deep routes
   - permission-sensitive routes
3. Если Stage 1 еще не закрыт, внести только минимальные добивающие исправления.
4. Не начинать Stage 2 и не трогать write-model migration.

Сценарии, которые обязательно проверить:
- `/dashboard`
- `/cards`
- `/cards/new`
- `/cards/:id`
- `/card-route/:qr`
- `/approvals`
- `/provision`
- `/input-control`
- `/departments`
- `/operations`
- `/areas`
- `/employees`
- `/shift-times`
- `/users`
- `/accessLevels`
- `/profile/:id`
- `/production/schedule`
- `/production/plan`
- `/production/shifts`
- `/production/shifts/:key`
- `/production/gantt/:...`
- `/workspace`
- `/workspace/:qr`
- `/production/delayed`
- `/production/delayed/:qr`
- `/production/defects`
- `/production/defects/:qr`
- `/workorders`
- `/workorders/:qr`
- `/archive`
- `/archive/:qr`
- `/items`
- `/ok`
- `/oc`

Критерий завершения Stage 1:
- один central router
- один linear bootstrap
- protected routes only after session restore
- URL полностью определяет экран
- popstate идет через central router
- нет forced redirect на dashboard при boot
- navigation setup идемпотентен
- `[BOOT]` и `[ROUTE]` диагностика достаточна
- business-rules не нарушены
- receipts не затронут как домен

Формат ответа:
1. Выполнен ли Stage 1 полностью или нет.
2. Что именно еще пришлось добить.
3. Какие тесты и сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершена стабилизация роутинга, bootstrap и auth для in-scope маршрутов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это финальная приемка Stage 1.

### Финальный чек-лист для чайника

1. Открой сайт.
2. Проверь прямой вход по URL:
   - `/cards`
   - `/production/plan`
   - `/workspace`
   - `/archive`
3. Проверь `F5` на:
   - `/dashboard`
   - `/cards`
   - `/cards/ID`
   - `/profile/ID`
   - `/production/plan`
   - `/workspace`
4. Проверь deep routes:
   - `/workorders/QR`
   - `/archive/QR`
   - `/production/delayed/QR`
   - `/production/defects/QR`
5. Пройди по нескольким страницам и нажимай `Назад` / `Вперёд`.
6. Не должно быть прыжков на `/dashboard`, пустых экранов и необходимости жать `F5`.
7. При загрузке не должен мигать защищенный контент до восстановления сессии.
8. Свой `/profile/:id` должен открываться, чужой не должен открываться как обычный доступный экран.
9. Если умеешь, открой консоль и убедись, что есть `[BOOT]` и `[ROUTE]` логи без мусорного бесконечного спама.
10. Убедись, что `receipts` специально не трогали и Stage 1 не опирается на него.

