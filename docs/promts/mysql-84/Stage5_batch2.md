# MySQL 8.4 Stage 5 Batch 2

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
- Это MySQL 8.4 Stage 5: Cards, Approval and Card Files SQL Cutover.
- Можно менять только cards/lifecycle/files SQL cutover scope.
- Нельзя трогать directories/security/production/messaging cutover.
- Нельзя менять business semantics.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 5 Batch 2: реализовать cards/lifecycle/files SQL source
of truth.

Что сделать:
1. Implement cards repository and card files repository.
2. Move cards list/detail/create/update/delete/archive/repeat to SQL.
3. Move approval/input/provision lifecycle commands to SQL transactions.
4. Preserve lifecycle semantics and audit/log side effects.
5. Enforce `cards.rev` / `expectedRev -> 409`.
6. Store card attachments metadata in SQL.
7. Ensure file operations update SQL metadata and card revision safely.
8. Ensure transaction is not held during large file transfer.
9. Make JSON/snapshot unable to overwrite cards.

Что нельзя делать:
- не использовать `/api/data` for cards writes;
- не create second flow source of truth;
- не менять production execution;
- не lose route on conflict.

Проверки:
- card create/edit/archive/repeat/delete;
- approval/input/provision;
- file upload/delete/resync;
- stale `expectedRev`;
- direct URL/F5 on `/cards/:id`;
- reconciliation for cards/files.

Формат ответа:
1. SQL repositories/commands implemented.
2. How card/file transactions work.
3. Conflict behavior.
4. Tests/checks run.
5. Remaining compatibility and removal path.
```

## Ручная проверка после Prompt

Открыть `/cards`, создать/отредактировать тестовую карточку, проверить файл,
F5 на `/cards/:id`, конфликт в двух вкладках если возможно.
