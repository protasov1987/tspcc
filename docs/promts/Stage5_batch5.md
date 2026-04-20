# Stage 5 Batch 5

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
- Это Stage 5: Complete Card Files.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 6 и дальше:
  - не делать directories/security migration
  - не делать production migration
  - не делать messaging migration
- Нельзя заново переписывать Stage 3/4 целиком.
- Допустимо трогать только те места Stage 3/4, которые нужны для file-domain consistency.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 5:
добить attachment-linked side effects и input-control file linkage без новой миграции input control.

Цель:
- сохранить корректную связь файлов карточки с уже существующими сценариями
- после upload/delete/resync не терять обязательные file-linked side effects
- не переписывать заново Stage 4

Что нужно сделать:
1. Найти side effects, завязанные на file-domain карточки.
2. Подтвердить и сохранить file linkage для input control там, где он уже должен работать.
3. Исправить только то, что нужно для:
   - корректной очистки linkage после delete
   - корректного обновления linkage после upload/resync
4. Не менять business semantics input control за пределами file linkage.
5. Не начинать Stage 6.

Что нельзя делать:
- не переделывать input control как отдельный домен
- не менять approval/provision semantics
- не делать общий рефактор карточки
- не ломать существующие file-linked side effects

После изменений обязательно проверить:
- file-linked side effects остаются корректными
- input-control linkage не теряется
- delete/upload/resync не оставляют битых ссылок на файлы

Формат ответа:
1. Какие attachment-linked side effects добил.
2. Что именно изменил в input-control file linkage.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Исправлена согласованность файлов карточек и связанных file-link побочных эффектов"

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Желательна.

### Чек-лист для чайника

1. Открой карточку, где файлы связаны с дальнейшими действиями.
2. Загрузи или пересинхронизируй файл, если это безопасно.
3. Проверь, что связанное действие продолжает видеть нужный файл.
4. Удали тестовый файл, если это безопасно.
5. Проверь, что после удаления не осталась битая ссылка на несуществующий файл.
6. Обнови страницу через `F5`.
7. Убедись, что после обновления интерфейс не показывает старый удаленный файл как будто он еще есть.
