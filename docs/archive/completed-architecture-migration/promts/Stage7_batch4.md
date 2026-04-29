# Stage 7 Batch 4

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
- Это Stage 7: Complete Security Domain.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 8 и дальше:
  - не делать production migration
  - не делать messaging migration
  - не делать realtime migration
- Нельзя заново переписывать Stage 1-6 целиком.
- Допустимо трогать только те места соседних этапов, которые нужны для security-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 7:
довести access levels и permission semantics до revision-safe server-truth модели.

Факты из аудита:
- access levels уже редактируются через `/api/security/access-levels`;
- но у них нет полноценного revision/conflict contract;
- часть permission semantics все еще гарантируется только client-side логикой;
- `landingTab` и `inactivityTimeoutMinutes` уже лежат внутри access level model,
  поэтому ломать этот слой нельзя;
- delete flow для access levels сейчас не доказан как существующий action-capable path,
  поэтому нельзя выдумывать новый delete только ради “полноты”.

Цель:
- не “перевести access levels с `/api/data`”, а закрыть реальные gaps:
  - revision / conflict handling
  - server-enforced permission semantics
  - route-safe refresh после conflict/reject

Что нужно сделать:
1. Найти текущие open/confirm flows access levels:
   - `/accessLevels`
   - modal configure/create
2. Добавить revision-safe contract для update/create там, где он реально нужен.
3. Перенести critical permission semantics в server truth:
   - edit не уже чем view
   - нормализация permission payload
   - сохранение `landingTab`
   - сохранение `inactivityTimeoutMinutes`
4. Обеспечить понятный client behavior для:
   - local invalid-state / no-request
   - server conflict / rejected-command
   - route-safe refresh после stale save
5. Не ломать:
   - доступ к вкладкам и действиям
   - `/profile/:id`
   - auth/navigation/bootstrap

Что нельзя делать:
- не менять business meaning access levels
- не выдумывать новый delete flow, если его нет в текущем продукте
- не переносить сюда users batch
- не смешивать этот batch с production/workspace permissions migration

Обязательно отдельно зафиксировать и проверить:
- open path: `/accessLevels` -> modal
- confirm path: submit modal
- local invalid-state / no-request path
- server conflict / rejected-command path
- list route `/accessLevels` как единственный action-capable route
- реальный two-tab или multi-client сценарий, а не только искусственный mock `409`

Формат ответа:
1. Какие access level / permission semantics paths изменил.
2. Что именно теперь enforce'ит сервер, а не только UI.
3. Какие conflict / invalid-state scenarios проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие риски еще остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Доработаны уровни доступа и серверная семантика прав"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/accessLevels`.
2. Открой тестовый уровень доступа.
3. Измени одно безопасное право и сохрани.
4. Проверь:
   - изменение сохранилось
   - маршрут остался `/accessLevels`
   - после `F5` все осталось
5. Если можно безопасно проверить конфликт:
   - открой тот же уровень доступа в двух вкладках
   - сохрани в первой вкладке
   - попробуй сохранить старую форму во второй
6. Проверь:
   - есть понятное сообщение
   - список не исчезает
   - данные обновляются
7. Если право `edit` после сохранения оставило `view` выключенным или появились лишние права, batch не закрыт.
