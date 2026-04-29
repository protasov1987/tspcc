# Stage 11 Batch 3

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
- Это Stage 11: Migrate Messaging, Profile and Notifications.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 12 и дальше:
  - не делать realtime normalization
  - не делать final legacy cleanup за пределами messaging/profile
  - не делать perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-10 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для messaging/profile consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 11:
убрать равноправие server-side `/api/messages/*` с primary `/api/chat/*`.

Контекст аудита Stage 11 Batch 1:
- Web UI и Android chat client используют `/api/chat/*`.
- В клиентском web-коде `/api/messages/*` не найден.
- На сервере все еще существуют полноценные legacy endpoints:
  - `GET /api/messages/stream`
  - `GET /api/messages/dialog/:peerId`
  - `POST /api/messages/send`
  - `POST /api/messages/mark-read`
- Legacy слой пишет/читает отдельный массив `messages`, тогда как primary stack
  использует `chatConversations`, `chatMessages`, `chatStates`.
- Stage 11 не завершен, пока `/api/messages/*` выглядит как второй
  самостоятельный message stack.

Цель:
- сделать `/api/chat/*` единственным primary message stack на сервере
- `/api/messages/*` либо удалить, либо понизить до explicit temporary adapter
  поверх `/api/chat/*`
- не ломать direct chat, profile privacy, deeplink из Batch 2, delivered/read
- не делать Stage 13 global cleanup за пределами messaging

Что нужно сделать:
1. Проверить все server-side references:
   - `server.js`
   - `db.js`
   - `tests/e2e/**`
   - `android-chat/**`
   - fixtures, если они завязаны на legacy `messages`
2. Принять минимальное решение:
   - если `/api/messages/*` уже никем не используется, удалить endpoints и
     оставить compatibility note только в docs/ответе
   - если нужен compatibility, сделать `/api/messages/*` adapter без
     самостоятельной бизнес-роли и без записи в отдельный `messages` как
     primary model
3. Если adapter остается, явно зафиксировать removal path:
   - какие endpoints оставлены
   - какой data model они используют
   - почему они не равноправный stack
   - когда их можно удалить
4. Не мигрировать весь historical `messages` массив, если это требует отдельного
   data migration риска. Если нужна миграция данных, зафиксировать blocker и
   сделать минимальный безопасный compatibility path.
5. Сохранить server-side запреты:
   - auth/CSRF
   - no system-user send
   - conversation participant access
6. Добавить или обновить focused tests, которые доказывают:
   - `/api/chat/*` работает
   - `/api/messages/*` не пишет в отдельный primary `messages` stack
   - legacy endpoint, если оставлен, не создает divergence

Для in-scope API flow зафиксировать в ответе:
- read path
- write path
- local/no-request path на клиенте, если есть
- server-side rejected-command path
- участвует ли route profile/deeplink или это API-only compatibility
- можно ли доказать route-safe behavior без Stage 12 realtime normalization

Что нельзя делать:
- не оставлять `messages` как второй writable source of truth
- не переписывать `/api/chat/*` большой рефакторингом
- не ломать Android chat client
- не трогать receipts
- не удалять unrelated `/api/data` legacy snapshot writes
- не начинать Stage 12 realtime normalization

После изменений обязательно проверить:
- `/api/chat/*` остается primary stack
- `/api/messages/*` удален или стал adapter без самостоятельной модели
- direct chat и Batch 2 deeplink не сломаны
- delivered/read не потеряны

Формат ответа:
1. Какие legacy `/api/messages/*` paths удалил или понизил до adapter.
2. Как теперь разграничены `/api/chat/*` и `/api/messages/*`.
3. Какие автоматические проверки выполнил.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Убран второй равноправный message stack"

После bump проверь:
- новая запись появилась в docs/version-log.html
- создана локальная backup-ветка с версией/датой/временем из version log
- в backup-ветке есть локальный commit
- push в GitHub не выполнялся
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой свой профиль.
2. Открой direct chat.
3. Отправь тестовое сообщение, если это безопасно.
4. Обнови страницу через `F5`.
5. Проверь:
   - диалог остался тем же
   - сообщение не потерялось
   - нет второго странного списка сообщений
   - системному пользователю нельзя написать.
