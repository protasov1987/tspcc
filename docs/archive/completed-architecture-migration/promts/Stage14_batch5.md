# Stage 14 Batch 5

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
- Это Stage 14: Final Diagnostics, E2E and Performance Hardening.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Это финальный stage доказательства достижения target architecture, а не новый продуктовый refactor.
- Performance work разрешен только после подтверждения correctness и только после измерений.
- Нельзя делать необоснованные perf-оптимизации "на глаз".
- Сначала проведи точную диагностику по коду и тестам, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 14:
добить realtime E2E coverage и correctness-with-live-unavailable proof.

Цель:
- доказать, что live не нужен для correctness
- покрыть multi-client propagation и fallback refresh сценарии
- корректно обработать временный допуск для realtime E2E `/workspace`

Что нужно сделать:
1. Проверить существующие realtime E2E.
2. Добрать недостающие тесты для:
   - multi-client propagation
   - correctness with live unavailable
   - fallback refresh
   - production planning live/fallback через Stage 8 planning slice refresh
   - production execution live/fallback без обхода Stage 9 flow conflict model
3. Отдельно обработать временное примечание:
   - если для `/workspace` realtime E2E нужен допуск выше `1000ms`, зафиксировать это как временный допуск
   - не считать его target SLA
4. Отдельно доказать не только happy-path propagation, но и:
   - local no-refresh / no-request invalid-state path
   - route-safe fallback на list/detail/deeplink routes, где такие маршруты реально есть
5. Не считать synthetic live event или mock достаточным доказательством, если тот же сценарий можно проверить реальным two-tab / multi-client способом.
6. Не подменять correctness отключением сложных realtime-проверок.
7. Не делать perf hardening в этом batch без измерений.

Что нельзя делать:
- не делать realtime обязательным для green tests
- не убирать fallback-сценарии ради скорости
- не маскировать архитектурную проблему повышением таймаута без явного комментария
- не начинать Stage 13 cleanup заново

После изменений обязательно проверить:
- realtime E2E реально доказывают correctness without live
- multi-client propagation покрыт
- временный допуск `/workspace` явно помечен как временный, если он нужен
- real two-tab / multi-client proof существует не только для live propagation, но и для fallback/no-live behavior
- покрытие не ограничивается synthetic live signals там, где доступен реальный пользовательский сценарий

Формат ответа:
1. Какие realtime E2E добавил или добил.
2. Как обработал временный допуск для `/workspace`, если он понадобился.
3. Какие тесты прогнал автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добрано E2E покрытие realtime и fallback refresh сценариев"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт в двух вкладках.
2. В одной вкладке измени данные, если у тебя есть права.
3. Во второй вкладке проверь:
   - live-обновление приходит или корректно догружается через refresh
4. Потом обнови вторую вкладку через `F5`.
5. Убедись, что итоговое состояние совпадает даже без доверия к live.
6. Если без live приложение показывает неверное состояние, batch не закрыт.
