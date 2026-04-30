# MySQL 8.4 Stage 8 Batch 8

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
- Это MySQL 8.4 Stage 8: Production Execution and Workspace SQL Cutover.
- Batch 8 можно начинать только после Stage 8 Batch 7 PASS.
- Batch 8 закрывает compatibility/read-only boundary and workspace refresh
  hardening после всех command-family cutovers.
- Нельзя исправлять Stage 9 derived views.
- Нельзя возвращать execution write authority в JSON/snapshot.
- Нельзя ломать SPA route/bootstrap contract.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 8 Batch 8: harden workspace/execution compatibility,
refresh and removal path.

Что сделать:
1. Make `/api/production/execution/scope` the only client production workspace
   refresh endpoint:
   - production scope loads in client must use this endpoint;
   - conflict refresh must preserve current route;
   - Back/Forward/F5/direct URL must continue to follow SPA contract.
2. Keep `/api/data?scope=production` as SQL-backed compatibility read/export:
   - it may return legacy-compatible shape;
   - source must be SQL execution/planning/directories/security/cards;
   - it must not initialize, repair, mutate or overwrite execution SQL state.
3. Protect POST `/api/data` / legacy snapshot paths:
   - stale snapshot payload cannot overwrite SQL-owned execution slices;
   - execution compatibility fields are read-only after cutover;
   - no hidden reverse sync from projection to authoritative SQL state.
4. Add explicit removal path for execution compatibility:
   - list legacy JSON/snapshot fields that remain compatibility only;
   - define checks required before removing them;
   - define owner and sequence for removal in later Stage 13/15 cleanup.
5. Verify realtime independence:
   - SSE/live may trigger refresh;
   - correctness must come from committed SQL state and targeted refresh;
   - if realtime is unavailable, workspace/execution still behaves correctly.
6. Add diagnostics:
   - `[DATA]` source logs for execution scope;
   - `[CONFLICT]` targeted refresh logs;
   - `[DB]`/`[PERF][WORKSPACE]` write path logs must identify SQL path.

Что нельзя делать:
- не use `/api/data?scope=production` as primary workspace refresh;
- не make derived views authoritative;
- не add client-side shadow merge as correctness mechanism;
- не push compatibility projection back into SQL as a separate write owner;
- не start messaging/profile/notifications stages.

Проверки:
- client production refresh never fetches `/api/data?scope=production` for
  normal workspace refresh;
- legacy `/api/data?scope=production` returns SQL-backed compatibility data;
- POST `/api/data` cannot overwrite execution SQL state;
- workspace conflict refresh remains route-safe;
- direct URL/F5 for `/workspace`, `/workspace/:qr`,
  `/production/delayed/:qr`, `/production/defects/:qr`;
- realtime unavailable fallback refresh.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Stage 8 Batch 8 PASS/FAIL/BLOCKED.
2. Workspace refresh proof.
3. Compatibility read-only proof.
4. Legacy overwrite protection proof.
5. Realtime independence proof.
6. Diagnostics proof.
7. Tests/checks run.
8. Remaining blockers for Batch 9 acceptance.
```

## Ручная проверка после Prompt

Проверить workspace, delayed/defects detail routes, F5/direct URL,
Back/Forward, one safe conflict refresh and behavior when live updates are not
available.
