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
нормализовать уже существующий conflict-path в production/workspace как первую reference implementation shared contract.

Цель:
- взять текущий mature path `expectedFlowVersion -> 409 -> targeted refresh`
- ввести shared server-side conflict primitives
- не начинать миграцию cards/directories/security/files на новые write API
- не менять цель Stage 2, а только заложить её foundation на уже зрелом домене

Что нужно сделать:
1. Найти повторяющиеся server-side conflict branches в существующих `/api/production/*` endpoint'ах.
2. Ввести минимальный reusable server helper / helpers для:
   - нормализации expected version input
   - формирования conflict response
   - shared conflict fields
   - совместимого ответа без поломки текущих клиентов
3. Shared conflict contract этого batch должен быть пригоден как база для будущих `rev/expectedRev`,
   но сейчас применяется только к уже существующему `flow.version` path.
4. Если текущий клиент зависит от legacy полей ответа вроде `error` и `flowVersion`,
   их нельзя ломать. Новый shared contract должен быть совместимым слоем сверху, а не breaking change.
5. Подключить helper только к существующим production/workspace conflict-enabled endpoint'ам.
6. Не менять business-rules production/workspace и не менять route behavior.

Что нельзя делать:
- не переписывать весь `server.js`
- не трогать generic cards/directories/security writes
- не вводить полную `expectedRev`-миграцию доменов
- не трогать realtime
- не выполнять Stage 3 и дальше

После изменений обязательно проверить:
- существующие production/workspace `409` paths не сломались
- старые клиенты не потеряли совместимость по полям ответа
- новый helper реально reusable и не зашит намертво под один endpoint
- `tests/e2e/02.workspace-realtime.spec.js` не деградировал

Формат ответа:
1. Где именно внедрил shared server conflict primitives.
2. Что именно стандартизовал.
3. Какие endpoint'ы и сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Нормализован серверный контракт конфликтов для production и workspace"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Открой `/workspace`, если у тебя есть доступ.
3. Открой `/production/plan`.
4. Убедись, что страницы открываются как раньше.
5. Выполни одно привычное действие в workspace или production, которое точно работало до batch.
6. Если есть известный concurrent/stale сценарий:
   - воспроизведи его
   - убедись, что ошибка осталась понятной
   - маршрут не должен теряться
7. Если уже существующие production/workspace действия начали падать или вести себя иначе без причины, batch не закрыт.
