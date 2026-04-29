# Stage 13 Batch 6

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
- Это Stage 13: Remove Legacy Snapshot and Transitional Overlaps.
- Нельзя менять бизнес-логику сайта.
- Нельзя ломать docs/business-rules/*.md.
- Нельзя трогать receipts как домен.
- Нельзя в этой задаче выполнять Stage 14:
  - не делать final diagnostics/E2E/perf hardening как отдельную цель
- Нельзя заново переписывать Stage 1-12 целиком.
- Допустимо убирать только ту legacy-переходность, которая уже реально заменена новой моделью.
- Нельзя делать big refactor “заодно”.
- Сначала проведи точную диагностику по коду, потом вноси минимальные изменения.
- Работай аккуратно в dirty worktree, ничего чужого не откатывай.
- Если меняются файлы приложения — обязательно выполни bump версии по правилам проекта.
```

## Промт

```text
Нужно реализовать только один batch Stage 13:
закрыть legacy messaging/docs drift и adapters without removal path.

Цель:
- привести фактическое состояние messaging к Stage 11/13 contract
- убрать или документально исправить stale claims о `/api/messages/*`
- не ломать `/api/chat/*`, profile, notifications, webpush/FCM

Что нужно сделать:
1. Повторить audit:
   - `server.js`
   - `js/app.95.messenger.js`
   - `tests/e2e/23.messaging-profile-deeplink.spec.js`
   - `docs/architecture/current-state.md`
   - `docs/business-rules/messaging-profile-and-notifications.md`
2. Учесть факт из Batch 1 audit:
   - server-side `/api/messages/*` routes в коде не найдены
   - tests уже ожидают `404` для `/api/messages/dialog`,
     `/api/messages/send`, `/api/messages/mark-read`
   - primary write path: `/api/chat/direct`,
     `/api/chat/conversations/:id/messages`,
     `/api/chat/conversations/:id/delivered`,
     `/api/chat/conversations/:id/read`
3. Если в коде есть реальные legacy messaging adapters, удалить их только при
   confirmed `/api/chat/*` replacement.
4. Если legacy overlap остался только в docs, обновить architecture docs
   как docs-only change:
   - `current-state.md` должен отражать, что `/api/messages/*` уже отсутствует
     в server code, а remaining compatibility risk связан со snapshot fields
     `messages` / `chat*`
   - business rules не менять по смыслу
5. Проверить snapshot protection:
   - `POST /api/data` не должен создавать `messages`, `chatConversations`,
     `chatMessages`, `chatStates`, `userActions`
6. Найти unresolved adapters без removal path за пределами messaging и
   перечислить их для Batch 8, если они не входят в безопасный scope этого batch.

Что нельзя делать:
- не удалять working adapter без замены
- не оставлять два равноправных messaging paths
- не ломать chat/profile semantics ради cleanup
- не начинать Stage 14
- не менять push/FCM бизнес-семантику

После изменений обязательно проверить:
- legacy messaging overlap убран
- unresolved adapters либо удалены, либо имеют явный removal path
- unified messaging stack не сломан
- docs не утверждают, что `/api/messages/*` живет как server-side layer, если
  код это больше не подтверждает

Формат ответа:
1. Что изменил в messaging/adapters/docs.
2. Какие фактические legacy overlaps остались и какой у них removal path.
3. Какие сценарии проверил автоматически.
4. Что нужно проверить вручную после изменений — отдельным чек-листом для обычного пользователя.
5. Остались ли риски.

Если менялись файлы приложения, обязательно выполни:
npm run version:bump -- --change "Удалены legacy messaging overlap и переходные адаптеры"

Если менялись только docs, version bump НЕ выполнять.

После bump проверь, что запись появилась в docs/version-log.html.
```

## Ручная проверка после Prompt

Обязательна.

### Чек-лист для чайника

1. Открой чат.
2. Отправь тестовое сообщение, если это безопасно.
3. Проверь:
   - сообщение уходит
   - чат открывается как раньше
   - после `F5` ничего не теряется
4. Если есть действия с уведомлениями или профилем:
   - быстро проверь, что они тоже не сломались
5. Если после cleanup чат живет “по двум разным сценариям” или перестал работать, batch не закрыт.
