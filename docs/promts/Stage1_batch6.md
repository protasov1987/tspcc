# Stage 1 Batch 6

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
- Это Stage 1: Stabilize Routing, Bootstrap and Auth For Entire In-Scope Perimeter.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче переводить домены на новые write API.
- Нельзя переписывать realtime.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняется bootstrap order — обязательно обнови docs/architecture/spa-boot.md.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 1:
убрать остаточные route/bootstrap-adjacent blockers, которые мешают надежной Stage 1 validation.

Цель:
- убрать только те non-domain проблемы, которые ломают или искажают Stage 1 smoke / route verification
- сюда относятся только проблемы рядом с auth / bootstrap / routing / validation surface
- примеры допустимого scope:
  - duplicate DOM ids, мешающие auth/bootstrap smoke
  - route/page identifier inconsistencies
  - минимальные недостающие `[BOOT]` / `[ROUTE]` точки, если без них невозможно локализовать сбой
- не превращать batch в общий UI cleanup

Что нужно сделать:
1. Посмотреть остаточные падения после Stage1_batch5.
2. Найти только те blockers, которые реально мешают проверить Stage 1.
3. Исправить их минимально, без изменения business logic.
4. Если diagnostics уже достаточны — не добавлять шум.
5. Повторно прогнать Stage 1 базовые E2E.

Что нужно проверить обязательно:
- index.html
- js/app.00.state.js
- js/app.50.auth.js
- tests/e2e/00.auth-routes.spec.js
- tests/e2e/01.pages-and-modals-smoke.spec.js

Что нельзя делать:
- не делать общий редизайн интерфейса
- не переписывать unrelated modal flows
- не чинить Stage 2+ проблемы
- не трогать receipts как домен

Формат ответа:
1. Какие именно residual blockers мешали Stage 1 validation.
2. Что именно изменил.
3. Какие тесты прогнал и с каким результатом.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Убраны остаточные блокеры проверки Stage 1"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Нажми кнопку помощи на экране входа, если она есть.
3. Окно помощи должно открыться и закрыться нормально, без странных дублей.
4. Войди в систему.
5. Перейди на `/users` и `/accessLevels`, если есть доступ.
6. Убедись, что страницы открываются без пустого экрана и без странных ошибок.
7. Если умеешь открыть консоль браузера, проверь:
   - есть `[BOOT]` и `[ROUTE]`
   - нет бессмысленного бесконечного спама
8. Если smoke-сценарии все еще ломаются на странных UI-мелочах рядом с auth/bootstrap, batch не закрыт.

