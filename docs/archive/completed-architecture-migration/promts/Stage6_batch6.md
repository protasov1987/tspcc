# Stage 6 Batch 6

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
- Это Stage 6: Migrate Directories.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 7 и дальше:
  - не делать security migration
  - не делать production migration
  - не делать messaging migration
- Нельзя заново переписывать Stage 3/4/5 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для directory-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 6:
сделать финальный technical cleanup Stage 6 перед закрытием этапа.

Цель:
- убедиться, что после batch 2-5 в Stage 6 не осталось working write-path через `saveData()` и `/api/data`
- убрать только реальные остаточные legacy-path внутри directory-domain
- не сломать совместимость reads для cards, production и security-adjacent экранов

Что нужно сделать:
1. Повторно проверить все in-scope subdomain Stage 6:
   - departments / centers
   - operations
   - areas
   - employees assignment
   - shift times
2. Найти и убрать только реально оставшиеся snapshot-based write paths для этих subdomain.
3. Проверить, что legacy `/api/data` при необходимости еще может жить для других этапов,
   но больше не является рабочим write-path для Stage 6 scope.
4. Довести общие правила консистентности:
   - permission checks
   - revision / conflict handling where needed
   - targeted refresh нужных slices
   - отсутствие silent no-op на action-capable flow
5. Добавить или расширить regression coverage по всем пяти subdomain.
6. Не начинать Stage 7 security migration и не тянуть сюда planning migration.

Что нельзя делать:
- не менять users/access levels semantics
- не переписывать unrelated cards/production flows
- не удалять legacy snapshot path для других доменов, если он им еще нужен
- не считать batch закрытым без проверки всех пяти subdomain

После изменений обязательно проверить:
- ни один directory write больше не идет через `/api/data`
- `saveData()` больше не является рабочим write-path для Stage 6 scope
- production и cards продолжают читать directory data без регрессий
- на всех action-capable routes есть понятный путь для invalid-state и conflict

Формат ответа:
1. Какие остаточные directory paths убрал или добил.
2. Какие snapshot-based directory paths убрал.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Удалены остаточные snapshot-пути записи справочников"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Быстро открой основные directory-экраны:
   - `/departments`
   - `/operations`
   - `/areas`
   - `/employees`
   - `/shift-times`
2. На каждом экране проверь хотя бы один безопасный action или сохранение.
3. После каждого действия проверь:
   - маршрут не потерялся
   - после `F5` состояние не исчезло
4. Если можешь, проведи один двухвкладочный сценарий на любом из экранов.
5. Если после batch хотя бы один directory save по-прежнему ведет себя как старое snapshot-сохранение, молча не срабатывает или ломает экран, batch не закрыт.
