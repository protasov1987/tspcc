# Stage 14 Batch 2

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
нормализовать diagnostics до полного набора `[BOOT]`, `[ROUTE]`, `[LIVE]`, `[DATA]`, `[CONFLICT]`.

Цель:
- сделать диагностику достаточной для локализации любой critical in-scope поломки
- сохранить логи полезными и не шумными
- не менять business behavior

Что нужно сделать:
1. Проверить, где отсутствуют или неполны diagnostics tags:
   - `[BOOT]`
   - `[ROUTE]`
   - `[LIVE]`
   - `[DATA]`
   - `[CONFLICT]`
2. Добавить только недостающие ключевые точки.
3. Сохранить полезность логов:
   - не превращать их в spam
   - не скрывать настоящую ошибку под вторичным шумом
4. Сохранить текущую архитектуру:
   - live only signals refresh
   - route and boot stay diagnosable
   - domain conflict stay diagnosable
5. Не трогать receipts и не начинать perf hardening.

Что нельзя делать:
- не переписывать unrelated logging system целиком
- не делать console spam
- не удалять полезные existing logs без причины
- не менять доменные правила ради удобства логирования

После изменений обязательно проверить:
- все 5 diagnostics prefixes реально используются
- по логам можно понять, где именно ломается boot/route/live/data/conflict
- шум не вырос бесконтрольно

Формат ответа:
1. Какие diagnostics gaps закрыл.
2. Где именно добавил или уточнил логи.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Нормализована диагностика boot route live data и conflict сценариев"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой сайт.
2. Если умеешь, нажми `F12` и открой `Console`.
3. Пройди по нескольким экранам:
   - `/cards`
   - `/production/plan`
   - чат, если доступен
4. Обнови страницу через `F5`.
5. Проверь:
   - в консоли есть понятные логи с `[BOOT]`, `[ROUTE]`, `[LIVE]`, `[DATA]`, `[CONFLICT]` по ситуации
   - нет бесконечного однотипного спама
6. Если логов недостаточно или они превращаются в мусор, batch не закрыт.
