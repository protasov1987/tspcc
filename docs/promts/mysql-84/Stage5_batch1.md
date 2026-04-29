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

Что нельзя делать:
- не менять code/docs;
- не добавлять repositories;
- не делать version bump;
- не начинать directories/security/production.

Формат ответа:
1. Cards SQL cutover map.
2. File metadata cutover map.
3. Risks/blockers.
4. Exact implementation order for Batch 2.
5. Tests needed for Batch 2/3.
```

## Ручная проверка после Prompt

Не нужна.
