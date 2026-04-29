# Stage 13 Batch 2

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
Нужно реализовать только один batch Stage 13:
закрыть первый конкретный набор critical `saveData()` leftovers, найденный
в Stage13_batch1 audit.

Цель:
- убрать самые явные in-scope critical writes, которые все еще идут через
  client `saveData()` -> `POST /api/data`
- не удалять сам `/api/data` endpoint в этом batch
- не трогать receipts как домен

Что нужно сделать:
1. Повторно подтвердить по коду актуальные `saveData()` call sites:
   - `js/app.30.imdx.js`
   - `js/app.10.utils.js`
   - `js/app.82.forms.js`
   - `js/app.73.receipts.js`
2. В этом batch работать только с первыми двумя группами:
   - IMDX missing directories: добавление `ops` / `centers` через snapshot
   - QR auto-create для карты и изделий: создание `card.qrId` / `card.partQrs`
3. Для IMDX missing directories заменить snapshot-write на существующие
   directory domain commands:
   - departments / centers через `/api/directories/departments`
   - operations через `/api/directories/operations`
   - с сохранением текущего UX import modal / missing modal
4. Для QR auto-create заменить silent snapshot persist на безопасный cards-domain
   path:
   - либо через существующий `cards-core` update с `expectedRev`
   - либо через минимальный явный domain helper, если cards-core уже покрывает
     этот payload
   - без изменения бизнес-смысла QR и печати
5. Не трогать в этом batch:
   - `js/app.73.receipts.js` operation executor/qty/comment leftovers
   - server-side `POST /api/data`
   - Stage 8 `preserveProtectedSlicesForLegacySnapshot`
   - receipts list/detail/domain

Обязательные guardrails из аудита Batch 1:
- `/api/data` может оставаться для GET/read compatibility.
- Server protection для planning/chat/security нельзя ослаблять.
- Любой replacement должен иметь local invalid-state / no-request path и
  server-side conflict/rejected-command path, если сценарий action-capable.

Что нельзя делать:
- не удалять `/api/data` в этом batch
- не трогать out-of-scope `receipts`
- не менять business semantics ради cleanup
- не переписывать весь IMDX/card editor
- не делать cleanup `js/app.73.receipts.js` в этом batch

После изменений обязательно проверить:
- IMDX import missing operations/departments больше не вызывает `POST /api/data`
- QR print/open flows больше не вызывают `saveData()`
- cards/directories domain APIs реально используются
- routes `/cards`, `/cards/:id`, `/card-route/:qr`, `/operations`,
  `/departments` остаются стабильными

Формат ответа:
1. Какие конкретные `saveData()` call sites убрал.
2. Какие domain replacement paths теперь используются.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Убраны первые критичные saveData-записи для IMDX и QR"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой несколько основных экранов, где есть сохранение:
   - карточка с QR
   - импорт IMDX, если есть тестовый файл
   - справочник операций / подразделений
2. Выполни по одному безопасному действию сохранения, если у тебя есть права.
3. Проверь:
   - действие сохраняется
   - маршрут не теряется
   - после `F5` состояние осталось
4. Если QR или IMDX начали сохраняться только визуально, но исчезают после `F5`,
   batch не закрыт.
