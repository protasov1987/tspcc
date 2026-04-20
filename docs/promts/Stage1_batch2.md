# Stage 1 Batch 2 - done

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
ввести явный session-first guard в central router для всех protected routes.

Цель:
- сам router не должен рендерить protected route content, пока restoreSession()/checkAuth() не завершен
- до session decision разрешены только loader / overlay / auth-entry state
- popstate, direct URL и прямые вызовы handleRoute должны obey same guard
- после session restore должен активироваться именно маршрут из URL, а не home screen по умолчанию

Что нужно сделать:
1. Найти текущие пути, где handleRoute может выполняться до завершения session restore.
2. Ввести явное состояние bootstrap/session readiness, которое понимает central router.
3. Закрыть protected route rendering timing именно в router flow, а не разрозненными guard по страницам.
4. Сохранить текущую семантику:
   - `/` как auth-entry
   - landingTab
   - permission-based denial
   - privacy `/profile/:id`
5. Не выравнивать весь bootstrap order в этом batch, кроме минимально необходимого для session-first guard.

Что проверить обязательно:
- js/app.00.state.js
- js/app.50.auth.js
- js/app.99.init.js
- tests/e2e/00.auth-routes.spec.js

После изменений обязательно проверить:
- direct URL на `/cards`
- direct URL на `/cards/:id`
- direct URL на `/profile/:id`
- direct URL на `/production/plan`
- `F5` на protected routes
- отсутствие protected content до session restore
- отсутствие forced redirect на `/dashboard`

Формат ответа:
1. Где именно router допускал protected rendering раньше времени.
2. Что именно изменил в session-first guard.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Обновлялся ли docs/architecture/spa-boot.md.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добавлен session-first guard для защищенных маршрутов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой сайт, если нужно выйди из аккаунта.
2. Вставь в адресную строку `/cards`.
3. До входа в систему не должен появляться контент карточек.
4. После входа должен открыться именно `/cards`, без прыжка на `/dashboard`.
5. Повтори то же для:
   - `/cards/ID_КАРТОЧКИ`
   - `/profile/ID_ТЕКУЩЕГО_ПОЛЬЗОВАТЕЛЯ`
   - `/production/plan`
6. На каждом маршруте нажми `F5`.
7. После `F5` должен остаться тот же экран.
8. Если хотя бы на секунду виден защищенный экран до завершения входа или загрузки сессии, batch не закрыт.

