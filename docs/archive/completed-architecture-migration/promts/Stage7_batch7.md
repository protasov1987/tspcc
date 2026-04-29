# Stage 7 Batch 7

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
- Это Stage 7: Complete Security Domain.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 8 и дальше:
  - не делать production migration
  - не делать messaging migration
  - не делать realtime migration
- Нельзя заново переписывать Stage 1-6 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для security-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно закрыть Stage 7 end-to-end после предыдущих batch.

Опирайся на факты аудита и на уже выполненные batch, а не на абстрактный “идеальный” список.

Что Stage 7 должно покрывать к моменту закрытия:
- users
- access levels
- permission semantics
- `landingTab`
- `inactivityTimeoutMinutes`
- profile access rules

Что Stage 7 не должно случайно захватить:
- Stage 6 employee assignment как directory boundary
- Stage 8 production migration
- messaging migration
- realtime migration

Дополнительный практический критерий завершения Stage 7:
Stage 7 нельзя считать закрытым, если:
- users/access levels проверены только на happy path;
- conflict proof получен только через mock/interceptor, а не через реальный two-tab/multi-client сценарий;
- в action-capable security flows остались silent no-op / silent close / lone `alert(...)` / hidden `return`;
- route-safe refresh подтвержден только “в целом”, но не по реальным route-контекстам;
- наличие или отсутствие detail/deeplink security flow предполагается, а не зафиксировано явно.

Что нужно сделать:
1. Перепроверить Stage 7 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/directories-and-security.md
   - docs/business-rules/auth-and-navigation.md
   - docs/business-rules/messaging-profile-and-notifications.md
2. Составить финальную карту action-capable security flows:
   - `/users` list + modal + delete confirm
   - `/accessLevels` list + modal
   - `/profile/:id` privacy flow
3. Для каждого action-capable flow отдельно подтвердить:
   - open path
   - confirm / submit path
   - local invalid-state / no-request path
   - server-side conflict / rejected-command path
   - route-safe refresh
   - реальный two-tab / multi-client proof там, где есть submit
4. Если каких-то flow нет:
   - написать это явно
   - не додумывать их
5. Если Stage 7 еще не закрыт:
   - внести только минимальные добивающие изменения
   - не начинать Stage 8

Stage 7 считается закрытым только если одновременно верно:
- все security writes идут через отдельный security domain API;
- `Abyss` protection сохранен;
- password validation / uniqueness preserved;
- `landingTab` и `inactivityTimeoutMinutes` встроены в общую model of truth;
- `/profile/:id` продолжает соблюдать ownership / privacy rules;
- security UI не использует bypass write-path вне server-truth domain;
- для action-capable security flows доказаны и local invalid-state, и server conflict paths;
- Stage 8 production migration еще не начат.

Формат ответа:
1. Закрыт ли Stage 7 полностью или нет.
2. Какие минимальные добивающие изменения еще пришлось внести.
3. Какие тесты/сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен перевод домена безопасности на отдельные API"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 7.

### Финальный чек-лист для чайника

1. Открой:
   - `/users`
   - `/accessLevels`
   - свой `/profile/:id`
2. Для пользователей и уровней доступа сделай по одному безопасному тестовому изменению.
3. После каждого изменения проверь:
   - данные сохранились
   - маршрут не потерялся
   - после `F5` все осталось
4. Проверь конфликтный сценарий хотя бы для users и access levels:
   - открой одну и ту же сущность в двух вкладках
   - сохрани в первой
   - попробуй сохранить старую форму во второй
5. Проверь:
   - есть понятное сообщение
   - маршрут не ломается
   - данные обновляются
6. Проверь защитные правила:
   - `Abyss` не сломан
   - пароль по-прежнему валидируется
   - свой профиль открывается
   - чужой профиль не открывается, если правила это запрещают
7. Проверь `landingTab`:
   - смени домашнюю вкладку через уровень доступа
   - выйди и войди снова
   - должна открыться новая вкладка
8. Проверь `inactivity timeout`:
   - измени значение
   - обнови страницу
   - значение не должно потеряться
9. Убедись, что production и messaging не были “переделаны заодно”.
