# Stage 14 Batch 6

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
выполнить baseline measurement, targeted performance hardening и повторное measurement.

Цель:
- делать perf work только после доказанной correctness
- оптимизировать реальные bottleneck, а не предположения
- отдельно измерить server write-path / DB persist / realtime behavior там, где это обосновано

Что нужно сделать:
1. Выбрать и зафиксировать baseline measurements для реальных bottleneck.
2. Измерить:
   - server write-path latency
   - DB persist latency, если это релевантно
   - realtime-related timing там, где он реально мешает
3. Для production отдельно не оптимизировать за счет возврата к global
   `meta.revision`, snapshot writes или live-as-truth; Stage 8/9 correctness
   contracts имеют приоритет над latency.
4. Внести только targeted perf improvements по подтвержденным bottleneck.
5. Повторно измерить и сравнить with baseline.
6. Если использовался временный допуск для `/workspace` realtime E2E, отдельно оценить, можно ли его уменьшить.

Что нельзя делать:
- не оптимизировать без baseline measurement
- не жертвовать correctness ради perceived performance
- не вводить cache-heavy или hidden-side-effect модели
- не объявлять временный тестовый допуск target SLA

После изменений обязательно проверить:
- baseline и post-change measurements действительно есть
- perf improvements измеряемы и локализованы
- correctness после оптимизаций не нарушена

Формат ответа:
1. Что именно измерил до изменений.
2. Какие bottleneck подтвердились.
3. Какие targeted perf changes внес.
4. Что показало повторное measurement.
5. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
6. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Выполнен измеряемый performance hardening после завершения architectural migration"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой один-два экрана, которые раньше казались медленными.
2. Выполни одно привычное действие.
3. Сравни по ощущению:
   - хуже не стало
   - экран не начал лагать сильнее
4. Главное:
   - корректность не должна ухудшиться
   - данные не должны пропадать ради "ускорения"
5. Если после оптимизации стало быстрее, но данные ведут себя неверно, batch не закрыт.
