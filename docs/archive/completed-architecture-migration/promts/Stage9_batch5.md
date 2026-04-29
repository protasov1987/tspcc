# Stage 9 Batch 5

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
- Это Stage 9: Migrate Workspace and Execution Layer.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 10 и дальше:
  - не делать derived views migration
  - не делать messaging / realtime migration
  - не делать final legacy cleanup за пределами execution-layer
- Нельзя заново переписывать Stage 1-8 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для execution-layer consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 9:
довести drying, delayed/defect actions, repair и dispose до единого execution
conflict/refresh contract.

Фактическая отправная точка:
- drying уже идет через `/api/production/operation/drying-*`
- перенос в delayed/defect в workspace происходит через flow commit statuses
  `DELAYED` / `DEFECT`
- delayed queue return уже идет через `/api/production/flow/return`
- defect queue defect/repair/dispose уже идут через
  `/api/production/flow/defect`,
  `/api/production/flow/repair/check|options|repair`,
  `/api/production/flow/dispose`
- часть delayed/defects UI находится в `js/app.75.production.js`, drying — в
  `js/app.73.receipts.js`

Цель:
- сохранить доменную семантику delayed/defect queues, drying, repair/dispose
- не переносить actions на новый API, а выровнять существующие command paths
- убрать raw/разрозненные conflict paths, где они остались
- обеспечить route-safe refresh для `/workspace`, `/workspace/:qr`,
  `/production/delayed`, `/production/delayed/:qr`,
  `/production/defects`, `/production/defects/:qr`

Что нужно сделать:
1. Найти open/confirm flows для:
   - drying modal: start / finish / complete
   - workspace commit to `DELAYED`
   - workspace commit to `DEFECT`
   - delayed detail return flow
   - defects detail defect confirmation, repair, dispose
2. Для каждого flow отдельно зафиксировать и при необходимости исправить:
   - open path
   - confirm/submit path
   - local invalid-state / no-request path
   - server-side conflict/rejected-command path
   - routes: list / detail / deeplink
3. Привести raw `apiFetch` return/repair/dispose/drying paths к общему
   `runClientWriteRequest`/targeted refresh pattern, если они еще не используют его.
4. Проверить, что file-required flows не закрывают modal молча при local invalid
   state или stale server state.
5. Проверить, что conflict означает:
   - stay on route
   - clear message
   - targeted production/workspace refresh
   - no silent overwrite
6. Не начинать Stage 10/12.

Что нельзя делать:
- не менять смысл delayed/defects/repair/dispose/drying
- не ломать маршруты `/production/delayed`, `/production/defects`, `/workspace`
- не строить correctness на pending-state tricks
- не смешивать это с derived views migration
- не переписывать realtime normalization

После изменений обязательно проверить:
- drying/delayed/defects/repair/dispose не используют snapshot-save как
  critical execution write path
- conflict не приводит к silent overwrite
- route и context сохраняются
- real two-tab/multi-client proof есть хотя бы для одного representative flow,
  а для остальных явно указано, что покрыто API/conflict test или manual path

Формат ответа:
1. Какие execution paths изменил или подтвердил.
2. Что именно сохранил из business semantics.
3. Какие local invalid-state / no-request paths проверил.
4. Какие server-side conflict paths проверил.
5. Какие сценарии проверил автоматически.
6. Что нужно проверить вручную после изменений — отдельным чек-листом.
7. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Задержки, дефекты, сушка и ремонт выровнены по execution contract"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой один из execution-экранов:
   - `/production/delayed`
   - `/production/defects`
   - `/workspace`
2. Выполни одно безопасное тестовое действие, если есть права.
3. Проверь:
   - действие сохранилось
   - маршрут не потерялся
   - после `F5` состояние осталось
4. Для file-required flows проверь, что без файла показывается понятное сообщение и modal не закрывается молча.
5. Если есть сценарий ошибки или конфликта:
   - должно быть понятное сообщение
   - не должно быть тихой перезаписи
