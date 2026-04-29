# MySQL 8.4 Stage 5 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 5.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 6.
```

## Промт

```text
Нужно выполнить Stage 5 Batch 3: приемку Cards, Approval and Card Files SQL
Cutover.

Проверь exit criteria:
- cards and card files source of truth is SQL;
- JSON/snapshot cannot overwrite cards;
- attachments metadata is SQL-backed;
- physical files reconcile with SQL metadata;
- all card critical writes return controlled result or `409`;
- `/api/data` no longer owns cards.

Проверь failure conditions:
- no card critical write uses snapshot-save;
- card file metadata cannot diverge silently from SQL;
- conflict does not redirect to dashboard or lose route.

Формат ответа:
1. Stage 5 PASS/FAIL/BLOCKED.
2. Cards write/read proof.
3. File reconciliation proof.
4. Tests/checks run.
5. Можно ли начинать Stage 6.
```

## Ручная проверка после Prompt

Проверить cards list/detail/edit, approval/input/provision, file upload/delete,
F5 и two-tab conflict.
