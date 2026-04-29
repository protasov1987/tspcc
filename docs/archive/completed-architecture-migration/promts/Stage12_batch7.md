# Stage 12 Batch 7

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
Нужно закрыть основной Stage 12 cutover после implementation batch 2-6.
Это НЕ финальная приемка Stage 12: после этого batch должны остаться Batch 8
для no-live/fallback proof hardening и Batch 9 для финальной проверки без исправлений.

Цель:
- подтвердить, что основной realtime normalization cutover выполнен
- добрать только минимальные исправления live/fallback behavior
- не начать Stage 13 раньше времени

Что нужно сделать:
1. Проверить весь Stage 12 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/cards-and-approval.md
   - docs/business-rules/directories-and-security.md
   - docs/business-rules/production-and-workspace.md
   - docs/business-rules/messaging-profile-and-notifications.md
2. Подтвердить, что все проблемы аудита Stage 12 закрыты или явно перенесены в Batch 8 as proof-only/hardening:
   - production/workspace live uses server refresh, not incoming `card.*` payload
   - planning live refresh uses `/api/production/planning/slice`
   - execution live does not bypass `expectedFlowVersion -> 409`
   - cards structured events do not directly become working state
   - directories/security `applyDirectoryEvent()` no longer relies on silent direct mutation
   - directory/security parse/handler failures schedule fallback and log `[LIVE]`
   - messaging active conversation has full refresh/fallback
   - chat `[LIVE]` diagnostics exist and parse warnings are normalized
   - bootstrap still does not depend on live
   - debounce/in-flight/pending/ignore-window paths не теряют live events
   - affected ids/domains не перезаписываются однослотовым target state при нескольких
     событиях подряд; используется накопление или safe broader refresh
   - live/fallback server reads forced/no-cache и не подтверждаются stale cache hit
   - route-safe refresh обновляет visible subcontexts: модалки, comments/files,
     counters/badges/summaries, detail panels
3. Проверить Stage 12 coverage:
   - cards live
   - directories/security live
   - production/workspace live
   - messaging live
   - fallback refresh
   - `[LIVE]` diagnostics
4. Если Stage 12 еще не закрыт, внести только минимальные добивающие изменения.
5. Подтвердить, что Stage 13 functionality не смешана в Stage 12:
   - no final legacy cleanup
   - no `/api/data` removal
   - no `saveData()` removal
   - no messaging legacy migration

Дополнительно, с учетом практического опыта Stage 4, Stage 12 нельзя считать закрытым, если:
- multi-client/live-update proof существует только через synthetic live event, mock или interceptor, а не через реальный two-tab/multi-client сценарий
- route-safe fallback refresh подтвержден только на одном route family, хотя домен использует list/detail/deeplink routes
- local no-request/no-refresh invalid-state paths после live-update не найдены и не разобраны явно
- после live-update остаются silent no-op/silent stale-state paths без понятного refresh/fallback поведения
- события, пришедшие во время debounce/in-flight/pending refresh или ignore window,
  могут быть потеряны
- live/fallback refresh может читать stale cache
- открытые модалки или вложенные контексты обновляются только после F5, хотя основной
  экран уже получил live refresh

Критерий завершения Stage 12 cutover:
- realtime нигде не обязателен для correctness
- live only signals refresh
- production planning live делает refresh через Stage 8 planning slice contract
  и не подменяет `meta.domainRevisions.productionPlanning`
- production execution live не обходит Stage 9 `expectedFlowVersion` conflict model
- cards live не использует structured payload как рабочий state
- directories/security live не мутирует справочники/security state как source of truth
- messaging live имеет fallback для active conversation и unread/conversation state
- bootstrap never depends on live
- standardized event/fallback behavior exists across in-scope domains
- `[LIVE]` diagnostics полезны и не шумят
- scheduler contract доказан для repeated/overlapping events
- server refresh доказан как forced/no-cache
- open UI subcontexts синхронизируются route-safe
- Stage 13 final cleanup еще не начат

Формат ответа:
1. Выполнен ли Stage 12 cutover полностью или нет.
2. Что именно еще пришлось добить.
3. Финальная таблица: domain -> live events -> refresh/fallback path -> source of truth.
4. Отдельная таблица: domain -> scheduler protection
   (debounce/in-flight/pending/ignore-window) -> cache policy -> open subcontext sync.
5. Какие тесты/сценарии проверил автоматически.
6. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
7. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен основной cutover realtime на refresh-модель"

После bump проверь, что запись появилась в docs/version-log.html.
```

Важно: после этого batch Stage 12 еще не считается полностью закрытым, если
не доказаны no-live/fallback сценарии по real two-tab/multi-client proof и
финальная acceptance-проверка без исправлений.

## Ручная проверка после Prompt

Обязательна. Это ручная приемка Stage 12 cutover перед отдельными Batch 8/9.

### Финальный чек-лист для чайника

1. Открой сайт в двух вкладках.
2. На первой вкладке открой:
   - карточку
   - или `/workspace`
   - или production planning route
   - или чат
3. На второй вкладке внеси одно безопасное изменение, если у тебя есть права.
4. Вернись на первую вкладку и проверь:
   - данные обновляются или корректно догружаются
   - маршрут не теряется
   - экран не ломается
5. Обнови первую вкладку через `F5`.
6. Проверь, что итоговое состояние совпадает и не зависит от того, был ли live.
7. Если умеешь, открой `F12 -> Console`.
8. Проверь:
   - есть `[LIVE]` логи по делу
   - нет бесконечного однотипного spam
9. Убедись, что сайт загружается нормально даже если live недоступен или задерживается.
10. Убедись, что final cleanup или массовое удаление legacy не делались "заодно".

### Stage 12 cutover считается принятым вручную, если:

- live помогает обновляться, но не нужен для correctness
- fallback refresh работает
- bootstrap не зависит от live
- `[LIVE]` diagnostics полезны и не шумят
- Stage 13 не был затронут без отдельной задачи
