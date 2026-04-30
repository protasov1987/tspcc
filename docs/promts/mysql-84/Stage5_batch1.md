# MySQL 8.4 Stage 5 Batch 1

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
- Это MySQL 8.4 Stage 5: Cards, Approval and Card Files SQL Cutover.
- Batch 1 является cutover audit/design.
- Нельзя менять код в этом batch.
- Нельзя выполнять cutover.
- Нельзя менять business semantics карточек.
- Начинать только после Stage 4 PASS.
- Cutover design должен использовать Stage 2 SQL foundation, Stage 3 schema/
  migration runner и Stage 4 reconciliation results.
- Нельзя проектировать raw SQL directly in `server.js`; cards/files SQL access
  должен идти через repository boundary.
- Учитывай Stage 3 schema decisions: card flow fields are projection only;
  `initialSnapshot` is archive/read-only compatibility; card descriptive JSON,
  if present, is explicitly owned and not whole-card storage.
```

## Промт

```text
Нужно выполнить Stage 5 Batch 1: audit/design cards/lifecycle/files SQL cutover.

Проверь и опиши:
1. Current card domain commands and read paths.
2. Approval/input/provision commands and side effects.
3. Card files upload/delete/resync paths.
4. Card logs and approval thread persistence.
5. Where `card.rev` and `expectedRev` are enforced.
6. What JSON/snapshot compatibility remains.
7. How file metadata must map to SQL.
8. Required tests and safe cutover order.
9. Which Stage 4 reconciliation warnings block cards/files cutover.
10. Exact repository boundary for cards/lifecycle/files and how it preserves
    current `expectedRev -> 409` contract.
11. How JSON/snapshot compatibility becomes read-only or gets a documented
    removal path after cutover.
12. How cutover prevents card-facing flow projection from becoming a second
    authoritative production execution source.

Что нельзя делать:
- не менять code/docs;
- не добавлять repositories;
- не делать version bump;
- не начинать directories/security/production.
- не проектировать dual-write as migration strategy;
- не делать `/api/data` primary SQL API;
- не менять router/bootstrap or card route behavior.
- не write card flow projection outside authoritative production execution
  transaction.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Cards SQL cutover map.
2. File metadata cutover map.
3. Risks/blockers.
4. Repository/source-of-truth boundary.
5. Exact implementation order for Batch 2.
6. Tests needed for Batch 2/3.
```

## Ручная проверка после Prompt

Не нужна.
