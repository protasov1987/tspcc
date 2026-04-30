# MySQL 8.4 Stage 8 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 8.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 9.
- Acceptance должна подтвердить, что Stage 8 не откатил Stage 6/7:
  execution/workspace reads and commands не используют directories/security
  или planning JSON slices как authoritative fallback.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 3: приемку Production Execution and Workspace SQL
Cutover.

Проверь exit criteria:
- production execution source of truth is SQL;
- flow version is SQL-enforced;
- flow history is preserved;
- workspace conflict behavior unchanged;
- realtime is not required for correctness.

Проверь failure conditions:
- flow state does not have two authoritative models;
- execution writes do not update projection without authoritative transaction;
- no critical execution action bypasses SQL domain command.
- execution/workspace reintroduced JSON/snapshot authority for operations,
  areas, users, shift times or planning state.

Формат ответа:
1. Stage 8 PASS/FAIL/BLOCKED.
2. Execution source proof.
3. Flow version/conflict proof.
4. Stage 6/7 dependency preservation proof.
5. Tests/checks run.
6. Можно ли начинать Stage 9.
```

## Ручная проверка после Prompt

Проверить workspace, delayed/defects where safe, route stability and conflict.
