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

Основной live-path для второй фазы:

1. Сервер публикует structured `card.*` события.
2. Клиент принимает событие в общем SSE stream.
3. Клиент применяет событие через `applyServerEvent()`.
4. Обновляется client state/store.
5. Активная production/workspace page обновляется через page-local patch path.

Правило:
- structured `card.*` — primary live trigger для production/workspace страниц второй фазы.

## Что именно считается Primary Path

Для второй фазы primary path уже не должен зависеть от:
- `handleRoute(..., { soft: true })`
- `loadDataWithScope(DATA_SCOPE_PRODUCTION, force: true)`
- полного route rerender как штатного механизма на единичное изменение

Допустимые primary paths:
- `/production/plan`
  - `syncProductionPlanQueueCardButtonLive()`
  - `syncProductionPlanCardViewLive()`
- `/workspace`
  - `syncWorkspaceCardRowLive()`
- `/workspace/<id>`
  - `syncWorkspaceCardPageLive()`
- `/production/shifts`
  - local page rerender через `renderProductionShiftBoardPage()`
- `/production/gantt`
  - local page rerender через `renderProductionGanttPage()`
- `/production/delayed`
  - local page rerender через `renderProductionDelayedPage()`
- `/production/defects`
  - local page rerender через `renderProductionDefectsPage()`

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
