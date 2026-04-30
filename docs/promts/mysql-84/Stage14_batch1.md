# MySQL 8.4 Stage 14 Batch 1

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
- Это MySQL 8.4 Stage 14: Production Cutover.
- Batch 1 является final pre-cutover readiness check.
- Нельзя начинать cutover без явного подтверждения пользователя.
- Нельзя менять production.
- Readiness check должен explicitly include Stage 6 acceptance artifacts:
  directories/security SQL source of truth, repository boundary, rev conflicts,
  `/api/data` overwrite protection, `Abyss`/password/landing/profile checks.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 1: final readiness check перед production
cutover.

Проверь:
1. Stage 13 PASS.
2. Current backups available.
3. Cutover runbook complete.
4. Rollback runbook complete.
5. Maintenance/quiesce plan ready.
6. Smoke checklist ready.
7. Monitoring checklist ready.
8. Owner/decision points clear.
9. No unresolved Stage 6 directories/security blockers remain.

Что нельзя делать:
- не выполнять production commands;
- не менять configs;
- не touch VDS files/data.

Формат ответа:
1. Ready/Not ready.
2. Checklist status.
3. Missing approvals/blockers.
4. Exact cutover command sequence to run only after explicit approval.
```

## Ручная проверка после Prompt

Пользователь должен явно подтвердить readiness before production cutover.
