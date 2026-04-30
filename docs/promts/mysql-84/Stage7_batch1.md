# MySQL 8.4 Stage 7 Batch 1

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
- Это MySQL 8.4 Stage 7: Production Planning SQL Cutover.
- Batch 1 является audit/design.
- Нельзя менять code в этом batch.
- Нельзя начинать execution/workspace cutover.
- Начинать Stage 7 audit/design можно только после Stage 6 Batch 3
  PASS или с явным BLOCKED-выводом, если directories/security SQL cutover не
  принят.
- Если Stage 6 не PASS, не проектируй compensating snapshot fallback для
  справочников/security; зафиксируй blocker для planning cutover.
```

## Промт

```text
Нужно выполнить Stage 7 Batch 1: audit/design production planning SQL cutover.

Проверь:
1. production schedule, plan, shifts, shift tasks, gantt read paths.
2. planning commands and validations.
3. planning revision source.
4. relationship to directories/security SQL state.
   - operations, allowed areas, work centers, users/access levels and shift
     times должны читаться как SQL-owned dependencies после Stage 6.
   - planning не должен возвращать authority к JSON `ops`, `centers`, `areas`,
     `users`, `accessLevels` или `productionShiftTimes`.
5. route-local refresh and conflict handling.
6. snapshot compatibility.
7. tests needed for planning SQL cutover.

Что нельзя делать:
- не менять code/docs;
- не переносить workspace/execution;
- не менять planning business rules.

Формат ответа:
1. Planning SQL cutover map.
2. Planning revision model proposal.
3. Read/write route map.
4. Risks/blockers.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
