# MySQL 8.4 Stage 0 Batch 3

## Общий префикс

```text
Работай строго по:
- AGENTS.md
- docs/architecture/current-architecture.md
- docs/architecture/current-state.md
- docs/architecture/change-checklist.md
- docs/architecture/mysql-84-target-architecture.md
- docs/architecture/mysql-84-migration-plan.md
- docs/business-rules/*.md

Важно:
- Это финальная acceptance-проверка MySQL Stage 0.
- Нельзя менять код приложения, БД, storage или VDS.
- Если найдены blockers, не исправляй их в этом batch; перечисли и предложи
  следующий минимальный docs/inventory batch.
- Version bump не нужен.
```

## Промт

```text
Нужно выполнить Stage 0 Batch 3: финальную приемку SQL Readiness Inventory.

Проверь exit criteria из mysql-84-migration-plan.md Stage 0:
- inventory report exists;
- `JSON field -> SQL table/domain` mapping exists;
- file metadata reconciliation baseline exists;
- broken reference report exists;
- duplicate/anomaly report exists;
- business invariant list for importer validation exists;
- no implementation cutover is started.

Проверь failure conditions:
- нет top-level JSON field без owner;
- files inventoried;
- production flow references mapped;
- messaging/profile compatibility fields classified.

Что нельзя делать:
- не исправлять найденные blockers по ходу;
- не начинать Stage 1;
- не делать implementation.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 0 PASS/FAIL/BLOCKED.
2. Таблица exit criteria.
3. Таблица failure conditions.
4. Blockers, если есть.
5. Можно ли начинать Stage 1.
```

## Ручная проверка после Prompt

Не нужна. Это документационная приемка inventory.
