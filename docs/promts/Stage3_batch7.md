# Stage 3 Batch 7

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
- Это Stage 3: Migrate Cards Core.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 4 и Stage 5:
  - не трогать approvals как отдельный домен
  - не трогать input control
  - не трогать provision
  - не трогать card files как домен
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно закрыть Stage 3 end-to-end после предыдущих batch.

Цель:
- подтвердить, что Stage 3 действительно выполнен полностью
- не начать Stage 4/5 раньше времени
- добрать только минимальные проверки и исправления для cards core

Что нужно сделать:
1. Проверить весь Stage 3 against:
   - docs/architecture/target-architecture.md
   - docs/architecture/migration-plan.md
   - docs/architecture/change-checklist.md
   - docs/business-rules/cards-and-approval.md
   - docs/business-rules/workorders-archive-and-items.md
2. Подтвердить, что cards core теперь покрывает:
   - create
   - update
   - delete
   - archive
   - repeat
   - detail fetch
   - list/query
   - route-local refresh
3. Подтвердить, что Stage 4/5 functionality не смешана в Stage 3.
4. Подтвердить, что cards core reads/writes больше не используют `/api/data` как primary path для Stage 3 сценариев.
5. Если Stage 3 еще не закрыт, внести только минимальные добивающие изменения.

Критерий завершения Stage 3:
- cards core живет через отдельный card domain API
- `card.rev` обязателен для cards core writes
- stale card write дает `409`
- conflict не выбрасывает пользователя с card route
- targeted card refresh заменяет full reload
- обычное редактирование карточки больше не зависит от `/api/data`
- business-rules cards / archive / repeat не нарушены
- Stage 4/5 еще не начат как доменная миграция approvals/files

Что сделать с тестами:
- перед закрытием Stage 3 нужно явно проверить, что automated coverage теперь есть минимум на:
  - create success-path
  - update success-path
  - stale update conflict-path
  - delete success-path
  - archive success-path
  - repeat success-path
  - direct URL / `F5` stability для card detail
- если каких-то dedicated tests все еще нет, их нужно добавить в этом batch до объявления Stage 3 закрытым
- не считать `00.auth-routes` и `01.pages-and-modals-smoke` достаточными сами по себе

Формат ответа:
1. Выполнен ли Stage 3 полностью или нет.
2. Что именно еще пришлось добить.
3. Какие tests/specs прогнал и какие пришлось добавить.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Какие остаточные риски остались.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Завершен переход карточек на отдельный core API с поддержкой ревизий"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна. Это финальная ручная приемка Stage 3.

### Финальный чек-лист для чайника

1. Открой `/cards`.
2. Проверь, что список карточек открывается нормально.
3. Открой существующую карточку.
4. Измени одно безопасное поле и сохрани.
5. Проверь:
   - ты остался на той же карточке
   - маршрут не потерялся
   - `F5` открывает ту же карточку
6. Создай новую тестовую карточку, если это безопасно.
7. Проверь, что:
   - новая карточка создается
   - открывается корректно
8. Проверь archive:
   - архивная карточка уходит из активного списка
   - остается архивной сущностью
9. Проверь repeat:
   - из архива создается новая draft-карта
10. Если безопасно, проверь delete на отдельной тестовой карточке:
   - карточка действительно удаляется
   - после удаления не остается сломанного detail-экрана
11. Если безопасно, воспроизведи конфликт в двух вкладках:
   - одна и та же карточка открыта в двух вкладках
   - в первой сохрани изменения
   - во второй попробуй сохранить старую версию
   - должен быть конфликт, а не тихая перезапись
12. Открой `/archive`, `/workorders`, `/items`, `/ok`, `/oc`, если они доступны:
   - не должно быть сломанного отображения из-за миграции cards core
13. Убедись, что approvals, input control, provision и files не были “переделаны заодно”.

### Stage 3 считается принятым вручную, если:

- cards list работает
- card detail работает
- create/update работают
- delete работает
- archive/repeat сохранили старый смысл
- конфликт не теряет маршрут
- старый `/api/data` больше не является основным путём обычной core-записи карточки
- соседние derived views не сломались
