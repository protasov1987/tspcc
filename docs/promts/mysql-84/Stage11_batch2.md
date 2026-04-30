# MySQL 8.4 Stage 11 Batch 2

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
- Это MySQL 8.4 Stage 11: Realtime, Audit and Outbox Finalization.
- Можно менять только realtime/audit/outbox SQL finalization scope.
- Нельзя делать realtime source of correctness.
- Начинать implementation можно только если domain SQL cutovers Stage 5-10
  accepted. Не использовать outbox/live как workaround для домена, который ещё
  не имеет SQL source of truth.
- Если меняются файлы сайта, выполни version bump.
```

## Промт

```text
Нужно выполнить Stage 11 Batch 2: реализовать outbox/audit/realtime finalized
over committed SQL state.

Что сделать:
1. Implement outbox table or equivalent reliable post-commit signal.
2. Ensure domain commands create audit/outbox events inside transaction where
   required.
   Include directories/security commands from Stage 6 without changing their
   permission or conflict semantics.
3. Emit live events only after commit.
4. Standardize live payload:
   domain, entity, id, rev/version, event type, timestamp.
5. Ensure live only signals targeted refresh.
6. Preserve diagnostics `[LIVE]`, `[DATA]`, `[CONFLICT]`, `[DB]`.

Что нельзя делать:
- не emit success event before commit;
- не use live as write confirmation;
- не make failed transaction emit success refresh.

Проверки:
- live event after commit;
- no event on rollback;
- multi-client refresh;
- realtime unavailable fallback.

Формат ответа:
1. Outbox/audit implementation.
2. Event payload contract.
3. Post-commit proof.
4. Tests/checks run.
5. Remaining risks.
```

## Ручная проверка после Prompt

Проверить multi-client refresh and app behavior with live unavailable if easy.
