# Stage 2 Batch 2

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
ввести server-side shared primitives для revision/conflict contract без полной доменной миграции.

Цель:
- подготовить единый серверный фундамент для `id + rev + expectedRev + 409`
- не ломая текущие рабочие домены
- не переводя в этой задаче cards/directories/security/production полностью на новые APIs

Что нужно сделать:
1. Найти лучшее место для общих server-side helper primitives.
2. Ввести минимальный набор shared helpers для:
   - чтения/нормализации ревизии
   - сравнения `expectedRev`
   - стандартного ответа `409 Conflict`
   - стандартного envelope:
     - `code`
     - `entity`
     - `id`
     - `expectedRev`
     - `actualRev`
     - user-safe message
3. Не менять бизнес-логику существующих доменных операций.
4. Не переводить в этом batch конкретные домены целиком.
5. Если уже есть production-style конфликтная логика, аккуратно использовать её как основу, но не ломать текущую работу production.

Что нельзя делать:
- не менять доменные правила cards/approvals/directories/production
- не менять route behavior
- не менять realtime
- не переписывать server.js крупным куском без необходимости
- не делать массовый перенос endpoint'ов на новый contract в этом batch

После изменений обязательно проверить:
- существующие production conflict-path не сломались
- обычные API-ответы не стали несовместимыми без причины
- новый shared conflict helper действительно можно использовать повторно

Формат ответа:
1. Где именно внедрил shared server primitives.
2. Что именно добавил.
3. Какие существующие endpoints и сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлен общий серверный контракт ревизий и конфликтов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Открой `/production/plan`.
3. Открой `/workspace`, если у тебя есть доступ.
4. Убедись, что страницы открываются как раньше.
5. Если есть сценарий, который раньше точно сохранял данные в production:
   - выполни одно привычное действие
   - убедись, что оно не начало падать сразу после batch
6. Если есть возможность, открой браузерную консоль:
   - не должно появиться новых грубых ошибок сразу при обычной работе
7. Если после batch начали ломаться уже существующие production действия, batch не закрыт.
