# MySQL 8.4 Stage 9 Batch 2

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
- Это MySQL 8.4 Stage 9: Derived Views SQL Read Model Cutover.
- Можно менять только derived views read model scope.
- Нельзя создавать bypass write-path.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 9 Batch 2: перевести derived views на SQL source
domains/read models.

Что сделать:
1. Implement SQL query/read model layer for workorders/archive/items/ok/oc.
2. Ensure views derive from cards + production authoritative SQL domains.
3. Preserve archive semantics.
4. Preserve repeat from archive as card command creating new draft.
5. Preserve detail route stability.
6. Preserve items/ok/oc consistency with production flow.
7. Prove no derived view has independent write authority.

Что нельзя делать:
- не mutate derived view state directly;
- не reintroduce snapshot source;
- не change cards/production business semantics.

Проверки:
- workorders list/detail;
- archive list/detail;
- repeat;
- items/ok/oc after source changes;
- direct URL/F5 detail routes;
- no derived write bypass.

Формат ответа:
1. Read model/query layer implemented.
2. Route behavior preserved.
3. Write authority proof.
4. Tests/checks run.
5. Remaining risks.
```

## Ручная проверка после Prompt

Проверить workorders, archive, repeat, items/ok/oc and F5 on detail routes.
