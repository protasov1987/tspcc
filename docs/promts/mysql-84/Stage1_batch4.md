# MySQL 8.4 Stage 1 Batch 4

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
- Это финальная acceptance-проверка MySQL Stage 1.
- Нельзя исправлять найденные blockers в этом batch.
- Нельзя начинать Stage 2.
- Нельзя менять production/VDS.
```

## Промт

```text
Нужно выполнить Stage 1 Batch 4: финальную приемку MySQL Platform and
Operations Baseline.

Проверь exit criteria:
- MySQL 8.4 reachable in local/test environment или documented blocker;
- runtime user cannot CREATE/ALTER/DROP;
- migration user can apply migrations;
- secrets are not committed;
- backup and restore rehearsal commands/procedure documented;
- no application domain reads/writes use MySQL as source of truth yet.

Проверь failure conditions:
- runtime app does not require root/admin credentials;
- no password committed;
- backup covers SQL and files;
- restore procedure is testable.

Что нельзя делать:
- не исправлять по ходу;
- не менять docs/code;
- не делать version bump.

Формат ответа:
1. Stage 1 PASS/FAIL/BLOCKED.
2. Таблица exit criteria.
3. Таблица failure conditions.
4. Какие commands/tests подтверждают результат.
5. Можно ли начинать Stage 2.
```

## Ручная проверка после Prompt

Проверить grants и restore rehearsal только в local/test окружении.
