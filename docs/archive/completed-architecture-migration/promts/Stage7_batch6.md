# Stage 7 Batch 6

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
добить cleanup security-domain boundary и подтвердить profile ownership/privacy без ломки messaging.

Факты из аудита:
- `/profile/:id` уже приватен на route/UI-уровне и это покрыто текущими e2e;
- users/access levels уже пишут через `/api/security/*`;
- но security-domain все еще живет в гибридной read-model:
  - глобальные массивы `users/accessLevels`
  - SSE patching
  - legacy overlap `/api/data`
- при этом overlap с `/api/data` сейчас нужен в основном для Stage 6 employee assignment boundary,
  а не для полноценного security CRUD;
- chat/profile behavior трогать нельзя.

Цель:
- убрать остаточные security UI bypass-path там, где они еще реально есть;
- явно отделить security-domain от Stage 6 employee assignment boundary;
- сохранить `/profile/:id` ownership/privacy и не сломать chat/webpush/user-actions flows.

Что нужно сделать:
1. Найти остаточные bypass-path и hybrid overlaps для security UI:
   - `saveData()`
   - `/api/data`
   - silent local mutations без server-truth command
2. Убрать или изолировать их там, где они относятся именно к Stage 7 security-domain.
3. Явно не трогать Stage 6 employees department assignment, если это отдельная directory boundary.
4. Проверить `/profile/:id`:
   - own profile path
   - foreign profile deny
   - сохранность chat deeplink `openChatWith` / `conversationId`
5. Довести сообщения и refresh behavior так, чтобы не оставалось:
   - silent no-op
   - silent close
   - lone `alert(...)` без понятного route-safe refresh

Что нельзя делать:
- не ослаблять приватность `/profile/:id`
- не ломать current messaging/profile chat behavior
- не открывать новый публичный profile API
- не смешивать этот batch с production migration
- не удалять Stage 6 employee assignment, маскируя это под Stage 7 cleanup

Обязательно отдельно зафиксировать и проверить:
- какие security action paths еще были bypass / legacy
- какие из них относятся к Stage 7, а какие относятся к Stage 6 boundary
- есть ли action-capable security flow вне `/users` и `/accessLevels`
- если такого flow нет, это нужно явно написать, а не предполагать

Формат ответа:
1. Какие bypass / cleanup paths убрал или изолировал.
2. Как сохранены rules для `/profile/:id`.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие риски еще остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Изолированы остаточные legacy-пути домена безопасности"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой свой `/profile/ТВОЙ_ID`.
2. Проверь, что профиль открывается как раньше.
3. Если знаешь ID другого пользователя, попробуй открыть `/profile/ЧУЖОЙ_ID`.
4. Проверь, что чужой профиль не раскрывается, если этого не допускают правила.
5. Открой `/users` и `/accessLevels`.
6. Выполни по одному безопасному изменению.
7. Проверь:
   - маршрут не теряется
   - после `F5` данные на месте
   - security UI не ведет себя так, будто изменение “проглотилось” без понятного результата
8. Если после batch чат в профиле перестал открываться или чужой профиль стал доступен, batch не закрыт.
