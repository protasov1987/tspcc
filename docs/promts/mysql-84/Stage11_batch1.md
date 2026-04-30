# MySQL 8.4 Stage 11 Batch 1

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
- Это MySQL 8.4 Stage 11: Realtime, Audit and Outbox Finalization.
- Batch 1 является audit/design.
- Нельзя менять code.
- Нельзя использовать realtime as correctness.
- Начинать Stage 11 audit/design можно только после acceptance всех domain SQL
  cutovers Stage 5-10, включая Stage 10 Batch 5 PASS. Если какой-то домен не
  PASS, outbox/audit не должен маскировать missing SQL source of truth.
- Если Stage 10 был остановлен на repository/runtime/compatibility batch без
  Batch 5 PASS, зафиксируй blocker и не начинай outbox/realtime finalization
  для messaging/profile/notifications.
```

## Промт

```text
Нужно выполнить Stage 11 Batch 1: audit/design outbox/audit/realtime over
committed SQL state.

Проверь:
1. Current live/SSE event paths.
2. Current audit/log/user_actions paths.
3. Which commands need post-commit events.
   Учитывай все accepted SQL domains, включая Stage 6 directories/security:
   directory/security live events должны идти только after commit and from SQL
   state.
   Учитывай Stage 10 only если Stage 10 Batch 5 PASS подтвердил SQL source of
   truth для messaging/profile/notifications.
4. Whether events can fire before commit.
5. Target outbox/live event schema.
6. Diagnostics `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]`.
7. Tests needed.

Что нельзя делать:
- не менять code/docs;
- не rewrite SSE broadly;
- не make bootstrap depend on live.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Current live/audit map.
2. Outbox design.
3. Post-commit event contract.
4. Risks/blockers.
5. Batch 2 implementation order.
```

## Ручная проверка после Prompt

Не нужна.
