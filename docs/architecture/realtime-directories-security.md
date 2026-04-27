# Realtime Directories / Security

Этот документ фиксирует текущее realtime-состояние третьей фазы для:
- `/operations`
- `/areas`
- `/departments`
- `/shift-times`
- `/employees`
- `/users`
- `/accessLevels`

Цель — не допустить возврата к модели, где справочники и security-страницы
снова требуют `F5`, ручной reload или общий `renderEverything()`.

## Канонический Live Path

Основной live-path после Stage 12 cutover:

1. Сервер публикует structured события по изменённой сущности.
2. Клиент принимает событие в общем SSE stream через `startCardsSse()`.
3. Клиент нормализует событие в `applyDirectoryEvent(...)` как live hint.
4. Клиент выполняет forced/no-cache server refresh:
   - `directories` через `DATA_SCOPE_DIRECTORIES`;
   - `security` через `/api/security/users` и `/api/security/access-levels`.
5. Только ответ сервера обновляет client state:
   - `ops`
   - `areas`
   - `centers`
   - `productionShiftTimes`
   - `users`
   - `accessLevels`
6. Активная страница обновляется через page-local patch или local page rerender.

Правило:
- structured directory/security events — primary live signal, но не source of truth.
- `applyDirectoryEvent()` не должен напрямую мутировать справочники/security state.
- parse/handler failures должны ставить fallback refresh и логироваться через `[LIVE]`.

## Covered Event Types

В третьей фазе каноническими считаются:

- `directory.operation.created|updated|deleted`
- `directory.area.created|updated|deleted`
- `directory.department.created|updated|deleted`
- `directory.shift-time.created|updated|deleted`
- `directory.employee.updated`
- `security.user.created|updated|deleted`
- `security.access-level.created|updated|deleted`

## Что именно считается Primary Path

Допустимые primary paths для страниц третьей фазы:

- `/operations`
  - forced directories refresh + row/table sync
- `/areas`
  - forced directories refresh + row/table sync
- `/departments`
  - forced directories refresh + row/table sync
  - допустим local table rerender
- `/shift-times`
  - forced directories refresh + `renderProductionShiftTimesPage()`
  - плюс refresh `renderProductionShiftControls()`
- `/employees`
  - forced directories/security refresh + `renderEmployeesPage()`
  - изменение привязки сотрудника к подразделению приходит как
    `directory.employee.updated`, а не как security CRUD
- `/users`
  - forced security refresh + `renderUsersTable()`
- `/accessLevels`
  - forced security refresh + `renderAccessLevelsTable()`

Примечание:
- для части страниц третьей фазы primary path уже row-level patch;
- для остальных допустим local page rerender внутри страницы, если он не запускает route lifecycle заново.

## Dependency Refresh Rules

Изменение справочников влияет не только на собственную таблицу.

Разрешённые dependency refresh-пути:

- `directory.operation`
  - `fillRouteSelectors()`
  - `renderRouteTableDraft()`, если открыт draft route
- `directory.area`
  - `fillRouteSelectors()`
  - `renderOperationsTable()`, если открыта `/operations`
- `directory.department`
  - `fillRouteSelectors()`
  - `renderEmployeesPage()`, если открыта `/employees`
  - `renderRouteTableDraft()`, если открыт draft route
- `directory.shift-time`
  - `renderProductionShiftControls()`
- `directory.employee`
  - `renderEmployeesPage()`
  - `renderDepartmentsTable()`, чтобы счётчики сотрудников были актуальны
- `security.user`
  - `renderEmployeesPage()`
  - `renderDepartmentsTable()`, чтобы счётчики сотрудников были актуальны
  - `renderUsersTable()`
- `security.access-level`
  - `renderAccessLevelsTable()`
  - `renderUsersTable()`, потому что пользователи показывают названия уровней

Правило:
- dependency refresh должен быть целевым и локальным;
- запрещено использовать для этого полный rerender сайта.

## Current User Security Sync

Третья фаза включает мягкую live-синхронизацию прав текущего пользователя.

Если structured событие затрагивает:
- самого `currentUser`
- или его текущий `accessLevel`

то после применения state разрешено:

1. синхронизировать `currentUser.permissions`
2. вызвать `applyNavigationPermissions()`
3. вызвать `syncReadonlyLocks()`
4. если текущий route стал запрещённым —
   выполнить мягкий redirect через router на `getDefaultHomeRoute()`

Правило:
- redirect допустим только если route реально стал forbidden;
- нельзя делать безусловный переход только потому, что пришло security-событие.

## Что принципиально не является частью третьей фазы

Третья фаза сознательно не включает:

- второй bootstrap pipeline
- hidden redirects вне `handleRoute()`
- принудительный logout при изменении прав
- глобальный `renderEverything()`
- агрессивную real-time перестройку всего app shell для чужих пользователей

## Fallback / Recovery

Для страниц третьей фазы fallback остаётся допустимым, но только как recovery:

- local table rerender
- local page rerender
- `ensureRouteSecurityData(..., { force: true })` для `/users`

Правило:
- fallback не должен снова становиться обычным ответом на каждое изменение;
- primary path остаётся structured live event + state apply + targeted page refresh.

## Regression Scenarios

Обязательные smoke-сценарии после изменений в третьей фазе:

1. `/operations` + `/operations`
   - create/update/delete без `F5`
2. `/areas` + `/areas`
   - create/update/delete без `F5`
3. `/departments` + `/departments`
   - create/update/delete без `F5`
4. `/shift-times` + `/shift-times`
   - изменение времени смен и обеда без `F5`
5. `/employees` + `/employees`
   - смена подразделения без `F5`
6. `/users` + `/users`
   - create/update/delete без `F5`
7. `/accessLevels` + `/accessLevels`
   - create/update без `F5`
8. Изменение прав текущего пользователя:
   - если route разрешён, route не меняется
   - если route запрещён, происходит мягкий redirect на home route
