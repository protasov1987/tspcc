# Realtime Cards Checklist

Короткий regression-smoke checklist для cards-family после изменений в:
- realtime / SSE
- `/cards`
- `/dashboard`
- `/approvals`
- `/provision`
- `/input-control`
- bootstrap / router / login flow

## Межвкладочная проверка

1. `/cards` + `/cards`
   - создать МК -> появляется во второй вкладке без F5
   - изменить МК -> строка обновляется во второй вкладке без F5
   - удалить МК -> строка исчезает во второй вкладке без F5

2. После удаления МК
   - обновить страницу F5
   - карта не должна возвращаться

## Root / Login / Redirect

1. Открыть `/`
   - до логина виден только auth entry

2. Залогиниться из `/`
   - приложение уходит на канонический home route по `landingTab`

3. Проверить equivalence
   - direct `/cards`
   - `/` -> login -> `/cards`
   обе вкладки должны иметь одинаковое поведение live-обновлений

## Карточные страницы

1. `/cards`
   - draft карта видна

2. `/dashboard`
   - draft / not started карта не обязана появляться

3. `/approvals`, `/provision`, `/input-control`
   - при смене stage карта уходит со старой страницы и появляется на новой без F5

## Рендер

1. Изменение одной карты не должно требовать F5
2. Изменение одной карты не должно требовать полного reload страницы
3. Не должно быть дублей строк после create/update/delete
