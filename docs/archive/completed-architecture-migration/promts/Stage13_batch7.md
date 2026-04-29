# Stage 13 Batch 7

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
- Это Stage 13: Remove Legacy Snapshot and Transitional Overlaps.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 14:
  - не делать final diagnostics/E2E/perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-12 целиком.
- Допустимо убирать только ту legacy-переходность, которая уже реально заменена новой моделью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно закрыть основной Stage 13 cleanup cutover после Batch 2-6.
Это НЕ финальная приемка Stage 13: после этого batch должны быть отдельные
Batch 8 для removal-path/carve-out proof hardening и Batch 9 для финальной
проверки без исправлений.

Цель:
- подтвердить, что основной cleanup transitional architecture выполнен
- не начать Stage 14 раньше времени
- добрать только минимальные проверки и исправления для cleanup transitional architecture

Что нужно сделать:
1. Проверить весь Stage 13 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/auth-and-navigation.md
   - docs/business-rules/cards-and-approval.md
   - docs/business-rules/directories-and-security.md
   - docs/business-rules/production-and-workspace.md
   - docs/business-rules/workorders-archive-and-items.md
   - docs/business-rules/messaging-profile-and-notifications.md
2. Подтвердить, что Stage 13 теперь покрывает:
   - `/api/data` as critical write path
   - client `saveData()` for critical domains
   - route / write / live overlaps
   - shadow correctness hacks
   - legacy messaging overlap
3. Обязательно повторить точный audit по найденным Batch 1 зонам:
   - `rg -n "saveData\\(|/api/data" js server.js tests/e2e --glob '!tests/e2e/fixtures/**'`
   - `rg -n "/api/messages|api/messages|messages/dialog|messages/send|messages/mark-read" . --glob '!tests/e2e/fixtures/**'`
   - `rg -n "preserveProtectedSlicesForLegacySnapshot|legacy snapshot write boundary|LEGACY_SNAPSHOT_DATA_PATH" server.js`
4. Подтвердить конкретно:
   - `js/app.30.imdx.js` больше не пишет missing directories через snapshot
   - `js/app.10.utils.js` / `js/app.82.forms.js` больше не сохраняют QR через snapshot
   - `js/app.73.receipts.js` больше не использует `saveData()` для in-scope
     workorders/execution actions
   - `POST /api/data` не может перезаписать protected slices
   - `/api/messages/*` не является working server path
5. Подтвердить, что Stage 14 functionality не смешана в Stage 13.
6. Если Stage 13 еще не закрыт, внести только минимальные добивающие изменения,
   относящиеся к cleanup transitional architecture.

Дополнительно, с учетом практического опыта Stage 4, Stage 13 нельзя считать закрытым, если:
- cleanup доказан только на synthetic `409` / mock paths, а real two-tab / multi-client сценарии после удаления overlap не проверены
- после удаления legacy-path остаются silent no-op / silent close / lone `alert(...)` / hidden `return` paths без понятного сообщения и refresh
- какой-то overlap-path удален без явного подтверждения replacement для list/detail/deeplink маршрутов
- unresolved adapter объявлен harmless без явного removal path и без проверки конкурентных UI-сценариев

Критерий завершения Stage 13 cleanup cutover:
- в in-scope perimeter больше нет критичных writes через aggregated snapshot
- `/api/data` если и остается, то только как явно разрешенный read /
  non-critical / out-of-scope compatibility path, а не replacement для domain
  writes
- Stage 8 planning protection от legacy snapshot либо больше не нужна и
  удалена безопасно, либо явно оставлена как guard с понятным removal path
- protected slices из Batch 1 audit не перезаписываются legacy snapshot:
  `messages`, `userActions`, `chat*`, push/FCM, security, production planning
- no parallel domain models
- no correctness on local giant mutable snapshot
- no unresolved adapter left without removal path
- после cleanup для action-capable flows отдельно доказаны `local invalid-state / no-request` и `server-side conflict / rejected-command` paths
- real two-tab / multi-client proof подтверждает, что удаление overlap не открыло silent-noop holes
- Stage 14 final diagnostics/E2E/perf hardening еще не начат

Формат ответа:
1. Выполнен ли Stage 13 полностью или нет.
2. Что именно еще пришлось добить.
3. Какие тесты/сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен основной cleanup snapshot и overlapping механизмов"

После bump проверь, что запись появилась в docs/version-log.html.
```

Важно: после этого batch Stage 13 еще не считается полностью закрытым, если
не доказаны final removal paths для оставшихся compatibility/adapters и
финальная acceptance-проверка без исправлений.

## Ручная проверка после Prompt

Обязательна. Это ручная приемка Stage 13 cleanup cutover перед отдельными Batch 8/9.

### Финальный чек-лист для чайника

1. Открой основные экраны сайта:
   - карточка
   - справочник
   - production-экран
   - чат
2. Выполни по одному безопасному тестовому действию в доступных местах.
3. После каждого действия проверь:
   - данные сохраняются
   - маршрут не теряется
   - после `F5` все остается
4. Проверь, что UI больше не живет на “старой общей snapshot-магии”:
   - после обновления страницы состояние совпадает
   - нет ощущения, что разные части сайта реагируют параллельно и дублируют друг друга
5. Если можешь, открой `F12 -> Console` и быстро проверь, что нет новых грубых ошибок из-за удаления переходных слоев.
6. Убедись, что final E2E/perf hardening не делались “заодно”.

### Stage 13 cleanup cutover считается принятым вручную, если:

- критичные write-path больше не идут через старый общий snapshot
- `saveData()` не является основой critical in-scope writes
- нет дублирующих route/write/live перекрытий
- нет correctness на giant mutable snapshot
- unresolved adapters больше не болтаются без removal path
- Stage 14 не был затронут без отдельной задачи
