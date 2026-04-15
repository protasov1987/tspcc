# Realtime Cards

Этот документ фиксирует каноническую realtime-модель для семейства `cards`.
Цель — не допустить возврата к смешанной логике, где domain state,
fallback refresh и page patch конкурируют друг с другом.

## Канонический Live Path

Основной путь live-обновления для `cards` family:

1. Сервер публикует структурированное событие:
   - `card.created`
   - `card.updated`
   - `card.deleted`
   - `card.files-updated`
2. Клиент принимает событие в `startCardsSse()`.
3. Клиент применяет событие через `applyServerEvent()`.
4. Обновляется client state/store.
5. View обновляется через:
   - `syncCardsRowLive()`
   - `syncDashboardRowLive()`
   - `syncApprovalsRowLive()`
   - `syncProvisionRowLive()`
   - `syncInputControlRowLive()`
   или через соответствующие `remove*RowLive()`.

Правило:
- `card.*` events — единственный канонический structured live-path.

## Fallback / Resync Path

Старый совместимый путь остаётся только как fallback/resync:

1. Сервер публикует `cards:changed`.
2. Клиент запускает `scheduleCardsLiveRefresh()`.
3. Клиент получает summary через `/api/cards-live`.
4. Summary применяется через `applyCardsLiveSummary()`.

Правило:
- `cards:changed` и `applyCardsLiveSummary()` не являются primary page patch controller.
- fallback-путь нужен только для resync, потери событий и совместимости.

## State Mutation Rules

Правильный порядок для локальных действий:

1. Изменить domain state на клиенте.
2. Вызвать `saveData()`.
3. Выполнить page patch для уже корректного state transition.

Запрещено:
- полагаться только на DOM patch без изменения domain state;
- менять UI так, как будто сущность удалена/создана, если state ещё не изменён;
- вызывать `saveData()` до того, как state отражает реальное действие пользователя.

Следствие:
- удаление карты должно убирать карту из `cards` до `saveData()`,
  иначе серверный diff не сгенерирует `card.deleted`.

## Page Patch Rules

Page patch helpers работают только на view layer.

Разрешено:
- вставить/обновить/удалить строку;
- пересчитать локальную таблицу;
- обновить счётчики, статус, stage.

Запрещено:
- считать page patch helper источником истины;
- использовать page patch helper как замену domain mutation.

## Root Route / Bootstrap Rules

`/` не является business page route.

Правильная модель:
- `/` до логина — auth entry;
- `/` после логина — redirect внутри router на home route пользователя;
- home route выбирается из прав (`permissions.landingTab`);
- если router сделал внутренний redirect, bootstrap обязан продолжать по
  каноническому текущему route, а не по устаревшему pre-redirect path.

Правило:
- direct `/cards` и redirected `/cards` после `/` -> login должны быть
  эквивалентны по bootstrap и live-поведению.

## Regression Scenarios

Обязательные smoke-сценарии после любых изменений в cards/router/bootstrap:

1. `/cards` + `/cards`: create/update/delete между вкладками.
2. `/` -> login -> canonical home route.
3. direct `/cards` работает так же, как redirected `/cards`.
4. delete card не возвращается после F5.
5. draft card видна на `/cards` и не обязана быть видна на `/dashboard`.
6. единичное card-событие не требует полного перерендеривания страницы.
