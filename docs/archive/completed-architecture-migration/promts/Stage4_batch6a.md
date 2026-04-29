# Stage 4 Batch 6A

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
добить stale-open / live-update UX для approval modal и approval dialog,
чтобы ни одно action согласования не завершалось тихим no-op или silent close.

Цель:
- исправить race между открытым modal/dialog и live-обновлением карточки
- гарантировать понятный user-safe message для approval actions
- сохранить route и рабочий контекст на `/approvals`, `/cards/:id`, `/card-route/:qr`
- не смешивать это с Stage 5 files, Stage 8 production и общим cards refactor

Что нужно сделать:
1. Найти все approval action handlers, которые могут попасть в stale-open сценарий:
   - send to approval
   - approve
   - reject
   - return rejected to draft
2. Найти early-return / silent-close / local guard paths, где при уже изменившейся карточке:
   - запрос вообще не уходит
   - toast не показывается
   - modal/dialog просто закрывается или кнопка визуально “ничего не делает”
3. Исправить эти сценарии минимально:
   - пользователь должен получить понятный toast/message
   - route не должен теряться
   - рабочий контекст карточки не должен закрываться без причины
   - после сообщения должен быть route-safe refresh карточки или списка
4. Явно проверить live-update race:
   - второй пользователь держит modal/dialog открытым
   - первый пользователь успевает завершить action
   - второй пользователь затем нажимает confirm
   - результат не должен быть silent no-op
5. Не ограничиваться искусственным stale `expectedRev` через interceptor:
   нужен реальный two-tab/live-update сценарий.
6. Не переносить сюда:
   - input control
   - provision
   - files domain

Что нельзя делать:
- не менять business meaning approval lifecycle
- не убирать existing conflict contract
- не делать big refactor approval UI
- не подменять server conflict полностью локальной магией
- не оставлять старые silent no-op paths “как есть”, если они still break Stage 4 UX

После изменений обязательно проверить:
- approve больше не закрывается тихо, если карта уже согласована другим пользователем
- reject не зависает в stale-open modal без сообщения
- send to approval и return to draft тоже не имеют silent-open race path
- на `/approvals` и на карточке сохраняются route и context
- stale-open сценарии покрыты реальными multi-client E2E, а не только interceptor-based stale request

Формат ответа:
1. Какие approval stale-open / silent-noop paths исправил.
2. Какой user-visible conflict/invalid-state UX теперь гарантирован.
3. Какие реальные multi-client сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Исправлены silent-noop конфликты в окнах согласования карточек"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой одну и ту же карточку в двух вкладках.
2. Во второй вкладке заранее открой:
   - окно approve на `/approvals`
   - или dialog отправки/возврата на карточке.
3. В первой вкладке успей выполнить соответствующее действие раньше.
4. Вернись во вторую вкладку и нажми confirm.
5. Проверь:
   - кнопка не делает “тишину”
   - есть понятное сообщение
   - маршрут не потерялся
   - карточка или список обновились до актуального состояния
6. Если хотя бы один stale-open approval сценарий всё еще молчит, batch не закрыт.
