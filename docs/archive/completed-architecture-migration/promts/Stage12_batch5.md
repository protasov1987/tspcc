# Stage 12 Batch 5

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
- Это Stage 12: Normalize Realtime For Entire In-Scope Perimeter.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Если нужный Stage 12 helper физически расположен в файле с receipts-кодом,
  трогать можно только этот non-receipts helper; бизнес-логику receipts не менять.
- Нельзя в этой задаче выполнять Stage 11, Stage 13 или Stage 14:
  - не мигрировать `/api/messages/*`
  - не убирать legacy messaging overlap
  - не менять chat business semantics
- Нельзя заново переписывать Stage 1-11 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для realtime consistency.
- Нельзя делать big refactor "заодно".
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 12:
нормализовать messaging live и fallback refresh без Stage 11/13 cleanup.

Известные live paths из аудита:
- отдельный SSE `/api/chat/stream` в `server.js`
- `startMessagesSse()` в `js/app.95.messenger.js`
- events:
  - `message_new`
  - `unread_count`
  - `delivered_update`
  - `read_update`
  - `user_status`
- unread fallback через `/api/chat/users`
- проблема аудита:
  - live directly applies message/read/delivered updates to client cache
  - для active conversation нет унифицированного full message fallback
  - `[LIVE]` diagnostics для chat отсутствуют
  - parse warnings без общего префикса

Практические уроки после исправлений `/workspace/:qr` в Batch 2:
- chat live scheduler не должен терять несколько событий подряд: несколько
  `message_new`, read/delivered updates и unread changes до завершения refresh
  должны приводить к актуальному final server refresh.
- событие, пришедшее во время debounce/in-flight/pending refresh или временного
  suppression window после локального write, должно планировать retry/pending
  refresh, а не silent no-op.
- active conversation fallback должен читать server truth forced/no-cache или через
  endpoint/helper, который гарантированно не возвращает stale cache.
- route-safe refresh обязан обновлять открытый чат, список диалогов, unread badges и
  visible conversation subviews together; нельзя обновить только cache и оставить UI
  молча устаревшим.
- synthetic event proof недостаточен: нужен real two-tab/two-user сценарий с
  ожиданием live connection и реальным send/read endpoint.

Цель:
- messaging live должен сигналить targeted refresh/reconcile
- server truth должен определять messages/read/delivered/unread state
- active conversation должен иметь fallback refresh
- delivered/read semantics и direct chat UX не должны измениться

Что нужно сделать:
1. Найти весь `/api/chat/stream` client flow.
2. Разделить live event hint и server refresh:
   - `message_new` должен инициировать refresh active conversation или affected conversation summary
   - `unread_count` должен reconcile через server/fallback path where appropriate
   - `delivered_update` / `read_update` не должны быть единственным источником truth
   - `user_status` можно оставить UX-hint, если он не влияет на persisted correctness
3. Добавить или унифицировать fallback refresh:
   - active conversation messages
   - conversation list/unread counters
   - direct chat/deeplink state
   - forced/no-cache server read для live/fallback refresh
   - pending/retry behavior для событий, пришедших во время уже идущего refresh
4. Сохранить:
   - delivered/read semantics
   - direct chat behavior
   - profile privacy
   - current Stage 11 boundaries, without migrating legacy endpoints
5. Нормализовать diagnostics:
   - `[LIVE]` connect/disconnect/error/parse warnings for chat
   - `[LIVE]` targeted refresh scheduled, pending/retry scheduled, fallback scheduled
   - no spam
   - failed live handling schedules fallback where possible

Что нельзя делать:
- не делать live источником истины для сообщений
- не ломать delivered/read semantics
- не ломать deeplinks и direct chat
- не создавать второй live-specific chat model
- не мигрировать `/api/messages/*`
- не удалять legacy messaging overlap
- не начинать Stage 13 cleanup

После изменений обязательно проверить:
- active conversation получает server refresh/fallback после live hint
- unread counters не зависят только от live payload
- read/delivered сохраняют серверную корректность
- несколько live events подряд не теряются и приводят к актуальному final state
- live/fallback server reads не возвращают stale cache
- открытый чат и список диалогов синхронизируются вместе или имеют понятный fallback
- chat correctness не зависит от live availability
- есть real two-tab/two-user proof, а не только synthetic event dispatch

Формат ответа:
1. Какие messaging live paths перевел.
2. Как теперь работают `message_new`, `unread_count`, `delivered_update`, `read_update`, `user_status`.
3. Как устроены active conversation refresh, unread fallback и diagnostics.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Нормализован live-режим чатов через server refresh"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой один и тот же чат в двух вкладках или у двух пользователей.
2. В одной вкладке отправь тестовое сообщение, если это безопасно.
3. Во второй вкладке проверь:
   - сообщение появилось или корректно догрузилось
   - счетчик непрочитанных корректный
   - чат не сломался
4. Обнови вторую вкладку через `F5`.
5. Проверь, что итоговое состояние совпадает.
6. Если чат корректен только при наличии live и ломается без него, batch не закрыт.
