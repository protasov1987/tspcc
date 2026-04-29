# MySQL 8.4 Stage 0 Batch 1a

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
- Это MySQL 8.4 Stage 0 cleanup-prep batch.
- Batch 1a является audit-only.
- Нельзя менять код приложения, БД, storage, fixtures, VDS или production config.
- Нельзя удалять карточки, папки, файлы или строки расписания.
- Нельзя делать version bump.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
```

## Решения owner'а данных

```text
Принята политика cleanup перед MySQL mapping:
- МК/карточки в текущей JSON-БД не являются приоритетными.
- Если карточка, ее файлы или ссылки вызывают сомнения и перенос сложен,
  карточку можно удалить вместе со всеми ее файлами.
- Главное требование: после удаления карточки не должно оставаться persistent
  следов удаленной карточки в JSON-БД, storage, fixtures cleanup target или
  production/read-model данных.
- Orphan папки и файлы, у которых нет карточек, должны быть удалены.
- Карточка без storage folder сама по себе не является ошибкой, если папка
  создается лениво только при добавлении файлов.
- Attachments с пустым `relPath` считаются broken metadata; такие карточки
  являются кандидатами на удаление целиком.
- Карточки с route operation references на отсутствующие `ops`/`centers`
  являются кандидатами на удаление целиком.
- `productionSchedule` записи с `employeeId`, которого нет в `users`, являются
  мусором и должны быть исключены.
- Fixture-only поле `productionScheduleSlotRevisions` устарело и должно быть
  удалено из fixture отдельным controlled change.
```

## Промт

```text
Нужно выполнить Stage 0 Batch 1a: точный audit cleanup perimeter перед
реальной чисткой JSON-БД и card file storage.

Цель:
- получить полный список данных, которые будут удалены в cleanup batch;
- доказать, что обычная карточка без storage folder является нормальной
  ситуацией, если у нее нет attachment metadata;
- подготовить безопасный cascade deletion plan для карточек.

Что проверить:
1. Где и когда создается `storage/cards/<qrId>`:
   - обычный create карточки через `/api/cards-core`;
   - upload/resync файлов карточки;
   - production file actions;
   - legacy `/api/data` compatibility path.
2. Составить список orphan storage dirs/files:
   - папка есть, карточки с таким `qrId` нет;
   - файл есть, attachment metadata нет;
   - attachment metadata есть, physical file нет;
   - attachment metadata есть, но `relPath` пустой или невалидный.
3. Составить список карточек-кандидатов на удаление:
   - cards с broken attachment metadata;
   - cards с `operations[].opId`, которого нет в `ops`;
   - cards с `operations[].centerId`, которого нет в `centers`;
   - cards с missing storage folder только если у них есть file metadata или
     код доказывает, что папка должна существовать для каждой карточки.
4. Составить список persistent следов, которые должны удаляться вместе с
   карточкой:
   - `cards[]`;
   - `storage/cards/<qrId>`;
   - `productionShiftTasks[]`;
   - `productionShifts[].closePageDraft`;
   - `productionShifts[].closePageSnapshot`;
   - `productionShifts[].closePageSnapshotHistory`;
   - `productionShifts[].initialSnapshot`;
   - `productionShifts[].logs`;
   - `productionSchedule`, если запись прямо зависит от удаляемой карточки
     или от удаляемого production task;
   - `userActions[]`;
   - `chatMessages[]` / system notifications, если есть устойчивые ссылки на
     card id, qr, route card number или attachment id;
   - любые derived/read-model fields, где найден card id/qr/attachment id.
5. Составить список `productionSchedule` записей с missing `employeeId`.
6. Составить список fixture cleanup targets:
   - `productionScheduleSlotRevisions`;
   - fixture cards/files anomalies, если они отличаются от runtime DB.

Что нельзя делать:
- не удалять данные;
- не писать cleanup script;
- не менять deletion code;
- не менять docs, если prompt явно не просит создать inventory artifact;
- не делать version bump.

Формат ответа:
1. Доказательство, когда создается card storage folder.
2. Orphan storage deletion candidates.
3. Card deletion candidates с причиной.
4. Non-card cleanup candidates.
5. Полный cascade deletion checklist для одной карточки.
6. Что должно быть исправлено в Batch 1b до реальной чистки.
7. Можно ли переходить к Batch 1b.
```

## Ручная проверка после Prompt

Не нужна, если batch был audit-only и не менял файлы.
