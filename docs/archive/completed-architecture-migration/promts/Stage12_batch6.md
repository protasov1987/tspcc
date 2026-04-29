# Stage 12 Batch 6

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
свести realtime foundation, fallback refresh и `[LIVE]` diagnostics после доменных normalization batch 2-5.

Контекст аудита:
- bootstrap уже не должен зависеть от live:
  - chat SSE стартует после final route/background hydration log `[BOOT] live:start`
  - cards/production/workspace live стартует route-local
- popstate уже должен вызывать `handleRoute(fullPath, { fromHistory: true, replace: true })`
- existing offline diagnostics частично есть:
  - `[LIVE] server connection issue/restored/offline`
- fallback paths уже есть, но должны быть единообразно проверены:
  - cards polling/tick
  - route-safe targeted refresh helpers
  - chat unread fallback `/api/chat/users`

Практические уроки после исправлений `/workspace/:qr` в Batch 2:
- общий realtime foundation должен явно описывать scheduler contract:
  debounce/in-flight/pending/ignore-window не имеют права терять событие; они могут
  только схлопнуть несколько событий в один последующий forced refresh.
- event hints должны хранить все необходимые affected ids/domains до refresh или
  безопасно поднимать refresh до broader domain scope; одно поле `targetId` опасно
  для multi-event сценариев.
- live/fallback reads должны обходить stale cache (`force`, `cache: no-store`,
  `Cache-Control: no-cache` или локальный эквивалент).
- route-safe re-render должен включать visible subcontexts: открытые модалки,
  detail panels, comments/files, counters, badges, summaries.
- proof после normalization должен включать real two-tab/multi-client сценарии с
  ожиданием live connection; synthetic events проверяют только unit-level contract.

Цель:
- общий live foundation должен быть понятным и повторно используемым
- fallback refresh должен быть обязательным backup path, а не случайной веткой
- bootstrap/auth/router не должны зависеть от live
- diagnostics должны помогать понять live/fallback state без spam

Что нужно сделать:
1. Провести post-batch audit по фактическому коду после Batch 2-5:
   - production/workspace
   - cards
   - directories/security
   - messaging
   - bootstrap/live start order
2. Свести общий realtime подход там, где это можно сделать маленьким шагом:
   - event envelope / event hint shape
   - dispatch by domain
   - targeted refresh scheduling
   - fallback refresh scheduling
   - parse/handler error behavior
   - единый scheduler contract для debounce/in-flight/pending/ignore-window
   - накопление affected ids/domains или безопасный escalation to broader refresh
   - forced/no-cache policy для live/fallback reads
   - route-safe subcontext sync contract для открытых UI-контекстов
3. Убедиться, что bootstrap rules не нарушены:
   - no render before restoreSession/checkAuth
   - no `handleRoute` before popstate is attached
   - no forced redirect to dashboard on boot
   - live starts only after route/auth-safe point or route-local point
4. Нормализовать `[LIVE]` diagnostics:
   - connect/reconnect/offline/restored
   - event parse warning
   - handler warning
   - targeted refresh scheduled
   - pending/retry scheduled after debounce/in-flight/ignore-window
   - fallback scheduled
   - не логировать одно и то же бесконечно
5. Добить fallback gaps, обнаруженные только на общей проверке:
   - failed live event should schedule fallback where possible
   - late/unavailable live should not block correctness
   - no full reload as normal fallback
6. Если менялся порядок bootstrap, обязательно обновить `docs/architecture/spa-boot.md`.

Что нельзя делать:
- не менять business semantics доменов
- не ломать router/auth/bootstrap
- не превращать diagnostics в постоянный шум
- не удалять полезные live логи полностью
- не делать Stage 13 cleanup

После изменений обязательно проверить:
- live foundation можно использовать повторно
- bootstrap не зависит от live
- fallback refresh behavior понятен во всех in-scope domains
- debounce/in-flight/pending/ignore-window paths не теряют events
- live/fallback reads не берут stale cache
- открытые модалки/subviews/counters после refresh не остаются silently stale
- `[LIVE]` diagnostics есть и не шумят
- хотя бы один real two-tab/multi-client proof есть для каждого крупного live family

Формат ответа:
1. Какие realtime primitives / adapters / handlers добавил или выделил.
2. Что изменил в fallback refresh и `[LIVE]` diagnostics.
3. Как проверил отсутствие bootstrap dependency on live.
4. Какие сценарии проверил автоматически.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Сведены realtime foundation, fallback и live-диагностика"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой сайт.
2. Обнови страницу через `F5` на:
   - `/cards`
   - `/workspace`
   - production planning route, если он доступен
   - чат, если он доступен
3. Проверь, что экраны загружаются без ожидания live-подключения как обязательного шага.
4. Если умеешь, открой `F12 -> Console`.
5. Проверь:
   - есть `[LIVE]` логи по делу
   - нет бесконечного однотипного spam
6. Если сайт ждет live для нормальной загрузки или консоль завалена шумом, batch не закрыт.
