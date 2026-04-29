# MySQL 8.4 Stage 1 Batch 1

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
- Это MySQL 8.4 Stage 1: MySQL Platform and Operations Baseline.
- Batch 1 является audit/design-only.
- Нельзя менять production/VDS.
- Нельзя выполнять domain cutover.
- Нельзя коммитить пароли или secrets.
- Нельзя менять site behavior.
```

## Промт

```text
Нужно выполнить Stage 1 Batch 1: audit/design MySQL platform baseline.

Цель:
- определить, что нужно для локальной/test/staging MySQL 8.4 platform setup;
- спроектировать env/secret contract, users/grants, backup/restore и 20-user
  pool baseline без изменения behavior.

Что проверить:
1. package.json dependencies and current Node runtime.
2. Current config/env patterns.
3. .gitignore secret coverage.
4. Existing deploy/VDS assumptions.
5. Existing file storage layout and backup implications.
6. Where operational scripts should live.
7. What commands will require user approval/network access later.

Что подготовить в ответе:
- concrete implementation batches for Stage 1;
- proposed DB users/grants;
- proposed env variables;
- backup/restore approach;
- RPO/RTO proposal;
- connection pool baseline for 20 users.

Что нельзя делать:
- не устанавливать MySQL;
- не добавлять npm dependencies;
- не создавать scripts;
- не менять docs unless user explicitly asks in follow-up.

Формат ответа:
1. Platform readiness findings.
2. Required local/test prerequisites.
3. Secrets/grants design.
4. Backup/restore design.
5. Recommended Stage 1 implementation batch order.
```

## Ручная проверка после Prompt

Не нужна.
