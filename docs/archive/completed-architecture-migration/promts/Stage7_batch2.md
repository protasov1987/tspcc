# Stage 7 Batch 2

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
усилить server-side foundation security-domain под реальные gaps аудита.

Факты из аудита, от которых нужно отталкиваться:
- отдельные `/api/security/*` endpoint'ы уже существуют;
- users и access levels уже редактируются не через основной UI-path `/api/data`;
- но у security-domain еще нет полного revision/conflict foundation;
- users имеют `rev`, но update/delete еще без полноценного `expectedRev -> 409` contract;
- access levels пока вообще без полноценного revision/conflict contract;
- server еще не является единственным гарантом некоторых security invariants.

Цель batch:
- не “создать security API с нуля”, а довести server foundation до состояния,
  на котором можно безопасно закрыть следующие batch;
- подготовить общий security command contract для users и access levels;
- не тащить сюда client cutover, Stage 8 или messaging migration.

Что нужно сделать:
1. Найти текущие server-side security handlers и helpers.
2. Добавить или довести общие primitives для security commands:
   - normalize / validate input
   - permission checks
   - revision helpers
   - единый conflict / invalid-state response shape
   - единый способ прикладывать актуальный security payload для route-safe refresh
3. Подготовить foundation так, чтобы следующие batch могли использовать его для:
   - users update/delete conflict handling
   - access level update conflict handling
   - server-enforced invariants (`Abyss`, permission semantics, security settings)
4. Не ломать:
   - login / session restore
   - `/profile/:id`
   - текущий auth bootstrap
   - Stage 6 employees/department assignment
5. Явно отделить security foundation от:
   - Stage 6 directories employee assignment
   - Stage 8 production conflict model
   - messaging/profile chat behavior

Что нельзя делать:
- не переписывать весь client-side security UI в этом batch
- не выдумывать новый большой framework “на будущее”
- не смешивать foundation для security с production/workspace foundation
- не трогать routes без явной необходимости
- не переносить employees department assignment в security-domain

Что нужно подтвердить по коду после изменений:
1. Где находится единый security conflict/invalid-state contract.
2. Где находятся revision helpers для users и access levels.
3. Какие invariants теперь может enforce'ить сервер без доверия к UI.
4. Что Stage 6 employee assignment остался отдельной directory boundary.

Формат ответа:
1. Какие server-side security primitives или helpers добавил/изменил.
2. Какие следующие Stage 7 batch теперь могут на них опираться.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие риски еще остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Усилен серверный foundation домена безопасности"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой `/users`.
2. Открой `/accessLevels`.
3. Убедись, что экраны открываются как раньше.
4. Открой свой `/profile/ID`.
5. Убедись, что профиль открывается без новых ошибок.
6. Если после batch security-экраны перестали открываться или профиль начал падать, batch не закрыт.
