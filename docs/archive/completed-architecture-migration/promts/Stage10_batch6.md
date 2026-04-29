# Stage 10 Batch 6 — Consolidate Derived Read Sources After Route Cutover

## Роль
Ты — Codex Agent в репозитории `tspcc.ru`.

## Контекст
Stage 10 переводит производные view-страницы с legacy `data.json` / `/api/data` на source-of-truth домены.

К этому batch должны быть выполнены:

- `Stage10_batch2` — `/workorders` и `/workorders/:qr`;
- `Stage10_batch3` — route-safe и multi-client proof для workorders;
- `Stage10_batch4` — `/archive` и `/archive/:qr`;
- `Stage10_batch5` — `/items`, `/ok`, `/oc`.

Аудит Stage 10 показал:

- фактическая реализация in-scope страниц находится в основном в `js/app.73.receipts.js`, а не в `js/app.75.production.js`;
- `/workorders` исторически читал не только `cards`, но и `productionShiftTasks` / `productionShiftTimes`;
- `/archive`, `/items`, `/ok`, `/oc` являются derived views поверх cards/flow;
- в Stage 10 нельзя начинать финальный cleanup `/api/data` — это Stage 13;
- receipts domain не относится к Stage 10 и не должен меняться.

## Цель batch

Свести уже переведенные Stage 10 routes к единой, проверяемой модели derived reads:

- route-specific view code больше не должен иметь скрытых legacy-допущений о глобальном снимке;
- каждый in-scope route должен явно получать данные из нужного source-domain contract;
- переходные fallback-ветки должны быть минимальны, объяснимы и не создавать новые write bypass;
- residual `saveData()` на Stage 10 derived routes должен быть удален либо доказан как out-of-scope.

## Важно

Этот batch НЕ является финальным Stage 13 cleanup.

Нельзя:

- удалять `/api/data` глобально;
- переписывать все legacy routes;
- трогать receipts domain;
- начинать messaging/profile;
- добавлять новые `/api/workorders/*`, `/api/archive/*`, `/api/items/*`;
- менять business semantics действий, уже закрепленных в Stage 9.

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

## Обязательный scope

Проверить и при необходимости поправить:

- `/workorders`;
- `/workorders/:qr`;
- `/archive`;
- `/archive/:qr`;
- `/items`;
- `/ok`;
- `/oc`.

Проверять фактические файлы реализации, начиная с:

- `js/app.73.receipts.js`;
- `js/app.76.components.js`;
- `js/app.77.router.js`;
- `js/app.78.navigation.js`;
- серверные source-domain modules/routes, которые уже используются этими страницами.

## Что нужно сделать

### 1. Зафиксировать source contract для каждого route

Для каждого in-scope route явно определить, из какого source-domain состояния он строится:

- `/workorders`:
  - cards/basic identity/status;
  - production planning data для availability/shift-derived filters;
  - no raw `/api/data` write.

- `/workorders/:qr`:
  - selected card/flow;
  - production execution state через Stage 9 commands;
  - no direct `saveData()` mutation.

- `/archive` и `/archive/:qr`:
  - archived cards/flow state;
  - repeat через cards-core repeat command;
  - no local resurrection from stale snapshot.

- `/items`, `/ok`, `/oc`:
  - card flow/items/samples/archivedItems;
  - metadata fallback only as compatibility read fallback, not as source of new truth;
  - no write path.

### 2. Убрать остаточные bypass writes на derived routes

Найти все вызовы `saveData()` и legacy write helpers, достижимые из in-scope pages.

Для каждого:

- если это Stage 10 route action — заменить на source-domain command;
- если это Stage 9 execution action — убедиться, что используется Stage 9 command с актуальной версионной защитой;
- если это другой домен — оставить без изменений и явно не расширять.

Особенно проверить workorders detail controls:

- executor;
- additional executor;
- qty;
- operation comments;
- any inline status mutation.

### 3. Централизовать derived route refresh

После успешной command-операции Stage 10 route должен обновлять UI через source-domain refresh/reload, а не локально мутировать устаревший snapshot.

Проверить:

- route остаётся на текущем URL;
- detail page не падает на stale card;
- list filters сохраняются, если это уже существующее поведение;
- конфликт версии показывает понятную ошибку и предлагает обновить данные.

### 4. Не усиливать legacy globals

Допустимо временно читать существующие глобальные структуры, если они уже являются hydration target текущего приложения.

Недопустимо:

- добавлять новые глобальные mirrors;
- расширять `data.json` как источник правды;
- строить новые derived caches без понятной invalidation;
- добавлять новые page-specific fetches в обход уже существующих source-domain APIs.

## Минимальные проверки

Обязательно выполнить:

- поиск `saveData(` по repo и классификация найденных вызовов;
- поиск `/api/data` в коде in-scope pages;
- проверка, что Stage 10 routes не добавили новые legacy endpoints;
- route smoke:
  - F5 `/workorders`;
  - F5 `/workorders/<qr>`;
  - F5 `/archive`;
  - F5 `/archive/<qr>`;
  - F5 `/items`;
  - F5 `/ok`;
  - F5 `/oc`;
  - Back / Forward между списком и detail.

Если есть Playwright/e2e coverage — расширить её точечно.

## Acceptance criteria

Batch считается выполненным, если:

- каждый Stage 10 route имеет понятный source-domain read path;
- `/workorders` больше не зависит от неполного `cards-basic` scope там, где нужен planning-derived state;
- Stage 10 route actions не пишут через `saveData()`;
- archive repeat остаётся cards-core command;
- items/ok/oc остаются read-only derived views;
- не затронуты receipts, messaging/profile и Stage 13 cleanup;
- тесты или ручные проверки подтверждают route-safe behavior.

## Versioning

Если изменены файлы сайта — выполнить:

```bash
npm run version:bump -- --change "Уточнены источники данных производственных страниц"
```

После bump проверить:

- запись в `docs/version-log.html`;
- локальная backup-ветка создана;
- локальный backup commit создан;
- push НЕ выполнялся.

Если изменены только документы — version bump не нужен.
