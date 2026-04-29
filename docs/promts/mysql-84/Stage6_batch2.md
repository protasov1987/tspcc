# MySQL 8.4 Stage 6 Batch 2

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
- Это MySQL 8.4 Stage 6: Directories and Security SQL Cutover.
- Можно менять только directories/security SQL cutover scope.
- Нельзя начинать production planning/execution cutover.
- Нельзя ослаблять security.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 6 Batch 2: реализовать directories/security SQL source of
truth.

Что сделать:
1. Implement directories repository.
2. Implement security repository.
3. Move directory/security commands to SQL transactions.
4. Preserve guards:
   department delete, operation type, area delete, historical text,
   production dependencies.
5. Preserve users/access levels permissions.
6. Preserve `Abyss`, password hash compatibility, validation/uniqueness.
7. Preserve `landingTab`, inactivity timeout, profile access.
8. Ensure JSON/snapshot cannot overwrite migrated slices.

Что нельзя делать:
- не use snapshot-save for directories/security;
- не grant runtime schema privileges;
- не change route permissions semantics.

Проверки:
- directory guards;
- users/access levels CRUD;
- stale conflicts;
- `/users`, `/accessLevels`, `/profile/:id` direct URL/F5;
- `Abyss` and password tests.

Формат ответа:
1. SQL repositories/commands implemented.
2. Guards preserved.
3. Security semantics preserved.
4. Tests/checks run.
5. Remaining compatibility.
```

## Ручная проверка после Prompt

Проверить справочники, `/users`, `/accessLevels`, landing tab и profile route.
