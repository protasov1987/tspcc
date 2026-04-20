# Stage 2 Batch 5

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
- Это Stage 2: Introduce Shared Domain Write and Conflict Contract.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 3 и дальше: не переводить конкретные домены на новые write API полностью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 2:
подготовить generic revision foundation для будущих `rev/expectedRev` доменов и зафиксировать `/api/data` как legacy boundary.

Цель:
- после этого batch в коде должен существовать reusable foundation для `rev/expectedRev`
- `/api/data` должен быть явно обозначен как legacy snapshot-save path
- при этом нельзя начинать полную миграцию cards/directories/security/files

Что нужно сделать:
1. Найти лучшее место для shared revision primitives:
   - чтение / нормализация `rev`
   - чтение / нормализация `expectedRev`
   - сравнение expected vs actual
   - совместимое формирование conflict payload через helper из Batch 2
2. Эти primitives должны быть подготовлены для будущих доменов,
   но в этом batch нельзя делать полную доменную миграцию Stage 3+.
3. Найти лучшее место для явного обозначения `/api/data` как legacy boundary:
   - в клиенте
   - на сервере
   - в helper/wrapper слое
4. Сделать так, чтобы новый код не мог “случайно” расширять `/api/data` как новую норму.
5. Если массовый rename рискован, допустим thin wrapper / alias / boundary-helper / comment-based explicit boundary,
   но итог должен быть архитектурно явным.
6. Не ломать текущие snapshot-based домены, которые еще не мигрированы.

Что нельзя делать:
- не удалять `/api/data`
- не ломать существующие `saveData()` flows
- не переводить cards/directories/security/files на новые endpoint'ы
- не выполнять Stage 3 и дальше
- не трогать receipts как домен

После изменений обязательно проверить:
- старые snapshot-based сценарии все еще работают
- generic revision primitives реально можно переиспользовать дальше
- `/api/data` теперь явно виден как legacy path, а не “новая норма”

Формат ответа:
1. Где именно добавил generic revision foundation.
2. Как именно зафиксировал legacy-boundary для `/api/data`.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Подготовлен общий фундамент ревизий и зафиксирована legacy-граница /api/data"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Выполни одно старое привычное действие, которое точно раньше сохранялось:
   - например сохранение карточки
   - или действие в справочниках
3. Проверь, что оно не перестало работать после batch.
4. Открой `/cards`.
5. Открой `/departments` или `/operations`, если есть доступ.
6. Убедись, что:
   - страницы открываются
   - старый рабочий сценарий не сломался
   - приложение не ведёт себя так, будто `/api/data` внезапно отключили
7. Если старый snapshot-based сценарий просто перестал работать без замены доменного пути, batch не закрыт.
