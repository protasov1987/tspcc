# Stage 10 Batch 8 — Final Derived Views Proof And Residual Cleanup

## Роль
Ты — Codex Agent в репозитории `tspcc.ru`.

## Контекст
Stage 10 не является общим cleanup `/api/data`.

Его задача — довести derived production views до source-domain чтения и команд:

- `/workorders`;
- `/workorders/:qr`;
- `/archive`;
- `/archive/:qr`;
- `/items`;
- `/ok`;
- `/oc`.

Аудит показал, что старые prompts могли слишком рано уводить работу в generic foundation или Stage 13 cleanup. Этот batch должен закрыть только остаточные Stage 10 риски.

## Цель batch

Сделать финальную техническую зачистку Stage 10 routes:

- найти и убрать остаточные legacy assumptions, которые появились как временные fallback в Batch 2-7;
- доказать, что derived routes не пишут через legacy snapshot;
- привести route diagnostics/tests к состоянию, достаточному для финальной приемки Batch 9.

## Важно

Нельзя:

- удалять `/api/data` из всего приложения;
- объявлять Stage 13 выполненным;
- переписывать unrelated pages;
- трогать receipts domain;
- трогать messaging/profile;
- делать publish/deploy.

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

## Что нужно сделать

### 1. Residual legacy audit

Повторно проверить in-scope routes на:

- `saveData(`;
- `/api/data`;
- direct mutation global `cards` as final write;
- direct mutation `productionShiftTasks` / `productionShiftTimes` as final write;
- fallback from `initialSnapshot`, который используется как authoritative source;
- page-specific hidden fetch/write helpers.

Результат должен быть:

- либо исправленный код;
- либо явное объяснение, почему найденный участок out-of-scope и не достижим из Stage 10 routes.

### 2. Derived views consistency

Проверить, что views строятся консистентно:

- `/workorders` availability/status filters используют достаточный source scope;
- `/archive` и `/archive/:qr` показывают archived state из cards-core/card flow truth;
- `/items`, `/ok`, `/oc` одинаково трактуют `flow.items`, `flow.samples`, `flow.archivedItems`;
- archived/repeated cards не появляются в неправильных списках после refresh.

### 3. Final stale-state proof

Воспроизвести или автоматизировать stale cases:

- два клиента открыли один `/workorders/:qr`, первый меняет состояние, второй пытается выполнить устаревшее действие;
- два клиента открыли один `/archive/:qr`, первый repeat, второй repeat со старой ревизией;
- stale detail после browser Back не показывает устаревший success;
- refresh после conflict приводит UI к server truth.

### 4. Diagnostics

Если Stage 10 fixes затрагивали route/bootstrap/refresh behavior, убедиться, что логи помогают понять зависание:

- `[BOOT] ...`;
- `[ROUTE] ...`;
- route name / full path;
- source reload step;
- rejected command reason where available.

Не добавлять шумные логи в циклах render.

### 5. Documentation only when necessary

Документы обновлять только если кодовое поведение реально изменилось или обнаружен важный architectural fact.

Если обновляются архитектурные документы, не смешивать это с выдуманным Stage 13 статусом.

## Acceptance criteria

Batch считается выполненным, если:

- residual legacy write bypass на Stage 10 routes отсутствует;
- все временные fallback либо удалены, либо явно ограничены read-only compatibility;
- stale-state behavior доказан для workorders и archive repeat;
- diagnostics сохранены или улучшены;
- Stage 10 routes готовы к финальному acceptance audit;
- Stage 13 cleanup не начат.

## Versioning

Если изменены файлы сайта — выполнить:

```bash
npm run version:bump -- --change "Завершена техническая проверка производственных представлений"
```

После bump проверить:

- запись в `docs/version-log.html`;
- локальная backup-ветка создана;
- локальный backup commit создан;
- push НЕ выполнялся.

Если изменены только документы — version bump не нужен.
