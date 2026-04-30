# MySQL 8.4 Stage 0 Batch 1d

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
- Это MySQL 8.4 Stage 0 cleanup proof batch.
- Batch 1d является verification-only, если Batch 1c уже выполнил cleanup.
- Нельзя менять код, БД, storage, VDS или production config.
- Если найдены blockers, не исправляй их в этом batch; перечисли следующий
  минимальный cleanup/fix batch.
- Version bump не нужен.
```

## Промт

```text
Нужно выполнить Stage 0 Batch 1d: доказать, что cleanup базы и storage завершен
и что процесс удаления карточек не оставляет persistent следов.

Цель:
- подтвердить, что после cleanup можно безопасно выполнять Stage 0 Batch 2;
- подтвердить, что новые/актуализированные deletion rules работают;
- не начинать MySQL implementation.

Baseline из Stage 0 Batch 1a до cleanup:
- cards: `56`;
- storage dirs: `351`;
- orphan storage dirs: `302`;
- orphan storage files: `281`;
- physical files under existing card dirs without attachment metadata: `308`;
- broken attachment `relPath`: `4`;
- attachment metadata without physical file: `0`;
- cards with attachment metadata but missing storage folder: `0`;
- operation refs to missing `ops`: `91`;
- operation refs to missing `centers`: `3`;
- card deletion candidates: `26`;
- `productionSchedule` rows with missing `employeeId`: `214`;
- fixture `productionScheduleSlotRevisions`: present.

Expected post-cleanup target if Batch 1b and 1c passed:
- orphan `storage/cards/<qrId>` dirs: `0`;
- physical files without attachment metadata: `0`, unless Batch 1c documented
  an explicit allowed historical exception;
- broken attachment `relPath`: `0`;
- attachment metadata without physical file: `0`;
- cards with attachment metadata but missing storage folder: `0`;
- operation refs to missing `ops`/`centers`: `0`, if cleanup policy deleted
  all candidate cards;
- `productionSchedule.employeeId` missing user rows: `0`;
- fixture `productionScheduleSlotRevisions`: absent.

Что проверить:
1. JSON integrity:
   - `data/database.json` читается и парсится;
   - top-level fields соответствуют normalized runtime shape;
   - нет fixture-only runtime fields.
2. Storage integrity:
   - нет orphan `storage/cards/<qrId>` без карточки;
   - нет physical files без attachment metadata, если они не являются явно
     разрешенным historical artifact;
   - нет attachment metadata с пустым/невалидным `relPath`;
   - нет attachment metadata без physical file.
3. Card reference integrity:
   - нет `productionShiftTasks.cardId` на отсутствующую карточку;
   - нет close-page snapshot/draft/history rows на отсутствующую карточку;
   - нет close-page snapshot/draft/history rows на карточки, удаленные в
     Batch 1c;
   - нет `productionShifts[].initialSnapshot`/`logs` traces на карточки,
     удаленные в Batch 1c;
   - нет card operation refs на отсутствующие `ops`/`centers`, если cleanup
     policy требует удалять такие карточки;
   - нет attachment-linked references на удаленные files/cards.
   Проверять минимум по deletion candidate ids из Stage 0 Batch 1a:
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
4. Production schedule integrity:
   - нет `productionSchedule.employeeId` на отсутствующего пользователя;
   - разрешенные special rows вроде `__shift_master__` не сломаны.
5. Fixture integrity:
   - `productionScheduleSlotRevisions` отсутствует, если поле признано
     устаревшим;
   - fixture reset по-прежнему работает.
6. Deletion process proof:
   - focused tests из Batch 1b проходят;
   - если возможно, вручную или тестом удалить временную карточку с файлом и
     production references, затем доказать отсутствие persistent следов.
7. Regression guard:
   - обычная карточка без `storage/cards/<qrId>` и без attachments НЕ считается
     anomaly;
   - создание карточки через `/api/cards-core` по-прежнему не обязано создавать
     storage folder;
   - storage folder появляется только после file upload/resync/production file
     action или legacy `/api/data` compatibility path.

Что нельзя делать:
- не исправлять найденные проблемы в этом batch;
- не менять inventory mapping;
- не начинать Stage 1;
- не делать cleanup без отдельного prompt.

Формат ответа:

Ответ по итогам batch ОБЯЗАТЕЛЬНО выводи на русском языке; технические статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и таблиц не переводить.
1. Cleanup proof PASS/FAIL/BLOCKED.
2. Таблица проверок JSON/storage/references.
3. Результат deletion process proof.
4. Сравнение post-cleanup counts с Stage 0 Batch 1a baseline.
5. Остаточные anomalies, если есть.
6. Можно ли переходить к Stage 0 Batch 2.
```

## Ручная проверка после Prompt

Если verification PASS, можно выполнять `Stage0_batch2.md`.
