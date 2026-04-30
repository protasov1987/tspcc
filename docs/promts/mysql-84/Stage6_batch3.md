# MySQL 8.4 Stage 6 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 6.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать Stage 7.
- Acceptance должна явно проверить, что Stage 6 Batch 2 закрыл audit gaps из
  Batch 1:
  - directories/security commands больше не являются `JsonDatabase.update(...)`
    write-authority;
  - `DirectoriesRepository` и `SecurityRepository` являются SQL boundary для
    business commands;
  - departments/operations/operation-area bindings/areas/employees/shift times,
    users/access levels имеют рабочий SQL `rev` compare-and-increment;
  - scoped `/api/data` остается только compatibility read/export bridge и не
    может overwrite SQL-owned directories/security slices;
  - historical text preservation сохранен без cascade rewrite карточек;
  - auth/session behavior не изменен случайно.
```

## Промт

```text
Нужно выполнить Stage 6 Batch 3: приемку Directories and Security SQL Cutover.

Проверь exit criteria:
- directories/security source of truth is SQL;
- JSON/snapshot cannot overwrite migrated directories/security slices;
- permissions and route visibility remain unchanged;
- business guards pass from SQL state.
- route-critical reads для `/departments`, `/operations`, `/areas`,
  `/employees`, `/shift-times`, `/users`, `/accessLevels`, `/profile/:id`
  получают данные из SQL-backed source;
- response payload shape совместим с текущим клиентом;
- SQL `rev` инкрементится после успешных mutations и stale `expectedRev`
  возвращает существующий `409` envelope;
- password hash/salt compatibility, validation and uniqueness preserved;
- `landingTab` and `inactivityTimeoutMinutes` сохранены и применяются;
- runtime DB user не требует schema privileges.

Проверь failure conditions:
- no directory/security critical write uses snapshot-save;
- `Abyss` cannot be deleted/degraded;
- historical card text is not lost by directory mutation.
- any directory/security command still persists through `JsonDatabase.update`,
  `saveData()` or POST `/api/data`;
- `server.js` contains raw SQL business commands instead of repository-owned
  directory/security commands;
- departments/operations/areas mutation accepts stale `expectedRev` because
  `rev` was not incremented;
- `/api/data` POST can overwrite `ops`, `centers`, `areas`,
  `productionShiftTimes`, `users`, `accessLevels`;
- login breaks because SQL password hash/salt encoding differs from current
  PBKDF2 hex semantics;
- profile ownership or route permissions are weakened.

Обязательные проверки:
- SQL integration or equivalent API checks for departments, operations,
  operation-area bindings, areas, employee assignments and shift times:
  success and stale `expectedRev -> 409`;
- security checks for users/access levels: create, edit, delete, stale
  conflict, access-level-in-use guard;
- `Abyss` protection: no create duplicate, no rename, no downgrade, no
  deactivate, no delete;
- password validation and uniqueness;
- landing tab and inactivity timeout propagation;
- direct URL/F5 on `/users`, `/accessLevels`, `/profile/:id` and at least one
  directory route;
- `/api/data` compatibility overwrite protection for directories/security.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 6 PASS/FAIL/BLOCKED.
2. Directories proof.
3. Security proof.
4. Repository/rev/conflict proof.
5. `/api/data` compatibility proof.
6. Tests/checks run.
7. Можно ли начинать Stage 7.
```

## Ручная проверка после Prompt

Проверить справочники, users/access levels, права вкладок и profile privacy.
