# MySQL 8.4 Migration Prompts

Эта папка предназначена для активных prompt batches по переходу
persistence-слоя на MySQL 8.4.

Базовый архитектурный документ:

- `docs/architecture/mysql-84-target-architecture.md`

Обязательный план миграции:

- `docs/architecture/mysql-84-migration-plan.md`

Обязательные guardrails для любых MySQL batch:

- не менять SPA routing/bootstrap contract из
  `docs/architecture/current-architecture.md`;
- не возвращать critical writes на общий snapshot-save;
- не делать MySQL одной большой JSON-таблицей как final state;
- выполнять переход маленькими domain/storage-slice batch;
- сохранять бизнес-правила из `docs/business-rules/*.md`.

Завершенные SPA/domain migration prompts находятся в архиве:

- `docs/archive/completed-architecture-migration/promts/`

## Batch Index

Созданы стартовые active prompts для всех stages из
`docs/architecture/mysql-84-migration-plan.md`.

Принцип работы:

- выполнять stages строго по порядку;
- после завершения каждой stage актуализировать prompts следующей stage по
  фактическим результатам, inventory, blockers и implementation decisions;
- не использовать поздние stage prompts без проверки, что все предыдущие
  acceptance batches имеют PASS;
- production/VDS actions выполнять только там, где prompt явно требует
  отдельного подтверждения пользователя.
- итог выполнения любого Stage batch выводить на русском языке; технические
  статусы `PASS` / `FAIL` / `BLOCKED`, имена команд, маршрутов, файлов и
  таблиц не переводить.

Stages:

- Stage 0 inventory start: `Stage0_batch1.md`
- Stage 0 cleanup before mapping: `Stage0_batch1a.md` ...
  `Stage0_batch1d.md`
- Stage 0 mapping/acceptance: `Stage0_batch2.md` ... `Stage0_batch3.md`
- Stage 1: `Stage1_batch1.md` ... `Stage1_batch4.md`
- Stage 2: `Stage2_batch1.md` ... `Stage2_batch3.md`
- Stage 3: `Stage3_batch1.md` ... `Stage3_batch3.md`
- Stage 4: `Stage4_batch1.md` ... `Stage4_batch3.md`
- Stage 5: `Stage5_batch1.md` ... `Stage5_batch3.md`
- Stage 6: `Stage6_batch1.md` ... `Stage6_batch3.md`
- Stage 7: `Stage7_batch1.md` ... `Stage7_batch5.md`
- Stage 8: `Stage8_batch1.md` ... `Stage8_batch9.md`
- Stage 9: `Stage9_batch1.md` ... `Stage9_batch5.md`
- Stage 10: `Stage10_batch1.md` ... `Stage10_batch5.md`
- Stage 11: `Stage11_batch1.md` ... `Stage11_batch4.md`
- Stage 12: `Stage12_batch1.md` ... `Stage12_batch3.md`
- Stage 13: `Stage13_batch1.md` ... `Stage13_batch3.md`
- Stage 14: `Stage14_batch1.md` ... `Stage14_batch3.md`
- Stage 15: `Stage15_batch1.md` ... `Stage15_batch3.md`
