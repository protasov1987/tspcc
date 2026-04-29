# Stage 12 Batch 4

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
- Нельзя в этой задаче выполнять Stage 11, Stage 13 или Stage 14.
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
нормализовать directories/security live на модель "event -> targeted refresh", а не direct mutation.

Известные live paths из аудита:
- общий SSE `/api/events/stream`
- `applyDirectoryEvent()` в `js/app.00.state.js`
- events:
  - `directory.operation.*`
  - `directory.area.*`
  - `directory.department.*`
  - `directory.shift-time.*`
  - `directory.employee.updated`
  - `security.user.*`
  - `security.access-level.*`
- текущие direct mutations:
  - `ops`
  - `areas`
  - `centers`
  - `users`
  - `accessLevels`
- direct DOM/UI patching
- проблема аудита: при parse/handler errors fallback refresh не запускается и handlers могут молчать.

Практические уроки после исправлений `/workspace/:qr` в Batch 2:
- live refresh нельзя считать закрытым, пока не проверены debounce/in-flight/pending
  окна: второе событие того же или другого entity не должно быть потеряно.
- если есть временное окно подавления/ignore после локального write, входящее live
  событие должно планировать retry after ignore window, а не silent no-op.
- targeted refresh/fallback должен читать server truth forced/no-cache; stale cache
  недопустим как результат realtime refresh.
- route-safe refresh должен обновлять открытые видимые UI-контексты справочника или
  security, включая модалки редактирования, таблицы, текущего пользователя и
  dependent dropdowns, если они зависят от обновленного домена.
- synthetic event proof недостаточен: нужен real two-tab/multi-client сценарий для
  хотя бы одного справочника и одного security path, если это технически возможно.

Цель:
- directories/security live только сигналит refresh/reconcile
- server truth остается источником для справочников, пользователей и уровней доступа
- parse/handler failure не оставляет silent stale state
- Stage 7 security domain model не ломается

Что нужно сделать:
1. Найти весь flow `applyDirectoryEvent()` и связанные calls/render refresh.
2. Убрать reliance on direct mutation from live payload:
   - live payload можно использовать как hint для domain/entity/id/revision
   - рабочий state должен приходить через targeted refresh или существующий domain reload
3. Добавить targeted refresh/fallback по доменам:
   - operations
   - areas/departments/centers
   - shift times
   - employees/users
   - access levels
   - refresh должен быть forced/no-cache или использовать существующий эквивалент,
     который гарантированно обходит stale cache
   - несколько событий подряд должны накапливаться/схлопываться по domain/entity без
     потери последнего server refresh
4. Обеспечить route-safe UI refresh:
   - текущий route не должен сбрасываться
   - открытая admin/security/directory view должна догружаться, а не получать silent stale state
   - открытые модалки/формы и dependent selects должны либо синхронизироваться, либо
     получать понятное stale/fallback поведение без silent no-op
5. Нормализовать diagnostics:
   - все parse/handler warnings должны иметь `[LIVE]`
   - при сомнительном event должен запускаться fallback refresh
   - pending/retry after debounce/in-flight/ignore-window должен быть виден в `[LIVE]`
   - не создавать console spam
6. Не трогать cards/production/workspace/messaging beyond shared helper use.

Что нельзя делать:
- не делать live payload источником истины для directories/security
- не ломать Stage 7 security/access-level model
- не менять business meaning прав, пользователей и справочников
- не добавлять новые страницы/меню в обход router/navigation layer
- не начинать Stage 13 cleanup

После изменений обязательно проверить:
- directory/security events запускают targeted refresh/fallback
- parse/handler ошибки не молчат
- повторные события во время debounce/in-flight/pending refresh не теряются
- live/fallback refresh не возвращает stale cached state
- admin/security/directory routes не теряют маршрут
- открытые формы/модалки/таблицы после refresh не остаются молча устаревшими
- no-live/fallback path сохраняет correctness
- есть real two-tab/multi-client proof, а не только synthetic dispatch

Формат ответа:
1. Какие directories/security live paths перевел.
2. Как теперь работает targeted refresh по каждому affected domain.
3. Как обработаны parse/handler errors и fallback.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Нормализован live-режим справочников и security через refresh"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт в двух вкладках.
2. В первой вкладке открой справочник или security/admin экран.
3. Во второй вкладке внеси одно безопасное изменение справочника, пользователя или уровня доступа, если у тебя есть права.
4. Вернись в первую вкладку.
5. Проверь:
   - данные обновились или понятно догрузились
   - маршрут не потерялся
   - экран не сломался
6. Если при ошибочном/неполном live event экран молча остается устаревшим без fallback refresh, batch не закрыт.
