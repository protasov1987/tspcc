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
Нужно закрыть Stage 2 end-to-end после предыдущих batch.

Цель:
- подтвердить, что Stage 2 действительно выполнен как shared foundation
- не начать фактическую доменную миграцию Stage 3+
- добрать только минимальные проверки и документы для Stage 2

Что нужно сделать:
1. Проверить весь Stage 2 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/architecture/current-state.md
2. Подтвердить, что теперь существуют:
   - shared revision model foundation
   - shared conflict envelope foundation
   - shared client command pattern foundation
   - shared `[CONFLICT]` / `[DATA]` diagnostics foundation
   - явный legacy-boundary для `/api/data`
3. Если Stage 2 еще не закрыт, внести только минимальные добивающие изменения.
4. Не переходить к Stage 3.

Критерий завершения Stage 2:
- новый in-scope domain write нельзя проектировать через `/api/data` как норму
- есть общий серверный foundation для `id + rev + expectedRev + 409`
- есть общий клиентский foundation для route-safe write/conflict handling
- есть shared diagnostics foundation
- business-rules не нарушены
- receipts не затронут как домен
- Stage 3+ еще не начат как массовая доменная миграция

Формат ответа:
1. Выполнен ли Stage 2 полностью или нет.
2. Что именно еще пришлось добить.
3. Какие тесты/сценарии проверил автоматически.
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
   - одно сохранение или действие в старом snapshot-based месте
   - одно действие в production, если у тебя есть доступ и рабочий сценарий
4. Проверь:
   - ты остаешься на том же экране после действия
   - не появляется внезапный прыжок на `/dashboard`
   - обычные ошибки, если они есть, остаются понятными
5. Если умеешь:
   - открой `F12 -> Console`
   - убедись, что есть осмысленные `[DATA]` и conflict-related diagnostics без мусорного спама
6. Убедись, что `receipts` не трогали специально.
7. Убедись, что после Stage 2 сайт работает как раньше, но foundation под новый write/conflict contract уже заложен.

### Stage 2 считается принятым вручную, если:

- старые рабочие сценарии не сломались
- route context после обычных действий не теряется
- diagnostics стали понятнее, а не шумнее
- `/api/data` не расширен как “новая норма”
- `receipts` не был затронут как домен
