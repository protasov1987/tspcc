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
перевести client-side upload flow карточки на новый file-domain contract.

Цель:
- убрать upload файлов карточки с snapshot-based write path
- сохранить текущий UX карточки
- после upload получать и использовать новый `cardRev`

Что нужно сделать:
1. Найти client-side upload flow карточки.
2. Перевести его на explicit file-domain endpoint / command.
3. После успешного upload:
   - обновлять card/file state корректно
   - принимать новый `cardRev`
   - оставлять пользователя на текущем route
4. При конфликте:
   - показать понятное сообщение
   - не выбрасывать пользователя с карточки
   - выполнить точечный refresh карточки

Что нельзя делать:
- не менять business semantics типов файлов
- не ломать карточку без файлов
- не менять unrelated approval/input/provision flows
- не делать Stage 6 migration

После изменений обязательно проверить:
- upload больше не зависит от snapshot-save path
- карточка остается на том же route
- новый `cardRev` используется дальше корректно

Формат ответа:
1. Какой client-side upload path перевел.
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
6. Если можешь:
   - открой ту же карточку во второй вкладке
   - в первой загрузи файл
   - во второй попробуй выполнить upload со старым состоянием
7. Во второй вкладке должен быть понятный конфликт, а не тихая поломка.
