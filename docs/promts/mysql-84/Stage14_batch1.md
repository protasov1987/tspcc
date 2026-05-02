# MySQL 8.4 Stage 14 Batch 1

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
- Это MySQL 8.4 Stage 14: Production Cutover.
- Batch 1 является final pre-cutover readiness check.
- Текущий known state после Stage 13:
  - Stage 13 Batch 3 acceptance: `docs/architecture/mysql-84-stage13-batch3-acceptance.md`.
  - Stage 14 Batch 1 readiness artifact:
    `docs/architecture/mysql-84-stage14-batch1-readiness.md`.
  - VDS сейчас еще JSON runtime (`Alpha 0.16.60` at readiness check).
  - На VDS создан source backup `database.json` + `storage/cards`:
    `/root/tspcc-precutover-backups/precutover-20260502T064207Z`.
  - На VDS не было `mysql` / `mysqldump` / `pwsh` в `PATH`.
- Начинать можно только после Stage 13 PASS, который включает Stage 12
  JSON authority removal rehearsal proof.
- Нельзя начинать cutover без явного подтверждения пользователя.
- Нельзя менять production.
- Readiness check должен explicitly include Stage 12 artifacts: no writable
  `/api/data` / `saveData()`, no runtime `database.json` authority, no
  route-critical full snapshot read, SQL fixture/rehearsal setup proof, and
  any remaining JSON path classified as import/export/diagnostic only.
- Readiness check должен explicitly include Stage 6 acceptance artifacts:
  directories/security SQL source of truth, repository boundary, rev conflicts,
  `/api/data` overwrite protection, `Abyss`/password/landing/profile checks.
- Readiness check должен explicitly include Stage 10 Batch 5 acceptance
  artifacts: `/api/chat/*` SQL source of truth, profile privacy, WebPush/FCM
  ownership, user_actions ownership, no `/api/messages/*`, and Stage 10
  `/api/data` overwrite protection.
- Readiness check должен explicitly include Stage 11 Batch 4 acceptance
  artifacts: `audit_events` / `outbox_events` runtime use, post-commit live
  dispatch, rollback no-event proof, realtime unavailable fallback and no
  correctness dependency on SSE.
```

## Промт

```text
Нужно выполнить Stage 14 Batch 1: final readiness check перед production
cutover.

Проверь:
1. Stage 13 PASS.
2. Stage 12 Batch 6 PASS and Stage 13 rehearsal proof for JSON authority
   removal.
3. Current backups available.
4. Cutover runbook complete.
5. Rollback runbook complete.
6. Maintenance/quiesce plan ready.
7. Smoke checklist ready.
8. Monitoring checklist ready.
9. Owner/decision points clear.
10. No unresolved Stage 6 directories/security blockers remain.
11. No unresolved Stage 10 messaging/profile/notifications blockers remain.
12. No unresolved Stage 11 realtime/audit/outbox blockers remain.
13. No unresolved Stage 12 JSON authority blockers remain.
14. Whether production is still JSON-runtime or already MySQL-runtime.
15. Whether a fresh current production source backup exists.
16. Whether production MySQL server/client tooling exists.
17. Whether the next required batch is `Stage14_batch1a` (platform prep) or
    `Stage14_batch1b` (final operational gate).

Что нельзя делать:
- не выполнять production commands;
- не менять configs;
- не touch VDS files/data.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Ready/Not ready.
2. Checklist status.
3. Missing approvals/blockers.
4. Stage 11 readiness proof.
5. Stage 12 JSON authority removal proof.
6. Exact cutover command sequence to run only after explicit approval.
7. Exact next batch to run.
```

## Ручная проверка после Prompt

Пользователь должен явно подтвердить readiness before production cutover.
