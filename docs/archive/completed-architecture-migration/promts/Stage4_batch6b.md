# Stage 4 Batch 6B

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
Нужно реализовать только один batch Stage 4:
добить stale-open / live-update UX для input control и provision modals,
чтобы confirm actions не заканчивались тихим no-op, silent close или устаревшим local-only alert path.

Цель:
- исправить race между открытым modal и live-обновлением карточки
- гарантировать понятный user-safe message для input control и provision
- сохранить route и рабочий контекст на `/input-control`, `/provision`, `/cards/:id`, `/card-route/:qr`
- не смешивать это с Stage 5 files migration
- учесть практический опыт Stage4_batch6a:
  - главная зона риска — local stale-open guard paths, где POST вообще не уходит
  - нужно отдельно ловить both no-request invalid-state и server-side `409`

Что нужно сделать:
1. Сначала сделать точную карту open/confirm flows для:
   - input control
   - provision
   отдельно на:
   - `/input-control`
   - `/provision`
   - `/cards/:id`
   - `/card-route/:qr`
2. Для каждого flow явно разделить два класса stale-open ошибок:
   - local invalid-state до сетевого запроса
   - server-side conflict после реально ушедшего запроса
3. Найти все local guard paths, где после live update:
   - action больше недоступен
   - карточка уже переведена в новый stage
   - `inputControlDoneAt` / `provisionDoneAt` уже проставлены
   - modal открыт по старому состоянию карточки, а confirm проверяет уже новое состояние
   - карточка или modal context к моменту confirm уже отсутствуют
   - после upload/refresh внутри modal карточка становится другой ревизии или уже выходит из допустимого состояния
   - запрос не уходит
   - пользователь не получает toast/message
   - modal просто закрывается, остается висеть или показывает только старый `alert(...)`
4. Исправить эти сценарии минимально:
   - по confirm пользователь всегда получает либо результат действия, либо понятное сообщение
   - route и context сохраняются
   - modal не выглядит “мертвым”
   - после stale-open конфликта/invalid-state происходит route-safe refresh
   - диагностика сохраняется или усиливается через `[CONFLICT]` / `[DATA]`
5. Если действие modal зависит от состояния карточки в момент открытия, зафиксировать этот action/context при open и валидировать на confirm,
   чтобы не пропустить stale-open сценарий из-за повторного вычисления только по текущему state.
6. Для stale-open paths, вызванных live update, не полагаться только на старые `alert(...)` как единственный UX.
7. Покрыть реальные multi-client сценарии:
   - второй пользователь заранее открывает modal
   - первый завершает input control или provision
   - второй нажимает confirm уже на устаревшем modal
8. В E2E отдельно доказать оба типа stale-open:
   - confirm не отправляет новый POST, но показывает понятное сообщение и refresh
   - confirm отправляет POST и получает `409`, после чего route/context сохраняются
   Не ограничиваться только interceptor-based stale request.
9. Не переносить сюда:
   - file endpoints
   - file revision contract
   - production planning domain

Что нельзя делать:
- не менять business meaning input control и provision
- не делать Stage 5 files migration
- не ломать approval semantics
- не убирать server-side revision/conflict contract
- не предполагать, что все stale-open ошибки обязательно приходят только через `409`
- не оставлять silent-noop confirm buttons в stale-open paths
- не оставлять `closeModal(); return;`, `return;` или lone `alert(...)` в local invalid-state path без toast/message и refresh
- не ограничиваться проверкой только list routes, если действие доступно еще и из card routes

После изменений обязательно проверить:
- input control stale-open modal больше не молчит после чужого завершения действия
- provision stale-open modal больше не молчит после чужого завершения действия
- пользователь получает понятный toast/message вместо ощущения “кнопка ничего не делает”
- route и context сохраняются
- реальные two-tab E2E покрывают эти сценарии без reliance only on interceptor
- отдельно покрыты stale-open paths, где POST вообще не ушел
- отдельно покрыты stale-open paths на `/cards/:id` и `/card-route/:qr`, если там есть input control / provision action
- после stale-open invalid-state происходит route-safe refresh карточки или списка, а не просто закрытие окна
- диагностика позволяет понять, был ли это local invalid-state или server-side conflict

Формат ответа:
1. Какие input/provision stale-open paths исправил:
   - отдельно no-request local invalid-state
   - отдельно server-side `409` paths
2. Какие old local-only guard behaviors убрал или смягчил.
3. Какие multi-client сценарии проверил автоматически и где именно проверил отсутствие нового POST.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Исправлены silent-noop конфликты в окнах входного контроля и обеспечения"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой одну и ту же карточку в двух вкладках.
2. Во второй вкладке заранее открой:
   - окно входного контроля
   - или окно обеспечения.
3. В первой вкладке успей завершить то же действие раньше.
4. Вернись во вторую вкладку и нажми confirm.
5. Проверь:
   - кнопка не делает “ничего”
   - окно не закрывается “молча”
   - есть понятное сообщение
   - маршрут `/input-control` или `/provision` не потерялся
   - список или карточка обновились до актуального состояния
6. Отдельно проверь сценарий, где stale-open modal остался на карточке `/cards/:id` или `/card-route/:qr`, если этот экран используется для действия.
7. Если confirm во второй вкладке не отправил запрос, но и не показал понятное сообщение с обновлением контекста, batch не закрыт.
8. Если stale-open input/provision modal всё еще молчит, batch не закрыт.
