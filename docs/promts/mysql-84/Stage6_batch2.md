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
- Учитывай итоги Stage 6 Batch 1 audit/design:
  - текущие domain endpoints уже есть, но фактические commands всё ещё
    работают через `JsonDatabase.update(...)`;
  - SQL schema/import mapping уже существует:
    `centers[] -> work_centers`, `ops[] -> operations`,
    `areas[] -> production_areas`,
    `productionShiftTimes[] -> production_shift_times`,
    `users[] -> users`,
    `accessLevels[] -> access_levels` / `access_level_permissions`;
  - текущие JSON directory handlers проверяют `expectedRev`, но часть мутаций
    departments/operations/areas и operation-area bindings не инкрементит
    entity `rev`; SQL cutover обязан закрыть этот gap через настоящий
    compare-and-increment;
  - historical text preservation должен быть application guard: не делать
    cascade rewrite исторического текста карточек при rename справочников;
  - `user_sessions` может оставаться неиспользованной target-таблицей, если
    runtime sessions остаются in-memory без изменения текущей auth semantics.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 6 Batch 2: реализовать directories/security SQL source of
truth.

Что сделать:
1. Implement directories repository.
   - Repository должен владеть SQL reads/writes для:
     departments/work_centers, operations, operation allowed areas, areas,
     employees department assignment, shift times.
   - Route handlers могут выполнять auth/permission/request-response
     orchestration, но business SQL commands не должны быть разбросаны по
     `server.js`.
2. Implement security repository.
   - Repository должен владеть SQL reads/writes для users, access levels,
     permissions и user-owned settings, если они остаются в Stage 6 scope.
   - Не логировать и не возвращать password hash/salt/token values.
3. Move directory/security commands to SQL transactions.
   - Все competitive mutable entities должны сравнивать `expectedRev` с SQL
     `rev` внутри transaction.
   - Успешная мутация должна инкрементить ровно relevant entity/aggregate
     `rev`; не использовать global `meta.revision`.
   - Stale state должен возвращать существующий `409` envelope.
4. Preserve guards:
   department delete, operation type, area delete, historical text,
   production dependencies.
5. Preserve users/access levels permissions.
6. Preserve `Abyss`, password hash compatibility, validation/uniqueness.
7. Preserve `landingTab`, inactivity timeout, profile access.
8. Ensure JSON/snapshot cannot overwrite migrated slices.
9. Переключить route-critical reads для `/departments`, `/operations`,
   `/areas`, `/employees`, `/shift-times`, `/users`, `/accessLevels` и
   `/profile/:id` на SQL-backed source без изменения payload shape,
   необходимого текущему клиенту.
10. Сохранить compatibility shape для scoped `/api/data` reads только как
    read/export bridge; POST `/api/data` не должен перезаписывать SQL-owned
    directories/security slices.

Что нельзя делать:
- не use snapshot-save for directories/security;
- не grant runtime schema privileges;
- не change route permissions semantics.
- не переносить production planning/execution вместе со Stage 6;
- не исправлять historical text через массовый cascade rewrite карточек;
- не менять cookie/CSRF/session semantics без отдельного явного решения.

Проверки:
- directory guards;
- users/access levels CRUD;
- stale conflicts;
- `/users`, `/accessLevels`, `/profile/:id` direct URL/F5;
- `Abyss` and password tests.
- no directory/security critical write through `JsonDatabase.update(...)`,
  `saveData()` or POST `/api/data`;
- repository boundary audit: SQL business commands live in repositories;
- rev audit: departments, operations, operation-area bindings, areas,
  employees, shift times, users and access levels increment relevant `rev`;
- `/api/data` POST cannot overwrite `ops`, `centers`, `areas`,
  `productionShiftTimes`, `users`, `accessLevels`;
- auth/login still works with existing password hash compatibility;
- landingTab/inactivity timeout propagation still works after SQL read.

Формат ответа:
1. SQL repositories/commands implemented.
2. Guards preserved.
3. Security semantics preserved.
4. Tests/checks run.
5. Rev/conflict proof.
6. Remaining compatibility.
```

## Ручная проверка после Prompt

Проверить справочники, `/users`, `/accessLevels`, landing tab и profile route.
