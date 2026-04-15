# Realtime Production / Workspace Checklist

Короткий regression-smoke checklist для второй фазы после изменений в:
- `production/*`
- `workspace`
- workspace action flows
- production/workspace SSE и fallback refresh

## Production Plan

1. `/production/plan` + `/production/plan`
   - создать подходящую МК -> появляется без F5
   - изменить МК -> обновляется без F5
   - удалить МК -> исчезает без F5

2. Queue / card view
   - queue view обновляется без F5
   - если открыта карточка в card view, её изменения видны без F5

## Production Shifts

1. `/production/shifts` + `/production/shifts`
   - изменение карточки отражается без F5
   - нет необходимости в F5 или ручном route reload

## Production Gantt

1. `/production/gantt/<id>`
   - изменение открытой МК видно без F5
   - удаление открытой МК переводит страницу в корректное состояние

## Delayed / Defects

1. `/production/delayed`
   - карточка появляется/исчезает без F5

2. `/production/defects`
   - карточка появляется/исчезает без F5

3. Detail-route
   - `/production/delayed/<qr>`
   - `/production/defects/<qr>`
   изменения видны без F5

## Workspace List

1. `/workspace` + `/workspace`
   - create/update/delete МК отражаются без F5
   - нет дублей карточек

2. Поиск и раскрытые `<details>`
   - не должны бессмысленно теряться на единичном обновлении

## Workspace Card

1. `/workspace/<id>`
   - `Начать`
   - `Пауза`
   - `Продолжить`
   - `Завершить`
   должны отрабатывать без F5

2. Несколько циклов подряд
   - `Пауза -> Продолжить -> Пауза -> Продолжить`
   не должны приводить к ошибке `Версия flow устарела`

3. Modal flows
   - `Сушить`
   - `Выдача материала`
   - `Возврат материала`
   - `Идентификация`
   - `transfer`
   - `documents upload`
   должны обновлять UI без F5

## Recovery

1. При stale/conflict
   - UI не ломается
   - recovery-path приводит страницу в корректное состояние

2. После F5
   - состояние совпадает с тем, что было после последнего успешного действия
