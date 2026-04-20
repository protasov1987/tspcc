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
ввести явную legacy-boundary вокруг `/api/data` и запретить расширение snapshot-save как модели для новых критичных write-path.

Цель:
- Stage 2 должен зафиксировать, что `/api/data` — legacy path
- новые критичные write-механизмы не должны проектироваться через `/api/data`
- при этом нельзя ломать текущие рабочие snapshot-based домены до Stage 3+

Что нужно сделать:
1. Найти лучшее место для явного обозначения `/api/data` как legacy boundary:
   - в клиенте
   - на сервере
   - в helper/wrapper слое
2. Сделать так, чтобы новый код не мог “случайно” использовать `/api/data` как норму для новых write-механизмов.
3. Если возможно, обернуть существующий snapshot-save в явно legacy API/helper с говорящим именем и границами использования.
4. Не ломать текущие домены, которые еще не мигрированы.

Что нельзя делать:
- не удалять `/api/data` в этом batch
- не ломать существующие flows cards/directories/production
- не начинать фактическую доменную миграцию Stage 3+
- не трогать receipts как домен

После изменений обязательно проверить:
- существующие snapshot-based сценарии все еще работают
- новый boundary явно показывает, что `/api/data` — legacy path
- нет новых путей, расширяющих эту модель

Формат ответа:
1. Как именно обозначил legacy-boundary для `/api/data`.
2. Что именно изменил.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Зафиксирована legacy-граница общего snapshot-save через /api/data"

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
   - старый рабочий сценарий не сломался внезапно
7. Если после batch старый сценарий сохранения просто перестал работать, batch не закрыт.
