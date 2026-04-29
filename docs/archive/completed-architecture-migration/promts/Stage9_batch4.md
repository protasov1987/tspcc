# Stage 9 Batch 4

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
довести identify, transfer, material issue и material return до единого
execution conflict/refresh contract.

Фактическая отправная точка:
- identify уже идет через `/api/production/flow/identify`
- transfer/commit уже идет через `/api/production/flow/commit`
- material issue / return уже идут через
  `/api/production/operation/material-issue`,
  `/api/production/operation/material-issue-complete`,
  `/api/production/operation/material-return`
- часть modal/confirm logic находится в `js/app.73.receipts.js`; трогать ее
  можно только как workspace execution UI.
- audit нашел `saveData()` side effects в QR/serial paths внутри transfer modal;
  они не должны оставаться частью critical execution confirm path.

Цель:
- не переносить actions на новый API, а выровнять существующие command paths
- сохранить бизнес-семантику идентификации, передачи, выдачи и возврата материала
- убрать или изолировать snapshot-save side effects из in-scope execution confirm paths
- обеспечить route-safe refresh для `/workspace` и `/workspace/:qr`

Что нужно сделать:
1. Найти open/confirm flows для:
   - identification modal
   - transfer/commit modal
   - personal selection mode, если он использует transfer modal
   - material issue modal
   - material return modal
2. Для каждого flow отдельно зафиксировать и при необходимости исправить:
   - open path
   - confirm/submit path
   - local invalid-state / no-request path
   - server-side conflict/rejected-command path
   - list/detail/deeplink routes, где flow доступен
3. Привести raw `apiFetch` paths material issue / return к общему
   conflict/refresh contract, если они еще не используют его.
4. Проверить identify/transfer conflict handling:
   - `expectedFlowVersion`
   - `409`
   - route-safe targeted refresh
   - modal/context не закрывается молча при stale state
5. Убрать или отделить `saveData()` из QR/serial creation/print side effects,
   если этот path влияет на execution confirm correctness.
6. Не менять Stage 8 planning revision и не начинать Stage 10.

Что нельзя делать:
- не менять смысл identify/transfer/material flows
- не ломать `/workspace/:qr`
- не подменять server truth локальной магией
- не переносить drying / delayed / defects / repair / dispose в этот batch
- не делать derived views migration

После изменений обязательно проверить:
- identify/transfer/material issue-return не используют snapshot-save как
  critical execution write path
- conflict не теряет route
- targeted refresh работает корректно
- local invalid-state дает понятный user-visible result

Формат ответа:
1. Какие identify / transfer / material paths изменил или подтвердил.
2. Что именно сохранил из business semantics.
3. Какие `saveData()` side effects убрал, изолировал или признал out-of-scope.
4. Какие local invalid-state / no-request paths проверил.
5. Какие server-side conflict paths проверил.
6. Какие сценарии проверил автоматически.
7. Что нужно проверить вручную после изменений — отдельным чек-листом.
8. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Идентификация, передача и материалы выровнены по execution contract"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/workspace/:qr`, если есть рабочий QR.
2. Выполни одно безопасное действие:
   - identify
   - transfer
   - material issue
   - material return
3. После действия проверь:
   - ты остался на том же маршруте
   - состояние обновилось
   - после `F5` результат сохранился
4. Если есть возможность, повтори один flow в двух вкладках и проверь понятный conflict/refresh behavior.
