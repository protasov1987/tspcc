# Stage 10 Batch 7 — Stage 10 Route Cutover Hardening

## Роль
Ты — Codex Agent в репозитории `tspcc.ru`.

## Контекст
Stage 10 переводит derived production routes на source-of-truth модель.

Предыдущие batch должны были закрыть:

- `/workorders` read/write blocker;
- `/workorders` route-safe and multi-client proof;
- `/archive` and archive repeat;
- `/items`, `/ok`, `/oc`;
- консолидацию source contracts для Stage 10 routes.

Этот batch нужен не для новых доменов, а для hardening после cutover.

## Цель batch

Проверить и укрепить Stage 10 routes как единый cutover:

- прямые заходы и F5 не должны откатывать пользователя на dashboard;
- Back / Forward должны работать без перезагрузки;
- stale actions должны отклоняться через source-domain версионную защиту;
- UI не должен показывать “успешно”, если server command отклонён;
- локальные mutations не должны маскировать фактическое состояние сервера.

## Важно

Не начинать Stage 13.

Нельзя:

- удалять `/api/data` глобально;
- переписывать unrelated legacy pages;
- трогать receipts domain;
- трогать messaging/profile;
- добавлять отдельные page-specific command APIs без необходимости;
- менять bootstrap/router без соблюдения `AGENTS.md`.

## Обязательные правила

Соблюдать:

- `AGENTS.md`;
- `docs/architecture/target-architecture.md`;
- `docs/architecture/migration-plan.md`;
- `docs/architecture/current-state.md`;
- `docs/architecture/spa-boot.md`;
- `docs/contracts/card-lifecycle.md`;
- `docs/contracts/production-dashboard.md`;
- `docs/contracts/stage9-production-sources.md`.

Если меняется bootstrap/router — обязательно обновить `docs/architecture/spa-boot.md`.

## Scope

Только Stage 10 derived routes:

- `/workorders`;
- `/workorders/:qr`;
- `/archive`;
- `/archive/:qr`;
- `/items`;
- `/ok`;
- `/oc`.

## Что нужно сделать

### 1. Проверить URL-first поведение

Для каждого route подтвердить:

- direct URL open показывает именно этот route;
- F5 показывает именно этот route;
- URL не заменяется на `/dashboard`;
- loader показывается только до `restoreSession()` / `checkAuth()`;
- route render не происходит до завершения session bootstrap.

Если найдено нарушение — исправить в рамках существующего router/bootstrap pipeline.

### 2. Проверить Back / Forward

Подтвердить, что:

- `popstate` вызывает `handleRoute(fullPath, { fromHistory: true, ... })`;
- переход list -> detail -> back не требует F5;
- filters/list state не ломают route render;
- detail route после back не показывает stale detail от предыдущей карточки.

### 3. Проверить command feedback

Для всех action-capable places Stage 10 проверить:

- success показывается только после успешного server response;
- rejected/stale command не применяет optimistic local mutation как final state;
- после conflict пользователь видит понятное сообщение;
- после refresh UI показывает server truth.

Минимальные action checks:

- `/workorders/:qr` executor/additional executor/qty/comment/status-related controls, если они доступны;
- `/archive/:qr` repeat;
- любые другие кнопки на in-scope routes, которые реально меняют данные.

### 4. Укрепить тесты

Добавить или обновить tests для:

- route direct open/F5 behavior;
- list/detail navigation;
- Back / Forward;
- stale workorder action;
- stale archive repeat;
- отсутствие `/api/data` writes из Stage 10 route actions.

Если автоматизация какого-то manual-only case сейчас невозможна, зафиксировать это явно в финальном отчёте с причиной.

## Acceptance criteria

Batch считается выполненным, если:

- все Stage 10 routes URL-first;
- direct/F5/back/forward работают без редиректа на dashboard;
- stale command не меняет данные молча;
- action UI отражает server result, а не локальную догадку;
- нет новых `/api/data` writes;
- не начат Stage 13 cleanup;
- не затронуты unrelated domains.

## Versioning

Если изменены файлы сайта — выполнить:

```bash
npm run version:bump -- --change "Усилена проверка перехода производственных страниц на новые источники"
```

После bump проверить:

- запись в `docs/version-log.html`;
- локальная backup-ветка создана;
- локальный backup commit создан;
- push НЕ выполнялся.

Если изменены только документы — version bump не нужен.
