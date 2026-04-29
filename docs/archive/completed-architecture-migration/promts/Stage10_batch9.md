# Stage 10 Batch 9 — Final Acceptance Audit For Derived Production Views

## Роль
Ты — Codex Agent в репозитории `tspcc.ru`.

## Контекст
Это финальный acceptance batch Stage 10.

Он НЕ предназначен для новых больших исправлений. Его задача — проверить, что Stage 10 действительно завершён в пределах своего scope, и зафиксировать оставшиеся blockers, если они есть.

Stage 10 scope:

- `/workorders`;
- `/workorders/:qr`;
- `/archive`;
- `/archive/:qr`;
- `/items`;
- `/ok`;
- `/oc`.

Out of scope:

- receipts domain;
- messaging/profile;
- global `/api/data` removal;
- deploy/publish;
- Stage 13 cleanup.

## Цель batch

Провести финальный аудит Stage 10 и дать честный результат:

- PASS, если критерии Stage 10 выполнены;
- FAIL/BLOCKED, если найден route/action, который всё ещё зависит от legacy write path или неполного source scope.

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

## Что нужно проверить

### 1. Route source table

Составить итоговую таблицу:

| Route | Read source | Write/command source | Legacy fallback | Status |
| --- | --- | --- | --- | --- |

В таблицу включить все Stage 10 routes.

Для каждого route указать:

- откуда берутся данные;
- есть ли действия записи;
- есть ли read-only compatibility fallback;
- есть ли blocking legacy dependency.

### 2. No bypass writes proof

Проверить:

- `saveData(`;
- `/api/data`;
- direct mutation `cards`;
- direct mutation production planning globals;
- inline event handlers on in-scope pages.

Итог должен явно ответить:

- есть ли достижимые Stage 10 write bypass;
- если есть — какой route/action и почему это blocker;
- если нет — чем это подтверждено.

### 3. Route behavior checklist

Проверить:

- F5 `/workorders`;
- F5 `/workorders/<qr>`;
- F5 `/archive`;
- F5 `/archive/<qr>`;
- F5 `/items`;
- F5 `/ok`;
- F5 `/oc`;
- direct open для тех же routes;
- Back / Forward list/detail;
- no boot redirect to `/dashboard`;
- `popstate` route path.

### 4. Multi-client/stale checklist

Проверить:

- stale workorder action rejected or refreshed safely;
- stale archive repeat rejected or refreshed safely;
- UI не показывает ложный success;
- refresh после conflict приводит к server truth.

### 5. Test run

Запустить релевантные tests:

- unit/integration tests, если есть;
- Playwright/e2e tests, если они покрывают Stage 10;
- manual verification list, если автоматических tests недостаточно.

Если тест нельзя запустить из-за окружения — указать точную причину.

## Разрешённые изменения

По умолчанию этот batch — audit-only.

Разрешены только:

- мелкие правки документации acceptance report, если в проекте есть место для таких отчетов;
- минимальные test expectation updates, если они очевидно исправляют сам тест после уже сделанного cutover.

Если найден реальный code blocker:

- не делать большой fix внутри Batch 9;
- зафиксировать blocker;
- предложить отдельный follow-up batch с точным scope.

## Acceptance criteria

Batch считается выполненным, если финальный ответ содержит:

- PASS/FAIL/BLOCKED по Stage 10;
- route source table;
- список проверенных write bypass patterns;
- результаты route/F5/back-forward проверок;
- результаты stale/multi-client проверок;
- список запущенных tests;
- список residual risks, если они есть.

## Versioning

Если batch остался audit-only и менялись только документы или вообще ничего не менялось — version bump не нужен.

Если вопреки ожиданию были изменены файлы сайта, выполнить:

```bash
npm run version:bump -- --change "Проверена готовность производственных представлений"
```

После bump проверить:

- запись в `docs/version-log.html`;
- локальная backup-ветка создана;
- локальный backup commit создан;
- push НЕ выполнялся.
