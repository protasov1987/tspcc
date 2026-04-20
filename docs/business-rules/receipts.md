# Business Rules: Receipts

Этот документ фиксирует текущее рабочее поведение маршрута приемки.

Домен по текущему коду выглядит заметно менее зрелым, чем cards или production,
но это не означает, что его можно ломать без последствий.

---

## Scope

- `/receipts`
- `/receipts/:id`
- permission `receipts`
- list -> detail modal navigation

---

## Current Business Invariants

- Маршрут приемки является отдельным экраном сайта.
- Доступ к нему должен зависеть от permission `receipts`.
- `/receipts` открывает список приемок.
- `/receipts/:id` открывает detail-контекст конкретной приемки.
- Если приемка с таким `id` отсутствует, пользователь должен вернуться на
  `/receipts`, а не оказаться на произвольном другом маршруте.
- Если данных нет, экран должен корректно показывать empty state, а не падать.

---

## Critical Flows To Preserve

### List view

- Пользователь с правом `receipts` должен открыть список приемок.
- Список должен оставаться кликабельным переходом в detail route.

### Detail route

- Переход по `/receipts/:id` должен открывать detail-контекст именно этой приемки.
- Закрытие modal/detail не должно ломать history и маршрутный контекст.

---

## Forbidden Regressions

- Нельзя потерять permission guard для `receipts`.
- Нельзя сломать deep route `/receipts/:id`.
- Нельзя редиректить пользователя с несуществующей приемки на unrelated page.
- Нельзя ломать empty state для случая без данных.

---

## Transitional Constraints

- По текущему аудиту receipts выглядит как отдельный low-maturity маршрут,
  слабо интегрированный в основную доменную модель.
- Если домен будет развиваться, его лучше сразу переводить в явную domain model,
  а не расширять ad-hoc logic вокруг `store.receipts`.
