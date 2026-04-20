# Stage 2 Batch 6

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
Нужно закрыть Stage 2 end-to-end после предыдущих batch, не меняя саму цель Stage 2 в `docs/architecture/migration-plan.md`.

Цель:
- подтвердить, что Stage 2 выполнен как shared foundation
- добрать только минимальные недостающие элементы
- не начать фактическую доменную миграцию Stage 3+

Что нужно сделать:
1. Проверить весь Stage 2 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/architecture/current-state.md
2. Подтвердить, что теперь существуют:
   - shared server conflict foundation в живом использовании минимум на mature path
   - shared client route-safe write/conflict foundation в живом использовании минимум на mature path
   - shared `[CONFLICT]` / `[DATA]` diagnostics foundation
   - generic revision foundation для будущих `rev/expectedRev` доменов
   - явный legacy-boundary для `/api/data`
3. Если Stage 2 еще не закрыт, внести только минимальные добивающие изменения.
4. Не переходить к Stage 3.
5. Если текущий кодовый behavior реально изменился по сравнению с `current-state.md`,
   обновить только те docs, которые этого требуют по checklist.
6. Не менять формулировку самой цели Stage 2 в `migration-plan.md`.
7. Добавить или обновить только минимальное automated coverage, если его реально не хватает для Stage 2 foundation.

Критерий завершения Stage 2:
- новый in-scope critical write нельзя проектировать через `/api/data` как норму
- есть общий серверный foundation для revision/conflict contract
- есть общий клиентский foundation для route-safe write/conflict handling
- есть shared diagnostics foundation
- business-rules не нарушены
- receipts не затронут как домен
- Stage 3+ еще не начат как массовая доменная миграция

Формат ответа:
1. Выполнен ли Stage 2 полностью или нет.
2. Что именно еще пришлось добить.
3. Какие тесты и сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Подготовлен общий контракт записи и конфликтов для in-scope доменов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 2.

### Финальный чек-лист для чайника

1. Открой сайт.
2. Проверь, что обычная навигация не сломалась:
   - `/cards`
   - `/production/plan`
   - `/workspace`
   - `/users` или `/accessLevels`, если есть доступ
3. Выполни по одному привычному действию в тех местах, где это безопасно:
   - одно действие в старом snapshot-based месте
   - одно действие в workspace или production, если у тебя есть доступ
4. Проверь:
   - ты остаешься на том же экране после действия
   - не появляется прыжок на `/dashboard`
   - обычные ошибки остаются понятными
5. Если умеешь:
   - открой `F12 -> Console`
   - убедись, что есть осмысленные `[DATA]` и `[CONFLICT]` diagnostics без мусорного спама
6. Убедись, что `receipts` не был затронут как домен.

### Stage 2 считается принятой вручную, если:

- старые рабочие сценарии не сломались
- route context после обычных действий не теряется
- diagnostics стали понятнее, а не шумнее
- `/api/data` не расширен как “новая норма”
- receipts не был затронут как домен
