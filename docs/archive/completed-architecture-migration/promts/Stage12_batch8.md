# Stage 12 Batch 8

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
добить no-live/fallback proof после realtime cutover.

Цель:
- доказать, что live нигде не нужен для correctness
- закрыть fallback refresh gaps на real routes
- получить real two-tab/multi-client proof, а не только synthetic event proof
- сохранить полезную `[LIVE]` диагностику без spam
- доказать, что исправления класса `/workspace/:qr` после Batch 2 не повторяются:
  no lost events in debounce/in-flight/pending/ignore-window, no stale cache reads,
  no silently stale open subcontexts

Что нужно сделать:
1. Провести audit после Batch 7:
   - production/workspace live/fallback
   - cards live/fallback
   - directories/security live/fallback
   - messaging live/fallback
   - bootstrap/live dependency
2. Для каждого домена подтвердить:
   - live only signals refresh
   - server remains source of truth
   - fallback refresh работает при unavailable/late/malformed live
   - parse/handler failure не оставляет silent stale state
   - repeated/overlapping events не теряются при debounce/in-flight/pending refresh
   - events delayed by ignore/suppression window schedule retry
   - live/fallback reads forced/no-cache или имеют доказанный эквивалент
   - open modals/subviews/counters/badges/summaries обновляются route-safe
3. Добавить или расширить E2E/интеграционные проверки where feasible:
   - real two-tab/multi-client propagation
   - correctness with live unavailable
   - route-safe fallback на list/detail/deeplink routes, где они есть
   - no silent stale-state after live miss
   - repeated events before first refresh finishes
   - delayed retry after ignore/suppression window
   - visible open subcontext refresh after another client writes
4. Для production отдельно проверить Stage 8/9 contracts:
   - planning refresh идет через `/api/production/planning/slice`
   - planning live не подменяет `meta.domainRevisions.productionPlanning`
   - execution refresh не обходит `expectedFlowVersion`
5. Для cards отдельно проверить:
   - structured `card.*` payload does not become working state
   - list/detail/deeplink refresh stays route-safe
   - multiple `card.*` events keep all relevant affected ids or escalate safely
   - `/api/cards-live`/cards-core reads are not stale cache reads
6. Для directories/security отдельно проверить:
   - `applyDirectoryEvent()` не является source-of-truth mutator
   - failed/unknown events schedule fallback and `[LIVE]` warning
   - repeated domain events do not overwrite pending affected domain/entity state
7. Для messaging отдельно проверить:
   - active conversation full refresh/fallback
   - unread/conversation list fallback
   - delivered/read state remains server-correct
   - multiple message/read/delivered events converge to server final state
8. Не начинать Stage 13.

Что нельзя делать:
- не делать live источником истины
- не чинить correctness через full reload как основной путь
- не повышать таймауты без явного временного комментария
- не удалять полезные diagnostics
- не мигрировать legacy domains beyond Stage 12 scope

Формат ответа:
1. Какой no-live/fallback proof получен.
2. Какие fallback gaps были закрыты.
3. Таблица proof: domain -> routes -> live unavailable scenario -> fallback path -> result.
4. Таблица hardening proof: domain -> repeated/overlapping events -> ignore-window retry -> no-cache read -> open subcontext sync.
5. Какие тесты/сценарии проверил автоматически.
6. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
7. Остаточные риски и почему они не блокируют Stage 12.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Подтверждена fallback-корректность realtime без зависимости от live"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой сайт в двух вкладках.
2. В одной вкладке измени данные в карточке, production/workspace, справочнике/security или чате, если это безопасно.
3. Во второй вкладке проверь, что данные обновились или корректно догрузились.
4. Обнови страницу через `F5` и проверь, что итоговое состояние совпадает.
5. Убедись, что сайт не ждет live для boot.
6. Если умеешь, временно проверь сценарий с недоступным live/SSE и убедись, что correctness сохраняется через refresh/fallback.
