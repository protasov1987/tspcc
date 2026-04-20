# Change Checklist

Этот документ задает обязательный checklist для любой задачи, которая меняет
код сайта. Он нужен не для бюрократии, а для того, чтобы Codex и люди не
ломали текущую рабочую бизнес-логику на пути к target architecture.

Использовать вместе с:

- `docs/architecture/current-state.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/migration-plan.md`
- `docs/business-rules/*.md`

---

## 1. Universal Check Before Any Change

- Определи, какой домен реально затрагивается:
  routing/bootstrap, cards, approvals, files, directories, security,
  production, workspace, workorders, receipts, messaging, profile, notifications.
- Проверь текущий `business-rules` документ по этому домену.
- Проверь, не усиливает ли изменение legacy-механизм, который target state
  требует постепенно убирать.
- Если задача архитектурная, не смешивай в одном изменении сразу несколько
  больших слоев:
  router, bootstrap, write model, realtime, perf.
- Если изменение меняет пользовательский смысл операции, это должно быть
  отдельным явным решением, а не побочным эффектом рефакторинга.

---

## 2. Universal Check After Any Change

- Текущий пользовательский сценарий по затронутому домену все еще работает.
- Доступы и ограничения по ролям не ослаблены случайно.
- Ошибки и конфликты остаются понятными для пользователя.
- Маршрут пользователя не теряется без явной причины.
- Логи диагностики не стали беднее в затронутой зоне.
- Нет нового скрытого обходного механизма рядом с уже существующим.

---

## 3. If Routing / Bootstrap / Auth Changed

- `window.location.pathname + window.location.search` по-прежнему определяют экран.
- Нет forced redirect на dashboard или другой home screen при boot.
- `restoreSession()` / `checkAuth()` завершается до рендера защищенной страницы.
- Пока сессия не восстановлена, показывается только loader / overlay.
- `popstate` по-прежнему приводит к `handleRoute(fullPath, { fromHistory: true, ... })`.
- `F5` работает минимум на:
  - `/dashboard`
  - `/cards`
  - `/cards/<id>`
  - `/profile/<id>`
  - `/production/plan`
  - `/workspace`
- Direct URL entry работает без прыжка на другой экран.
- Back / Forward не требуют `F5`.
- `landingTab` access level по-прежнему влияет на домашний маршрут.
- `/profile/:id` все еще открывается только для самого пользователя.
- Сохранились или расширены `[BOOT]` и `[ROUTE]` логи.
- Если менялся bootstrap order, обновлен `docs/architecture/spa-boot.md`.

---

## 4. If Cards / Approvals / Card Files Changed

- Новая карточка все еще создается как `DRAFT`.
- Отправка на согласование все еще переводит карту в `ON_APPROVAL`.
- Reject все еще требует причину и переводит карту в `REJECTED`.
- Возврат отклоненной карты в работу не теряет причину и комментарии.
- Полное согласование все еще приводит к `APPROVED`.
- Входной контроль и обеспечение доступны только на допустимых approval stages.
- Комбинация input control + provision по-прежнему правильно переводит карту в:
  - `WAITING_INPUT_CONTROL`
  - `WAITING_PROVISION`
  - `PROVIDED`
- Архивирование остается soft, если задача не меняет это осознанно.
- Repeat из архива все еще создает новую draft-карту, а не разархивирует старую.
- Удаление карточки не оставляет битые production task references.
- Card logs и audit trail не теряются.
- Для файлов карточки проверено:
  - upload
  - delete
  - resync
  - корректность обновления ссылок на input-control file
  - запрет duplicate `PARTS_DOCS` name
- Если вводится новый card write endpoint:
  - клиент передает `expectedRev`
  - сервер сравнивает ревизию
  - mismatch дает `409`
  - клиент остается на текущем маршруте
  - выполняется точечный refresh карточки

---

## 5. If Directories / Security Changed

- Подразделение по-прежнему нельзя удалить, если к нему привязаны сотрудники.
- Изменение operation type все еще блокируется при наличии плановых карт с
  активной операцией не в `NOT_STARTED`.
- Исторические карточки не теряют текстовые значения при удалении справочника.
- Areas и shift times продолжают корректно влиять на production UI.
- Users и access levels проверены минимум на:
  - create
  - edit
  - delete
  - permissions application
- `Abyss` все еще защищен от удаления и деградации прав.
- Парольная валидация и уникальность не ослаблены.
- Edit permission по-прежнему не дает меньше прав, чем view.
- `landingTab` и `inactivityTimeoutMinutes` по-прежнему сохраняются и применяются.
- Маршруты `/users`, `/accessLevels`, `/profile/:id` не теряют защиту по доступу.
- Если directory/security write переводится на новый endpoint:
  - права проверяются сервером
  - при конкурентном редактировании есть revision / conflict contract

---

## 6. If Production / Workspace / Workorders Changed

- В планирование по-прежнему попадают только допустимые карты:
  неархивные `MKI` с планируемыми операциями и корректной approval stage.
- Workspace по-прежнему показывает только карты, реально подходящие под текущую
  смену и текущие ограничения ролей.
- Операцию все еще нельзя начать или завершить в недопустимом состоянии.
- Blocking rules по предыдущим операциям, образцам, сушке, материалам и
  статусам flow не ослаблены случайно.
- Для flow-операций по-прежнему используется `expectedFlowVersion`.
- Серверный stale-version по-прежнему возвращает `409`.
- После `409` пользователь остается в текущем рабочем контексте.
- После `409` выполняется targeted refresh production/workspace scope.
- Проверены действия минимум на success-path и conflict-path для измененной зоны:
  - start / pause / resume / reset
  - identify / transfer
  - material issue / return
  - drying
  - defect / repair / dispose
- Если менялась логика delayed/defects:
  - обязательные файлы и вложения все еще требуются там, где это было правилом
  - ремонт через `МК-РЕМ` не ломается
- Если менялась логика workorders/archive/items:
  - `/workorders`
  - `/workorders/:qr`
  - `/archive`
  - `/archive/:qr`
  - `/items`
  - `/ok`
  - `/oc`
  продолжают показывать корректные данные и не теряют навигацию

---

## 7. If Receipts Changed

- `/receipts` по-прежнему открывается только при наличии permission `receipts`.
- Список приемок корректно рендерится в empty-state и non-empty-state.
- Переход в `/receipts/:id` по-прежнему открывает detail route именно нужной приемки.
- Если `id` не найден, пользователь возвращается на `/receipts`, а не на
  произвольный маршрут.
- Закрытие detail/modal не ломает history-навигацию.

---

## 8. If Messaging / Profile / Notifications Changed

- Пользователь по-прежнему может открыть только свой `/profile/:id`.
- Query params `openChatWith` / `conversationId` по-прежнему могут открыть
  нужный диалог из уведомления или ссылки.
- Нельзя инициировать диалог с системным пользователем.
- Delivered / read / unread состояния не теряются.
- Оптимистичная отправка сообщения откатывается корректно при ошибке.
- User actions log в профиле продолжает работать.
- WebPush проверен минимум на:
  - subscribe
  - unsubscribe
  - test push
- Если менялся messaging API, не создан третий параллельный message pipeline.

---

## 9. If Realtime Changed

- Приложение по-прежнему остается корректным без realtime.
- Bootstrap не начинает зависеть от live-соединения.
- Live update инициирует точечный refresh или явный fallback refresh, а не
  полную необъяснимую перезагрузку приложения.
- Нет offline/noise spam в логах.
- Live diagnostics остаются понятными.
- Realtime не подменяет conflict-control.
- Для измененного домена проверен минимум один multi-client сценарий.

---

## 10. Testing Requirements

- Если менялся критичный маршрут, есть локальная проверка:
  direct URL, `F5`, back/forward.
- Если менялся новый write-механизм, есть проверка:
  success-path, conflict-path, route stability.
- Если менялась production/workspace логика, проверен минимум один
  конкурентный сценарий.
- Если менялась карточка, проверены approvals, files и связанные представления.
- Если менялся `receipts`, проверены list route, deep route и permission guard.
- Если менялась security-модель, проверены права и запреты, а не только happy path.
- Если текущих E2E недостаточно, тесты добавлены или обновлены.

---

## 11. Docs and Delivery

- Если изменение меняет current behavior, обновлен `docs/architecture/current-state.md`
  или нужный `docs/business-rules/*.md`.
- Если изменение двигает систему к target architecture, обновлены:
  - `docs/architecture/migration-plan.md`
  - при необходимости `docs/architecture/target-architecture.md`
- Если менялся bootstrap order, обновлен `docs/architecture/spa-boot.md`.
- Если менялись site files, выполнен
  `npm run version:bump -- --change "<краткое описание на русском>"`.
- Если изменены только docs/non-site files, version bump не нужен.

---

## 12. Final Exit Questions

- Я сохранил текущий бизнес-смысл, а не только "починил код"?
- Я не усилил legacy-подход там, где уже есть более правильная доменная модель?
- Я не смешал несколько крупных архитектурных шагов в одном изменении?
- Пользователь после моей правки все еще остается на правильном маршруте,
  с правильными правами и предсказуемым состоянием данных?
