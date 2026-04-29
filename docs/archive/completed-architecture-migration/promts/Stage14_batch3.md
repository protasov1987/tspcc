# Stage 14 Batch 3

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
добить route/auth/bootstrap E2E coverage для всего in-scope perimeter.

Цель:
- доказать route/boot/auth correctness across in-scope route families
- закрыть пробелы по direct URL, F5, back/forward и protected routes
- явно исключить только `receipts` из current migration completion criteria

Что нужно сделать:
1. Проверить существующие route/auth E2E.
2. Добрать недостающие тесты для:
   - direct URL entry
   - F5 on protected routes
   - back/forward
   - deep routes
   - permission-sensitive routes
3. Убедиться, что покрытие явно исключает только `receipts`, но включает весь остальной in-scope perimeter.
4. Не менять business rules ради удобства тестов.
5. Не смешивать этот batch с domain write fixes, если они уже не нужны.

Что нельзя делать:
- не ослаблять проверки ради green tests
- не удалять существующие полезные E2E
- не менять route semantics, чтобы "проще тестировалось"
- не трогать receipts как домен

После изменений обязательно проверить:
- route/auth/bootstrap E2E реально покрывают in-scope perimeter
- `receipts` явно исключен, а не случайно пропущен
- тесты отражают target architecture, а не legacy assumptions

Формат ответа:
1. Какие route/auth/bootstrap E2E добавил или добил.
2. Какие route families теперь покрыты.
3. Какие тесты прогнал автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Добрано E2E покрытие роутинга bootstrap и auth для in-scope маршрутов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой вручную:
   - `/cards`
   - `/cards/ID`
   - `/production/plan`
   - `/workspace`
2. Проверь:
   - direct URL открывает нужный экран
   - `F5` не ломает маршрут
   - `Назад/Вперёд` работают
3. Если хотя бы один из этих базовых route-сценариев все еще нестабилен, batch не закрыт.
