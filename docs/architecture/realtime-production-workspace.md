# Realtime Production / Workspace

Этот документ фиксирует текущую realtime-модель второй фазы для:
- `/production/plan`
- `/production/shifts`
- `/production/gantt`
- `/production/delayed`
- `/production/defects`
- `/workspace`
- `/workspace/<id>`

Цель — не допустить возврата к модели, где основной live-path снова строится
через `soft route refresh` и full scope reload для каждого одиночного изменения.

## Канонический Live Path

Основной live-path после Stage 12 cutover:

1. Сервер публикует structured `card.*` события.
2. Клиент принимает событие в общем SSE stream.
3. Клиент нормализует событие в affected ids/hints.
4. Клиент выполняет forced/no-cache server refresh:
   - planning routes читают `/api/production/planning/slice`;
   - workspace/execution routes читают `/api/cards-core/:id` или production scope fallback.
5. Только ответ сервера обновляет client state/store.
6. Активная production/workspace page обновляется route-safe, включая открытые subcontexts.

Правило:
- structured `card.*` — primary live signal, но не рабочий state.
- planning live не подменяет `meta.domainRevisions.productionPlanning`.
- execution live не обходит `expectedFlowVersion -> 409`; realtime только догружает state.

## Что именно считается Primary Path

Primary path уже не должен зависеть от:
- `handleRoute(..., { soft: true })`
- `loadDataWithScope(DATA_SCOPE_PRODUCTION, force: true)`
- полного route rerender как штатного механизма на единичное изменение

Допустимые primary paths:
- `/production/plan`
  - `refreshProductionPlanningRouteLocal()`
  - `/api/production/planning/slice?slice=plan`
- `/workspace`
  - forced `/api/cards-core/:id` refresh + `syncWorkspaceCardRowLive()`
- `/workspace/<id>`
  - forced `/api/cards-core/:id` refresh + `syncWorkspaceCardPageLive()`
- `/production/shifts`
  - `/api/production/planning/slice?slice=shifts`
- `/production/gantt`
  - `/api/production/planning/slice?slice=gantt`
- `/production/delayed`
  - forced card refresh или production scope fallback
- `/production/defects`
  - forced card refresh или production scope fallback

Примечание:
- для части production-страниц второй фазы primary path уже structured,
  но ещё не доведён до fine-grained DOM patch;
- local page rerender допустим как промежуточный primary path внутри страницы,
  если он не запускает route lifecycle заново.

## Fallback / Recovery Path

Старый refresh path сохраняется как recovery-only:

1. `cards:changed`
2. `scheduleProductionLiveRefresh()` / `scheduleWorkspaceLiveRefresh()`
3. `loadDataWithScope(DATA_SCOPE_PRODUCTION, ...)`
4. `refreshWorkspaceUiAfterDataSync(...)` или локальный reroute/soft refresh

Правило:
- fallback нужен только для recovery, desync, stale/conflict и совместимости;
- fallback path не должен снова становиться штатным ответом на каждый обычный action.

## Workspace Action Rules

Для `/workspace/<id>` действуют дополнительные правила:

1. После успешного простого action (`start/pause/resume/reset`) UI обновляется
   через local patch path.
2. Same-tab fallback refresh должен подавляться через `suppressWorkspaceLiveRefresh()`,
   если local patch уже применён.
3. Повторный конкурентный запрос на тот же action по одной и той же операции
   должен блокироваться client-side lock.
4. При `409 "Версия flow устарела"` клиент обязан:
   - использовать server `flowVersion`, если он пришёл,
   - затем выполнять recovery-path.

Правило:
- local action patch не должен ломать `flowVersion` и не должен допускать
  конкурентный второй запрос на ту же операцию.

## State / View Boundary

State mutation и view patch по-прежнему разделены.

Разрешено:
- сначала менять state,
- затем patch-ить только нужную страницу/блок.

Запрещено:
- компенсировать отсутствие корректного state transition только DOM patch;
- возвращать full route refresh как основной механизм live-обновления.

## Что ещё не является финальным идеалом

Вторая фаза зафиксирована в безопасном рабочем состоянии, но не в предельном идеале.

Пока ещё допустимо:
- local page rerender внутри `/production/shifts`
- local page rerender внутри `/production/gantt`
- local page rerender внутри `/production/delayed`
- local page rerender внутри `/production/defects`

Это допустимо, пока:
- не запускается полный route lifecycle,
- не нужен F5,
- не происходит тяжёлая полная перерисовка всего приложения,
- fallback остаётся recovery-only.

## Regression Scenarios

Обязательные smoke-сценарии после изменений во второй фазе:

1. `/production/plan` + `/production/plan`
   - create/update/delete видны без F5
2. `/production/shifts` + `/production/shifts`
   - изменение карточки отражается без F5
3. `/production/gantt/<id>`
   - открытая МК обновляется без F5
4. `/production/delayed` и `/production/defects`
   - список и detail-route обновляются без F5
5. `/workspace` + `/workspace`
   - create/update/delete отражаются без F5
6. `/workspace/<id>`
   - `start/pause/resume` работают быстро
   - repeated cycles не приводят к `Версия flow устарела`
7. Старый recovery-path остаётся рабочим при stale/conflict.
