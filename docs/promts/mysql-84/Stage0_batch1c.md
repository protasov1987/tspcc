# MySQL 8.4 Stage 0 Batch 1c

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
- Это MySQL 8.4 Stage 0 controlled local data cleanup batch.
- Можно менять только локальные runtime data/storage, явно перечисленные в
  cleanup plan:
  - `data/database.json`;
  - `storage/cards/**`;
  - E2E fixture только если это явно указано в cleanup plan.
- Нельзя менять VDS, production config или GitHub.
- Нельзя начинать MySQL implementation, importer, migrations или cutover.
- Перед любым удалением обязателен локальный backup runtime DB и storage.
- Нельзя делать version bump, если менялись только runtime data/storage или
  docs/non-site files.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
```

## Промт

```text
Нужно выполнить Stage 0 Batch 1c: controlled cleanup текущей локальной JSON-БД
и card file storage перед MySQL inventory mapping.

Перед стартом:
- убедись, что Batch 1a завершен и содержит точный cleanup plan;
- убедись, что Batch 1b завершен, если он нашел gaps в deletion cascade;
- Batch 1b НУЖЕН по итогам Stage 0 Batch 1a, потому что текущий delete endpoint
  удаляет `cards[]`, `productionShiftTasks[]` и `storage/cards/<qrId>`, но
  не доказал cleanup `productionShifts` close-page/snapshot/log traces,
  `userActions[]`, `chatMessages[]` и attachment-linked references.
- Не начинать Batch 1c, если Batch 1b не дал PASS по focused tests и не
  предоставил reusable server-side cascade helper/summary.

Цель:
- удалить мусорные orphan storage dirs/files;
- удалить сомнительные карточки вместе со всеми persistent следами;
- удалить мусорные production schedule rows с missing users;
- удалить устаревшее fixture-only поле `productionScheduleSlotRevisions`, если
  fixture входит в cleanup scope;
- получить чистую baseline JSON/file storage перед Batch 2.

Итоги Stage 0 Batch 1a, которые являются cleanup perimeter:
- Runtime DB: `data/database.json`.
- Runtime card storage: `storage/cards/**`.
- Fixture candidate: `tests/e2e/fixtures/baseline-core.database.json`.
- До cleanup найдено:
  - cards: `56`;
  - storage dirs: `351`;
  - orphan storage dirs: `302`;
  - orphan storage files inside orphan dirs: `281`;
  - empty orphan storage dirs: `51`;
  - non-empty orphan storage dirs: `251`;
  - physical files under existing card dirs without attachment metadata: `308`;
  - attachment metadata with empty/invalid `relPath`: `4`;
  - attachment metadata without physical file: `0`;
  - cards with attachment metadata but missing storage folder: `0`;
  - card operation refs to missing `ops`: `91`;
  - unique missing `ops`: `op_mirry5ip_6srzel`,
    `op_mirry5ip_4b35nj`, `op_mirry5ip_s0ik3a`,
    `op_mj69d2hf_cw8die`, `op_mj69d2hf_s8pam1`,
    `op_mkb3o61o_wf9g03`, `op_mj69d2hf_u5o342`;
  - card operation refs to missing `centers`: `3`;
  - unique missing `centers`: `wc_mirry5ip_p6fs52`,
    `wc_mirry5ip_raaw8i`, `wc_mirry5ip_zelt1a`;
  - card deletion candidates: `26`;
  - `productionSchedule` rows with missing `employeeId`: `214`,
    indices `0..213`, dates `2025-12-29..2026-01-28`;
  - fixture has obsolete `productionScheduleSlotRevisions`: yes;
  - fixture broken attachment `relPath` count matches runtime: `4`.

Deletion candidate card ids:
- `card_mirry5ip_y5t545`
- `card_mk72cpvo_cfyl90`
- `card_mkupej8p_8ee7bk`
- `card_mkxrcyb6_br421b`
- `card_ml19g1ik_oj4qpv`
- `card_mmakp9sx_cfm9zk`
- `card_mmc1s5fj_yencyu`
- `card_mmesnprh_jfapuc`
- `card_mmkmmem2_muk4ga`
- `card_mmn0ep7i_t96zi3`
- `card_mmukt7o7_r2a1z8`
- `card_mmvlrz1p_fqiqb9`
- `card_mmvnhgq2_00oic5`
- `card_mmw3b3w8_h20bd4`
- `card_mmx1wdqx_l6bda4`
- `card_mmx6g0qe_8sysr4`
- `card_mmxeqzga_tnnxve`
- `card_mn7izxp0_a3hfb9`
- `card_mnfnfh4u_sbu3qd`
- `card_mo00xcxd_bdn91m`
- `card_mofugcl5_u5nuv9`
- `card_mofugnyj_48aoy2`
- `card_mofuh5hj_o0yiek`
- `card_moful1kj_yv7qks`
- `card_mofv0zti_z0ff4w`
- `card_moguxffm_uqfzuv`

Broken attachment metadata cards that must be deleted entirely:
- `card_mkupej8p_8ee7bk` / `OOLXIE0CH8` / `live_all2`:
  2 attachments with empty `relPath`;
- `card_ml19g1ik_oj4qpv` / `E7KCAVDHDC` / `test_after_f5`:
  1 attachment with empty `relPath`;
- `card_mmkmmem2_muk4ga` / `3SFOFXPKU7` / `MK-20260311-0001`:
  1 attachment with empty `relPath`.

Physical files without metadata under existing card dirs must be removed as
orphan files, not imported into metadata, unless Batch 1b explicitly documents
an exception:
- `card_mjk07q12_h7dvv2`: 233 files;
- `card_mnrtph80_q9jfqq`: 37 files;
- `card_mo39mnzx_t1qih8`: 22 files;
- `card_mnzkz5rn_rtu510`: 8 files;
- `card_mo90u3l3_ovdm3q`: 4 files;
- `card_mkupej8p_8ee7bk`: 2 files;
- `card_ml19g1ik_oj4qpv`: 1 file;
- `card_mo00xcxd_bdn91m`: 1 file.

Обязательные backup steps:
1. Создать backup `data/database.json` рядом с текущей БД с timestamp.
2. Создать archive/copy backup `storage/cards` с timestamp в локальную backup
   папку, не на VDS.
3. Вывести пути backup в ответе.
4. Не продолжать cleanup, если backup не создан.

Cleanup policy:
1. Удалить orphan dirs/files, у которых нет карточек.
2. Не удалять карточку только потому, что нет storage folder, если у нее нет
   attachment metadata и код подтверждает lazy folder creation.
3. Удалить карточку целиком, если у нее:
   - attachment metadata с пустым/невалидным `relPath`;
   - attachments с missing physical file;
   - `operations[].opId`, которого нет в `ops`, и перенос требует historical
     compatibility;
   - `operations[].centerId`, которого нет в `centers`, и перенос требует
     historical compatibility;
   - иные broken references, которые по принятой политике проще удалить.
4. Для каждой удаляемой карточки удалить все persistent следы согласно helper
   из Batch 1b:
   - cards row;
   - storage folder;
   - production tasks;
   - close-page snapshots/drafts/history rows;
   - однозначные logs/actions/messages/references;
   - attachment-linked references.
5. Удалить `productionSchedule` rows с `employeeId`, которого нет в `users`.
6. Удалить из fixture `productionScheduleSlotRevisions`.
7. Если fixture включен в cleanup scope, синхронизировать fixture anomalies с
   runtime cleanup policy: убрать те же broken attachment/card references,
   если они присутствуют в fixture и являются частью baseline.

Safety requirements:
- Сначала выполнить dry-run и показать counts/list samples.
- Dry-run counts должны явно сверяться с Stage 0 Batch 1a perimeter выше. Если counts
  отличаются, остановиться и объяснить расхождение перед mutation.
- Затем выполнить cleanup только если dry-run соответствует policy.
- После cleanup перечитать JSON и storage, не полагаясь на in-memory state.
- Не использовать ad hoc string edits JSON; использовать JSON parser.
- Не удалять ничего вне `storage/cards`.
- Для любых recursive delete проверить absolute path и убедиться, что он
  находится внутри `storage/cards`.

Что нельзя делать:
- не менять site code;
- не менять router/bootstrap;
- не менять MySQL docs как будто SQL уже внедрен;
- не чистить VDS;
- не пушить в GitHub.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Backup paths.
2. Dry-run summary.
3. Что удалено из DB.
4. Что удалено из storage.
5. Что изменено в fixture, если применимо.
6. Post-cleanup anomaly counts.
7. Остались ли blockers для Batch 1d.
```

## Ручная проверка после Prompt

Проверить:
- `data/database.json` валиден как JSON;
- приложение стартует локально;
- список карточек открывается;
- detail активной карточки открывается;
- удаленные карточки не открываются;
- orphan storage dirs/files больше не находятся audit-командой.
