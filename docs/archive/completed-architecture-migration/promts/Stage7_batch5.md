# Stage 7 Batch 5

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
доказать и при необходимости добить server-truth propagation для `landingTab` и `inactivityTimeoutMinutes`.

Факты из аудита:
- эти поля уже не являются отдельным hidden snapshot-flow;
- они уже живут внутри access level permissions;
- читаются через `/api/session`, влияют на bootstrap и home route;
- inactivity timeout реально enforced на серверной сессии;
- основной gap сейчас не “куда писать”, а:
  - насколько последовательно новые значения доходят до current user/session/router
  - есть ли route-safe поведение после изменения access level текущего пользователя
  - не остается ли silent stale state после live update или refresh

Цель:
- не изобретать отдельный API для этих полей;
- довести end-to-end server-truth поведение от access level save до login/session restore,
  current user refresh, canonical home route и inactivity enforcement.

Что нужно сделать:
1. Найти реальные read/write paths для:
   - `landingTab`
   - `inactivityTimeoutMinutes`
2. Подтвердить, что source of truth остается access level permissions + `/api/session`.
3. Проверить и при необходимости исправить propagation paths:
   - после save access level
   - после live update текущего пользователя / его access level
   - после logout/login
   - после F5 / direct URL
4. Обеспечить понятное поведение, если:
   - новый `landingTab` больше недоступен текущему пользователю
   - текущий route после изменения прав стал недоступен
   - timeout изменился для уже активной сессии
5. Не ломать:
   - bootstrap
   - popstate/history
   - `/profile/:id`
   - messaging/profile read behavior

Что нельзя делать:
- не делать отдельный “настройки безопасности” домен
- не менять business meaning `landingTab`
- не менять business meaning inactivity timeout
- не трогать Android special-case без необходимости
- не смешивать этот batch с Stage 8

Обязательно отдельно зафиксировать и проверить:
- open path: `/accessLevels` modal, где реально редактируются эти поля
- confirm path: save access level
- local invalid-state / no-request path
- server conflict / rejected-command path
- refresh path: logout/login, F5, live update текущего пользователя
- route-safe behavior на `/`, home-like route и запрещенном после update route

Формат ответа:
1. Какие propagation/read paths для `landingTab` и `inactivityTimeoutMinutes` изменил.
2. Как теперь подтверждается server-truth behavior.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие риски еще остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Доведено server-truth поведение home route и inactivity timeout"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой `/accessLevels`.
2. У безопасного тестового уровня доступа измени `landingTab`.
3. Сохрани изменение.
4. Выйди и войди снова под пользователем с этим уровнем.
5. Проверь, что домашний маршрут изменился корректно.
6. Если безопасно, измени `inactivity timeout`.
7. Сохрани, обнови страницу через `F5` и проверь, что значение не потерялось.
8. Если после изменения прав текущий экран стал недоступен, проверь, что пользователя переводит на корректный доступный маршрут, а не в сломанное состояние.
