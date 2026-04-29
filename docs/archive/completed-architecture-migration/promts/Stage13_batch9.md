# Stage 13 Batch 9

## Общий префикс для каждого промта

```text
Работай строго по:
- AGENTS.md
- docs/architecture/target-architecture.md
- docs/architecture/migration-plan.md
- docs/architecture/current-state.md
- docs/architecture/change-checklist.md
- docs/business-rules/auth-and-navigation.md
- docs/business-rules/cards-and-approval.md
- docs/business-rules/directories-and-security.md
- docs/business-rules/production-and-workspace.md
- docs/business-rules/workorders-archive-and-items.md
- docs/business-rules/messaging-profile-and-notifications.md

Важно:
- Это Stage 13: Remove Legacy Snapshot and Transitional Overlaps.
- Это финальная приемка Stage 13, а не implementation batch.
- Нельзя менять файлы приложения.
- Нельзя делать version bump.
- Нельзя начинать Stage 14.
- Если найдены blockers — перечисли их и предложи отдельный следующий implementation batch.
```

## Промт

```text
Нужно выполнить финальную проверку Stage 13 end-to-end после Batch 8.

Цель:
- подтвердить, что Stage 13 полностью удалил transitional architecture для
  in-scope perimeter
- убедиться, что remaining compatibility paths имеют понятный статус
- ничего не исправлять в этом batch

Что нужно сделать:
1. Повторить финальный audit against target/current/change-checklist и all business-rules.
2. Проверить весь Stage 13 scope:
   - `/api/data` as critical write path
   - client `saveData()` for critical domains
   - route / write / live overlaps
   - shadow correctness hacks
   - legacy messaging overlap
   - unresolved adapters
3. Выполнить обязательные read-only проверки по карте Batch 1 audit:
   - `rg -n "saveData\\(" js --glob '!tests/**'`
   - `rg -n "POST.*\\/api\\/data|/api/data|LEGACY_SNAPSHOT_DATA_PATH|preserveProtectedSlicesForLegacySnapshot" js server.js tests/e2e --glob '!tests/e2e/fixtures/**'`
   - `rg -n "/api/messages|api/messages|messages/dialog|messages/send|messages/mark-read" . --glob '!tests/e2e/fixtures/**'`
   - проверить `docs/architecture/current-state.md`, что он не противоречит
     факту удаления или классификации `/api/messages/*`
4. Подтвердить:
   - no critical in-scope writes through aggregated snapshot
   - no parallel domain models
   - no correctness on local giant mutable snapshot
   - no unresolved adapter without removal path
   - receipts remains frozen out-of-scope
   - Stage 8 planning protection либо удалена с proof, либо оставлена как
     explicit guard with removal path
   - GET `/api/data` если остался, классифицирован как read compatibility
   - `POST /api/data` если остался, не принимает critical in-scope writes
5. Подтвердить, что Stage 14 functionality не смешана в Stage 13.
6. Если Stage 13 еще не закрыт:
   - не вносить исправления
   - перечислить blockers
   - предложить отдельный следующий implementation batch

Формат ответа:
1. Выполнен ли Stage 13 полностью или нет.
2. Финальная таблица remaining compatibility/adapters.
3. Результат проверки отсутствия critical snapshot writes.
4. Отдельный результат по найденным Batch 1 audit зонам:
   - IMDX missing directories
   - QR auto-create
   - workorders/execution legacy fields/comments
   - Stage 8 planning protection
   - messaging `/api/messages/*`
   - live fallback/overlap
5. Какие tests/audit checks проверил автоматически.
6. Что нужно проверить вручную — отдельным чек-листом для обычного пользователя.
7. Если Stage 13 не закрыт: blockers и минимальный следующий implementation batch.
8. Какие остаточные риски остались.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 13.

### Stage 13 считается принят вручную, если:

- критичные write-path больше не идут через старый общий snapshot
- `saveData()` не является основой critical in-scope writes
- нет дублирующих route/write/live перекрытий
- нет correctness на giant mutable snapshot
- unresolved adapters больше не остаются без removal path
- Stage 14 не был затронут без отдельной задачи
- receipts остался frozen out-of-scope и не использовался как оправдание для
  critical legacy write-path в других доменах
