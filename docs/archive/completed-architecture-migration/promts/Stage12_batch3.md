# Stage 12 Batch 3

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
нормализовать cards live на модель "event -> targeted refresh/reconcile", а не "live payload -> рабочий state".

Известные live paths из аудита:
- `/api/events/stream` server SSE bus
- `/api/cards-live` как refresh/fallback endpoint
- `startCardsSse()` в `js/app.00.state.js`
- `cards:changed`
- `card.created`
- `card.updated`
- `card.deleted`
- `card.files-updated`
- прямые `upsert/remove` и patch view в `js/app.00.state.js` around structured card events
- route-safe targeted refresh foundation в `js/app.10.utils.js`

Практические уроки после исправлений `/workspace/:qr` в Batch 2:
- live scheduler нельзя делать однослотовым, если домен может получить несколько `card.*`
  событий подряд: ids/reasons должны накапливаться или безопасно схлопываться без потери
  релевантного refresh.
- событие, пришедшее во время debounce/in-flight/pending refresh или во время
  `__...LiveIgnoreUntil`, нельзя просто игнорировать; оно должно перевести refresh в
  pending/retry state и гарантированно выполниться после окна ожидания.
- server refresh, вызванный live/fallback, должен быть forced/no-cache (`force`,
  `cache: no-store` или существующий эквивалент), иначе тест может пройти на stale
  client/server cache.
- route-safe refresh обязан обновлять не только основную страницу, но и открытые
  видимые контексты карточки: модалки, attachments/files, comments/logs и другие
  subviews, если они уже открыты.
- synthetic live event полезен только для проверки "payload is not source of truth";
  приемочный proof должен включать real two-tab/multi-client сценарий с ожиданием
  SSE/live connection и реальным write endpoint.

Цель:
- cards live должен быть каналом уведомления
- server truth должен приходить через targeted refresh/reconcile
- fallback должен работать через `/api/cards-live` или существующие route-safe refresh helpers
- production/workspace изменения из Batch 2 не должны быть сломаны

Что нужно сделать:
1. Найти весь cards live flow:
   - mixed `cards:changed` refresh behavior
   - structured `card.*` direct mutation behavior
   - card list/detail route refresh behavior
2. Перевести cards live на refresh-модель:
   - `cards:changed` остается сигналом refresh/fallback
   - structured `card.*` events не считаются рабочим state
   - incoming payload можно использовать только как hint для id/domain/revision, если это безопасно
   - actual state должен приходить из server refresh
   - debounce/in-flight/pending handling не должен терять второе и последующие
     события, пришедшие до завершения первого refresh
   - delayed/ignore-window handling должен планировать retry, а не делать silent no-op
3. Сохранить UX:
   - card list обновляется route-safe
   - card detail/deeplink обновляется route-safe
   - delete/update не оставляют silent stale state
   - открытые card subviews/modals после refresh синхронизируются с server truth
4. Сохранить fallback:
   - при parse error, missing id/revision или failed event handling должен запускаться refresh/fallback
   - `/api/cards-live` остается refresh/fallback endpoint where appropriate
   - live/fallback refresh не должен возвращать cached stale state
5. Сохранить `[LIVE]` diagnostics:
   - event received
   - targeted cards refresh scheduled
   - fallback scheduled
   - pending/retry after debounce/in-flight/ignore-window
   - parse/handler warning with `[LIVE]`, без silent failure
6. Не трогать directories/security/messaging cleanup в этом batch.

Что нельзя делать:
- не делать cards live обязательным для correctness
- не подменять server truth локальным live payload
- не ломать route stability
- не ломать production/workspace normalization из Batch 2
- не начинать Stage 13 cleanup и не удалять legacy snapshot overlap

После изменений обязательно проверить:
- `cards:changed` запускает refresh/fallback
- `card.*` events не делают live payload источником истины
- два и более `card.*`/`cards:changed` события подряд не теряются из-за debounce,
  in-flight refresh или ignore window
- live-triggered server reads действительно forced/no-cache, а не stale cache hit
- cards list/detail/deeplink не теряют маршрут
- открытые card modals/subviews обновляются после server refresh или получают понятный fallback
- no-live/fallback path сохраняет correctness
- есть real two-tab/multi-client proof хотя бы для одного list/detail/deeplink
  сценария, а synthetic event используется только как дополнительная проверка payload

Формат ответа:
1. Какие cards live paths перевел.
2. Как теперь работают `cards:changed` и structured `card.*`.
3. Как устроены targeted refresh и fallback.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Нормализован live-режим карточек через targeted refresh"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой `/cards` в двух вкладках.
2. В первой вкладке открой список или конкретную карточку.
3. Во второй вкладке внеси одно безопасное изменение карточки, если у тебя есть права.
4. Вернись в первую вкладку.
5. Проверь:
   - список или карточка обновились или понятно догрузились
   - маршрут не потерялся
   - экран не сломался
6. Обнови страницу через `F5` и проверь, что состояние совпадает.
7. Если карточки становятся актуальными только из incoming live payload без server refresh, batch не закрыт.
