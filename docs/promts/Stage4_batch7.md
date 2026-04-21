# Stage 4 Batch 7

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
- Это Stage 4: Migrate Approval, Input Control and Provision.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 5 и дальше:
  - не трогать card files как отдельный домен
  - не делать directories/security migration
  - не делать production migration
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно закрыть Stage 4 end-to-end после всех предыдущих batch.

Это ДОЛЖЕН быть последний batch Stage 4.
Новые Stage 4 batch после него создавать нельзя.

Цель:
- подтвердить, что Stage 4 действительно выполнен полностью
- не начать Stage 5 раньше времени
- добрать только минимальные проверки и исправления для approvals, input control и provision
- отдельно подтвердить, что stale-open/live-update сценарии больше не дают silent no-op
- учесть практический опыт Stage4_batch6a и Stage4_batch6b:
  - главная зона остаточного риска — local stale-open guard paths, где POST вообще не уходит
  - Stage 4 нельзя считать закрытым, если проверены только interceptor-based `409`
  - route-safe UX должен быть доказан и на list routes, и на detail routes
  - action/context, зависящий от состояния карточки в момент открытия modal/dialog, должен быть либо уже зафиксирован при open, либо явно признан оставшимся риском

Что нужно сделать:
1. Проверить весь Stage 4 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/cards-and-approval.md
   - docs/business-rules/workorders-archive-and-items.md
2. Подтвердить, что Stage 4 теперь покрывает:
   - send to approval
   - role-based approvals
   - reject with reason
   - return rejected to draft
   - input control
   - provision
   - stage transitions
   - audit/log side effects
   - stale-open/live-update conflict UX
3. Подтвердить, что Stage 5 functionality не смешана в Stage 4.
4. Сначала явно составить итоговую карту Stage 4 write/open/confirm flows:
   - approvals:
     - `/approvals`
     - `/cards/:id`
     - `/card-route/:qr`, если approval action там доступен
   - input control:
     - `/input-control`
     - `/cards/:id`
     - `/card-route/:qr`
   - provision:
     - `/provision`
     - `/cards/:id`
     - `/card-route/:qr`
5. Для каждого Stage 4 flow отдельно проверить два класса конфликтных путей:
   - local invalid-state / stale-open до сетевого запроса
   - server-side `409` после реально ушедшего запроса
6. Обязательно проверить не только interceptor-based stale request, но и реальные multi-client stale-open scenarios:
   - modal/dialog открыт во второй вкладке заранее
   - в первой вкладке действие уже завершено
   - во второй вкладке confirm не должен молчать
7. Не считать Stage 4 закрытым, если какой-то stale-open path доказан только через interceptor, но не через реальный two-tab сценарий там, где UI действительно открывает modal/dialog заранее.
8. Если Stage 4 еще не закрыт, внести только минимальные добивающие изменения.
9. Если в коде остались local guard paths вида:
   - `return;`
   - `closeModal(); return;`
   - lone `alert(...)`
   в confirm/open path для approvals/input/provision без toast/message и route-safe refresh,
   это считать незакрытым Stage 4 UX debt, а не “мелочью”.

Критерий завершения Stage 4:
- никакой approval/input/provision write не использует `saveData()`
- stage semantics `DRAFT -> ON_APPROVAL -> REJECTED/APPROVED -> WAITING_* -> PROVIDED -> PLANNING -> PLANNED` сохранены
- reject reason сохранен
- audit trail и обязательные side effects сохранены
- conflict сохраняет route и context
- клиент показывает понятное сообщение не только при server-side `409`, но и в stale-open/live-update paths, где действие уже потеряло актуальность
- ни одна Stage 4 confirm-кнопка не завершает сценарий тихим no-op или silent close при конкурентном изменении карточки
- stale-open сценарии разделены и доказаны отдельно:
  - no-request local invalid-state
  - server-side `409`
- stale-open UX подтвержден не только на list routes, но и на `/cards/:id` / `/card-route/:qr`, если там доступно соответствующее действие
- если действие зависит от state на момент открытия modal/dialog, stale-open не прячется за повторным вычислением только по текущему state без user-safe message
- существующие file endpoints могут оставаться integration point для input control, но Stage 5 files migration еще не начат как отдельная доменная миграция
- legacy read-path `GET /api/data?scope=cards-basic` / `/api/cards-live` сам по себе не считается blocker для закрытия Stage 4, если Stage 4 write-path уже domain-based

Формат ответа:
1. Выполнен ли Stage 4 полностью или нет.
2. По каким именно flows Stage 4 был подтвержден:
   - approvals
   - input control
   - provision
   отдельно указать:
   - no-request local invalid-state paths
   - server-side `409` paths
3. Что именно еще пришлось добить.
4. Какие тесты/сценарии проверил автоматически.
   Отдельно указать:
   - где проверен real two-tab stale-open without new POST
   - где проверен real `409`
   - какие routes покрыты: list/detail
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Какие остаточные риски остались.
   Если Stage 4 объявляется закрытым, риски должны быть только non-blocking, а не незакрытые conflict/stale-open holes.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен переход согласования, input control и provision карточек на отдельные команды"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 4.

### Финальный чек-лист для чайника

1. Открой карточку, которую можно отправить на согласование.
2. Выполни отправку на согласование.
3. Если у тебя есть доступ:
   - сделай approve
   - или reject с причиной
4. Проверь:
   - маршрут не потерялся
   - карточка не закрылась сама
   - статус меняется как ожидалось
5. Если доступен сценарий возврата rejected в draft:
   - выполни его
   - проверь, что карточка действительно вернулась в draft
6. Если доступен input control:
   - выполни действие
   - проверь, что результат сохранился после `F5`
7. Если доступен provision:
   - выполни действие
   - проверь, что результат сохранился после `F5`
8. Если можешь, вызови конфликт в двух вкладках:
   - в первой измени состояние карточки
   - во второй попробуй выполнить устаревшее действие
   - должен быть конфликт, а не тихая перезапись
9. Отдельно проверь stale-open сценарий:
   - заранее открой modal/dialog во второй вкладке
   - в первой вкладке выполни действие раньше
   - во второй вкладке confirm должен показать понятное сообщение, а не просто “ничего не сделать”
10. Убедись, что files domain не был "переделан заодно", кроме допустимой интеграции уже существующего file API.
11. Отдельно проверь оба типа конфликтов:
   - confirm не отправил запрос, потому что окно уже устарело
   - confirm отправил запрос и получил `409`
12. Если действие доступно на карточке `/cards/:id` или `/card-route/:qr`, проверь и там, а не только на списке.

### Stage 4 считается принятым вручную, если:

- send to approval работает
- approve/reject работают
- reject reason не теряется
- return to draft сохраняет старый смысл
- input control работает
- provision работает
- конфликт не теряет маршрут
- есть понятное сообщение и refresh как при no-request stale-open, так и при server-side `409`
- stale-open modal/dialog не молчит и не зависает без сообщения
- stale-open проверен не только на list page, но и на detail route, если действие там доступно
- Stage 5 files не были затронуты как отдельная доменная миграция
