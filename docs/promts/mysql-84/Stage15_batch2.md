# MySQL 8.4 Stage 15 Batch 2

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
- Это MySQL 8.4 Stage 15: Post-Cutover Hardening and 20-User Proof.
- Можно выполнять только measured hardening and cleanup.
- Нельзя добавлять optimization без bottleneck.
- Hardening/cleanup must include Stage 6 directories/security metrics and
  compatibility cleanup candidates, but must not weaken permissions, `Abyss`,
  password rules, landingTab or profile privacy.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 15 Batch 2: measured hardening, compatibility cleanup and
20-user proof.

Что сделать:
1. Run full E2E after cutover.
2. Run 20-user representative scenario.
   Scenario must include directory/security edits with permission checks.
3. Review slow query logs and `[PERF][DB]`.
4. Review pool metrics and deadlocks/lock waits.
5. Tune indexes only from measured query patterns.
6. Remove read-only compatibility adapters whose criteria are met.
7. Confirm backup schedule and post-cutover restore rehearsal.
8. Confirm credential rotation procedure.
9. Confirm no schema drift outside migrations.
10. Update current-state/architecture docs if implementation decisions changed
    documented persistence shape.

Что нельзя делать:
- не mask SQL problem with client cache;
- не leave writable compatibility adapter;
- не accept untested restore.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. E2E result.
2. 20-user scenario result.
3. SQL/pool/perf findings.
4. Cleanup done.
5. Backup/restore proof.
6. Remaining risks.
```

## Ручная проверка после Prompt

Проверить normal work by representative users and review monitoring dashboard/logs.
