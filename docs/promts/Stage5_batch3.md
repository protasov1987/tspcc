# Stage 5 Batch 3

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
- Это Stage 5: Complete Card Files.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 6 и дальше:
  - не делать directories/security migration
  - не делать production migration
  - не делать messaging migration
- Нельзя заново переписывать Stage 3/4 целиком.
- Допустимо трогать только те места Stage 3/4, которые нужны для file-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 5:
перевести только in-scope client-side upload caller'ы карточки на новый revision-safe file contract.

Цель:
- не расширяя scope, начать client cutover только там, где upload реально выполняется сейчас
- после upload принимать и использовать ответ нового file contract
- сохранить текущий UX и route-safe behavior

Что нужно сделать:
1. Перевести только 3 upload caller'а, которые уже входят в scope аудита:
   - generic attachments modal
   - `addInputControlFileToActiveCard()`
   - pre-upload внутри input-control confirm modal
2. Для каждого caller'а использовать новый server contract file-domain:
   - передавать `expectedRev`
   - принимать `cardRev` и file-linked payload или свежую `card`
3. После успешного upload:
   - обновлять card/file state точечно
   - не ждать live-событие как единственный источник истины
   - оставлять пользователя на текущем route
4. Для stale/conflict path:
   - показать понятное сообщение
   - не выбрасывать пользователя с карточки или модалки
   - выполнить точечный refresh карточки, а не fallback на полный `cards-basic` refresh, если это можно сделать локально
5. Сохранить совместимость с текущими global arrays (`cards`, `activeCardDraft`) без отдельного refactor file store.

Что нельзя делать:
- не менять business semantics типов файлов
- не ломать карточку без файлов
- не переводить upload caller'ы вне этих 3 путей
- не менять unrelated approval/input/provision flows, кроме строго необходимого file-contract compatibility
- не делать Stage 6 migration
- не объявлять, что весь client-side file-domain уже отделен от глобального card state

После изменений обязательно проверить:
- все 3 in-scope upload caller'а используют новый revision-safe contract
- карточка остается на том же route
- новый `cardRev` и file-linked payload используются дальше корректно
- generic attachments modal и input-control flows не зависят от live update как от единственного механизма коррекции состояния

Формат ответа:
1. Какие именно 3 client-side upload path перевел.
2. Что именно изменил в refresh/conflict behavior.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Загрузка файлов карточек переведена на отдельный контракт с ревизиями"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой карточку с файлами.
2. Загрузи один тестовый файл.
3. Проверь:
   - файл появился в списке
   - ты остался на той же карточке
   - URL не изменился сам по себе
4. Нажми `F5`.
5. Проверь, что файл после обновления страницы все еще на месте.
6. Повтори upload через:
   - обычную модалку вложений
   - кнопку добавления файла input control, если этот сценарий доступен
7. Если можешь:
   - открой ту же карточку во второй вкладке
   - в первой загрузи файл
   - во второй попробуй выполнить upload со старым состоянием
8. Во второй вкладке должен быть понятный конфликт, а не тихая поломка.
