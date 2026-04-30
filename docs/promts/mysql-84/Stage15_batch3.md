# MySQL 8.4 Stage 15 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 15 и всей MySQL migration.
- Нельзя исправлять blockers в этом batch.
- Нельзя объявлять migration complete при unresolved critical risk.
- Final acceptance must explicitly include Stage 6 directories/security:
  SQL source of truth, conflict/revision proof, permission/profile semantics,
  no JSON overwrite path, and representative load coverage.
```

## Промт

```text
Нужно выполнить Stage 15 Batch 3: финальную приемку MySQL 8.4 migration.

Проверь Global Exit Criteria из mysql-84-migration-plan.md:
- MySQL 8.4 InnoDB source of truth;
- least-privileged runtime DB user;
- env/secret credentials;
- versioned schema migrations;
- no boot schema mutation;
- critical writes are transactional domain commands;
- revisions/conflicts enforced;
- route stable after conflict;
- realtime over committed SQL only;
- `/api/data` and `database.json` not authoritative;
- files metadata and physical files reconciled;
- backup/restore covers SQL and files;
- restore rehearsal passed;
- 20-user representative scenario passed;
- business-rules preserved;
- current architecture preserved;
- no writable compatibility adapter;
- monitoring/diagnostics exist.
- directories/security business rules preserved under SQL:
  department/operation/area guards, users/access levels, `Abyss`, passwords,
  landingTab, inactivity timeout and profile privacy.

Проверь Definition Of Failure and confirm none apply.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. MySQL migration PASS/FAIL/BLOCKED.
2. Global exit criteria table.
3. Definition of failure table.
4. Tests/measurements proving acceptance.
5. Remaining non-blocking risks, if any.
```

## Ручная проверка после Prompt

Финальная ручная приемка: representative workflow, F5/direct URL, conflicts,
files, production, messaging, backup/restore evidence and 20-user proof.
