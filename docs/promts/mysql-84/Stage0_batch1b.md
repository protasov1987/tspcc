# MySQL 8.4 Stage 0 Batch 1b

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
- Это MySQL 8.4 Stage 0 cleanup-hardening batch.
- Можно менять только локальный site code/tests/docs, необходимые для
  безопасного удаления карточки и ее persistent следов.
- Нельзя менять runtime `data/database.json`, `storage/cards`, VDS или
  production config.
- Нельзя выполнять фактическую чистку данных в этом batch.
- Если меняются файлы сайта, после успешной проверки обязателен
  `npm run version:bump -- --change "<краткое описание на русском>"`.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
```

## Промт

```text
Нужно выполнить Stage 0 Batch 1b: проверить и актуализировать процесс удаления
карточки на сайте так, чтобы после удаления карточки не оставалось persistent
следов.

Цель:
- сделать deletion path карточки пригодным для cleanup перед MySQL;
- сохранить текущую SPA/domain архитектуру;
- не начинать MySQL implementation.

Контекст business decision:
- карточки не являются приоритетными для миграции;
- если карточка сомнительная или сложная для переноса, ее можно удалить;
- после удаления карточки не должно оставаться persistent следов карточки,
  ее `qrId`, route card number, attachment id или production task references.

Итоги Stage 0 Batch 1a, которые считать входным inventory:
- `storage/cards/<qrId>` НЕ создается обычным create через `/api/cards-core`;
  папка создается lazy только файловыми путями:
  upload/resync `/api/cards/:id/files`, production file actions и legacy
  `/api/data` compatibility path.
- Поэтому карточка без `storage/cards/<qrId>` НЕ является ошибкой, если у нее
  нет attachment metadata.
- Текущий delete endpoint уже удаляет:
  - `cards[]`;
  - `productionShiftTasks[]` по `cardId`;
  - `storage/cards/<qrId>`.
- Текущий delete endpoint НЕ доказал cleanup:
  - `productionShifts[].closePageDraft`;
  - `productionShifts[].closePageSnapshot`;
  - `productionShifts[].closePageSnapshotHistory`;
  - `productionShifts[].initialSnapshot`;
  - `productionShifts[].logs`;
  - `userActions[]`;
  - `chatMessages[]` / system notifications;
  - attachment-linked references.
- Runtime audit counts до cleanup:
  - cards: `56`;
  - storage dirs: `351`;
  - orphan storage dirs: `302`;
  - orphan storage files inside orphan dirs: `281`;
  - physical files under existing card dirs without attachment metadata: `308`;
  - attachment metadata with empty/invalid `relPath`: `4`;
  - attachment metadata without physical file: `0`;
  - cards with attachment metadata but missing storage folder: `0`;
  - card operation refs to missing `ops`: `91` refs / `7` unique op ids;
  - card operation refs to missing `centers`: `3` refs / `3` unique center ids;
  - card deletion candidates: `26`;
  - `productionSchedule` rows with missing `employeeId`: `214`;
  - fixture has obsolete `productionScheduleSlotRevisions`: yes.
- Deletion candidate card ids from Stage 0 Batch 1a:
  `card_mirry5ip_y5t545`, `card_mk72cpvo_cfyl90`,
  `card_mkupej8p_8ee7bk`, `card_mkxrcyb6_br421b`,
  `card_ml19g1ik_oj4qpv`, `card_mmakp9sx_cfm9zk`,
  `card_mmc1s5fj_yencyu`, `card_mmesnprh_jfapuc`,
  `card_mmkmmem2_muk4ga`, `card_mmn0ep7i_t96zi3`,
  `card_mmukt7o7_r2a1z8`, `card_mmvlrz1p_fqiqb9`,
  `card_mmvnhgq2_00oic5`, `card_mmw3b3w8_h20bd4`,
  `card_mmx1wdqx_l6bda4`, `card_mmx6g0qe_8sysr4`,
  `card_mmxeqzga_tnnxve`, `card_mn7izxp0_a3hfb9`,
  `card_mnfnfh4u_sbu3qd`, `card_mo00xcxd_bdn91m`,
  `card_mofugcl5_u5nuv9`, `card_mofugnyj_48aoy2`,
  `card_mofuh5hj_o0yiek`, `card_moful1kj_yv7qks`,
  `card_mofv0zti_z0ff4w`, `card_moguxffm_uqfzuv`.
- Broken attachment metadata cards:
  - `card_mkupej8p_8ee7bk` / `OOLXIE0CH8`: 2 empty `relPath`;
  - `card_ml19g1ik_oj4qpv` / `E7KCAVDHDC`: 1 empty `relPath`;
  - `card_mmkmmem2_muk4ga` / `3SFOFXPKU7`: 1 empty `relPath`.

Что сделать:
1. Найти текущий deletion path карточки:
   - server endpoint;
   - client caller;
   - expectedRev/conflict behavior;
   - storage cleanup.
2. Вынести или актуализировать единый server-side cascade helper удаления
   карточки.
   - Helper должен быть единственным источником правил cascade cleanup для
     endpoint удаления карточки и будущего controlled cleanup script/batch.
   - Helper должен возвращать structured summary counts, чтобы Batch 1c мог
     сверить dry-run и фактический cleanup.
3. Helper должен удалять или очищать все persistent references на удаляемую
   карточку:
   - саму карточку из `cards[]`;
   - `storage/cards/<qrId>`;
   - `productionShiftTasks[]` по `cardId`;
   - `productionShifts` close-page draft/snapshot/history rows по `cardId`,
     `taskId`, `routeOpId`, `qrId`, route card number, если такие ссылки есть;
   - production shift logs, если они содержат устойчивую ссылку на удаляемую
     карточку;
   - `userActions[]`, если запись содержит устойчивую ссылку на удаляемую
     карточку;
   - chat/system messages только если в них есть устойчивые machine-readable
     или однозначные текстовые ссылки на удаляемую карточку;
   - attachment-linked metadata/notifications по attachment ids удаляемой
     карточки.
   Важно: если поле является массивом истории, удалять только связанные row/item
   references, а не весь unrelated history container.
4. Не удалять unrelated business history без доказанной связи с карточкой.
5. Сохранить expectedRev -> 409 для обычного удаления карточки.
6. Сохранить route stability после conflict.
7. Добавить или обновить focused tests:
   - удаление карточки удаляет production tasks;
   - удаление карточки удаляет storage folder;
   - удаление карточки очищает close-page snapshots/history от card rows;
   - удаление карточки очищает `userActions[]`/`chatMessages[]` только при
     устойчивой ссылке на удаляемую карточку;
   - helper возвращает counts удаленных/очищенных references;
   - stale delete возвращает 409 и не удаляет данные;
   - удаление не трогает unrelated cards/tasks/files.
8. Если меняется current behavior, обновить минимальную документацию:
   - `docs/architecture/current-state.md` или relevant business-rules doc.

Что нельзя делать:
- не менять router/bootstrap;
- не возвращать deletion на `/api/data`;
- не использовать клиентский snapshot-save;
- не менять MySQL docs как будто SQL уже внедрен;
- не чистить runtime DB/storage;
- не пушить в GitHub.

Формат ответа:
1. Какие deletion gaps найдены.
2. Что изменено в deletion cascade.
3. Какие persistent следы теперь удаляются.
4. Какие следы осознанно не удаляются и почему.
5. Какие тесты запущены.
6. Version bump result, если site files менялись.
7. Можно ли переходить к Batch 1c.
```

## Ручная проверка после Prompt

Минимально проверить:
- создать тестовую карточку с файлом;
- создать/найти production task для карточки;
- удалить карточку через UI/API;
- убедиться, что карточки, storage folder и task references больше нет;
- stale delete возвращает `409`.
