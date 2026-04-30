# MySQL 8.4 Stage 12 Batch 3

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
- Это финальная acceptance-проверка MySQL Stage 12.
- Нельзя исправлять blockers в этом batch.
- Нельзя начинать production rehearsal.
- Acceptance должна include explicit proof for Stage 6 directories/security
  slices: no JSON write authority remains for directories/security, and
  route-critical reads no longer require full snapshot payload.
```

## Промт

```text
Нужно выполнить Stage 12 Batch 3: приемку Remove JSON Snapshot Authority.

Проверь exit criteria:
- MySQL is only source of truth for in-scope data;
- `database.json` is not authoritative;
- `/api/data` is removed or explicitly non-authoritative diagnostic/export;
- client no longer depends on full snapshot payload.

Проверь failure conditions:
- no critical write can persist through JSON snapshot;
- JSON and MySQL do not both accept authoritative writes;
- fixture/test setup does not hide SQL migration failures.
- `/api/data` or `database.json` can still overwrite `ops`, `centers`,
  `areas`, `productionShiftTimes`, `users`, `accessLevels`.

Формат ответа:
1. Stage 12 PASS/FAIL/BLOCKED.
2. JSON authority proof.
3. Snapshot API proof.
4. Stage 6 slice removal/read-only proof.
5. Tests/checks run.
6. Можно ли начинать Stage 13 rehearsal.
```

## Ручная проверка после Prompt

Проверить основные домены после удаления JSON authority.
