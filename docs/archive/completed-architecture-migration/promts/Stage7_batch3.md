# Stage 7 Batch 3

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
Нужно реализовать только один batch Stage 7:
довести users write-flow до revision-safe security-domain contract.

Факты из аудита:
- users CRUD уже идет через `/api/security/users*`, а не через основной UI-path `/api/data`;
- поэтому цель batch не “перевести users с snapshot на API”, а закрыть реальные gaps:
  - update/delete без полноценного `expectedRev -> 409`
  - last-write-wins при stale modal
  - неполные server-side invariants для `Abyss`
  - отсутствие доказанного route-safe conflict handling в реальном UI
- `/users` не имеет отдельного detail route: action-capable flow существует на list route + modal.

Цель:
- сделать users create/update/delete полноценным security-domain command flow;
- сохранить `Abyss` protection, password validation и password uniqueness;
- добавить реальный conflict contract для action-capable users flows.

Что нужно сделать:
1. Найти текущие server-side и client-side paths users:
   - open path list/modal
   - submit path
   - delete confirm path
   - current local invalid-state / no-request paths
2. Добавить revision-safe update/delete contract для users там, где он реально нужен.
3. Обеспечить понятный client behavior для:
   - stale open modal
   - server-side conflict / rejected command
   - route-safe refresh после конфликта
4. Сохранить обязательные invariants:
   - `Abyss` protection
   - password validation
   - password uniqueness
   - permission checks
5. Не ломать:
   - login / auth
   - профиль
   - Stage 6 employee assignment

Что нельзя делать:
- не делать big rewrite security UI
- не ослаблять `Abyss` protection
- не менять смысл password rules
- не переносить сюда access levels batch
- не смешивать users CRUD с employees department assignment

Обязательно отдельно зафиксировать и проверить:
- open path: `/users` -> modal edit/create
- confirm path: submit modal / confirm delete
- local invalid-state / no-request path
- server conflict / rejected-command path
- route-safe refresh на единственном action-capable route `/users`
- реальный two-tab или multi-client сценарий, а не только искусственный mock `409`

Формат ответа:
1. Какие users flows и write-paths изменил.
2. Как сохранены `Abyss`, password validation и password uniqueness.
3. Какие conflict / invalid-state scenarios проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие риски еще остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Доработан revision-safe flow пользователей в домене безопасности"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/users`.
2. Создай тестового пользователя или открой безопасного тестового пользователя.
3. Измени одно безопасное поле и сохрани.
4. Проверь:
   - изменение сохранилось
   - маршрут остался `/users`
   - после `F5` данные не потерялись
5. Если можно безопасно проверить конфликт:
   - открой того же пользователя в двух вкладках
   - сохрани в первой вкладке
   - попробуй сохранить старую форму во второй
6. Проверь:
   - есть понятное сообщение об устаревших данных
   - список/маршрут не теряются
   - данные обновляются
7. Проверь, что пароль по-прежнему валидируется.
8. Проверь, что `Abyss` не стал редактируемым или удаляемым там, где этого быть не должно.
