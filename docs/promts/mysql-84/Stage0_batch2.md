# MySQL 8.4 Stage 0 Batch 2

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
- Это MySQL 8.4 Stage 0: SQL Readiness Inventory.
- Можно менять только документационные inventory artifacts.
- Нельзя менять файлы сайта, runtime code, database, storage или VDS.
- Если меняются только docs/non-site files, version bump не нужен.
```

## Промт

```text
Нужно выполнить Stage 0 Batch 2: зафиксировать inventory artifacts по результатам
Batch 1.

Цель:
- создать или обновить документационные артефакты, достаточные для SQL schema
  design и importer planning;
- не начинать implementation.

Что сделать:
1. Зафиксировать `JSON field -> SQL domain/table` mapping.
2. Зафиксировать owner для каждого домена и compatibility field.
3. Зафиксировать file metadata reconciliation baseline:
   - expected metadata;
   - physical file relation;
   - missing/orphan file categories;
   - checksum/size availability.
4. Зафиксировать broken reference categories:
   - card -> directory/user;
   - production task -> card/operation/area/shift;
   - message -> user/conversation;
   - attachment -> card/file.
5. Зафиксировать duplicate/anomaly categories.
6. Зафиксировать business invariants, которые importer обязан валидировать.

Что нельзя делать:
- не добавлять MySQL code;
- не добавлять migrations;
- не менять site behavior;
- не удалять compatibility adapters.

Формат ответа:
1. Какие inventory docs созданы/обновлены.
2. Где находится field mapping.
3. Где находится file reconciliation baseline.
4. Какие unresolved questions остались.
5. Готов ли Stage 0 к proof batch.
```

## Ручная проверка после Prompt

Не нужна. Проверить можно только наличие и читаемость созданных docs.
