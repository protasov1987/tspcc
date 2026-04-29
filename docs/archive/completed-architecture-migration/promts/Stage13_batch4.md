# Stage 13 Batch 4

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
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 14:
  - не делать final diagnostics/E2E/perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-12 целиком.
- Допустимо убирать только ту legacy-переходность, которая уже реально заменена новой моделью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 13:
ужесточить legacy snapshot boundary после удаления in-scope `saveData()`
leftovers в Batch 2-3.

Цель:
- `/api/data` больше не должен быть critical write-path для in-scope доменов
- сохранить GET `/api/data` и route/read compatibility там, где они еще нужны
- сохранить Stage 8 planning protection и receipts carve-out

Что нужно сделать:
1. Повторно проверить `POST /api/data` в `server.js`:
   - `LEGACY_SNAPSHOT_DATA_PATH`
   - `isLegacySnapshotDataPath`
   - `logLegacySnapshotWriteBoundary`
   - `preserveProtectedSlicesForLegacySnapshot`
   - `mergeSnapshots`
2. Подтвердить, что после Batch 2-3 из клиента больше нет critical in-scope
   callers, которым нужен `POST /api/data`.
3. Ужесточить `POST /api/data` минимально:
   - запретить или игнорировать критичные in-scope write slices, для которых
     replacement уже подтвержден
   - не ломать GET `/api/data?scope=*`
   - не ломать tests/fixtures, которые используют GET для setup/assertions
4. Обязательно сохранить уже выявленные protected slices:
   - `messages`
   - `userActions`
   - `chatConversations`
   - `chatMessages`
   - `chatStates`
   - `webPushSubscriptions`
   - `fcmTokens`
   - `productionSchedule`
   - `productionShiftTasks`
   - `productionShifts`
   - `users`
   - `accessLevels`
5. Не удалять Stage 8 protection до отдельного proof:
   - legacy snapshot не должен перезаписывать planning
   - `meta.domainRevisions.productionPlanning` не должен меняться от legacy snapshot
6. Если `POST /api/data` остается, явно сделать его compatibility path, а не
   fallback write path для in-scope domains.

Что нельзя делать:
- не удалять GET `/api/data`
- не ломать boot/read scopes
- не ослаблять `preserveProtectedSlicesForLegacySnapshot`
- не трогать receipts как домен
- не менять domain APIs ради cleanup

После изменений обязательно проверить:
- `POST /api/data` не может перезаписать protected in-scope slices
- cards/directories/security/planning/messaging tests не видят critical
  snapshot write-path
- Stage 8 legacy snapshot protection test остается зеленым
- security legacy snapshot protection test остается зеленым
- messaging snapshot protection test остается зеленым

Формат ответа:
1. Что изменил в legacy snapshot boundary.
2. Какие slices теперь защищены/запрещены для legacy snapshot.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Ужесточен legacy snapshot boundary для in-scope доменов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Перейди по нескольким экранам: карточка, справочник, production, чат.
3. Выполни одно безопасное доменное действие сохранения или обновления.
4. Проверь:
   - данные сохраняются через обычный UI
   - маршрут не дергается
   - после `F5` состояние сохранилось
5. Если какой-то экран начал зависеть от старого `/api/data` save, batch не закрыт.
