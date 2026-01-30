# SPA Bootstrap (F5-safe)

Этот документ описывает обязательный порядок загрузки SPA,
который гарантирует корректную работу F5, прямых URL и history.

---

## Definitions

- fullPath = window.location.pathname + window.location.search
- handleRoute(fullPath, options)
- restoreSession() / checkAuth()
- initNavigation() / setupNavigation()

---

## Required Boot Order (MUST)

Порядок шагов ОБЯЗАТЕЛЕН и не подлежит произвольной перестановке:

1. Скрыть весь контент страниц, показать loader / overlay
2. Навесить обработчик window.popstate
   (он вызывает handleRoute(fullPath, { fromHistory: true }))
3. Восстановить сессию (await restoreSession / checkAuth)
4. Инициализировать навигацию (идемпотентно)
5. Вызвать handleRoute(current fullPath, { replace: true, soft: true })
6. Отрендерить целевую страницу внутри route-handler
7. Запустить SSE / live-обновления ПОСЛЕ определения маршрута

Запрещено:
- параллелить эти шаги,
- вызывать render до шага 5.

---

## Routing rules (MUST)

- URL определяет маршрут.
- Неизвестный маршрут → 404 / fallback (после решения по сессии).
- Неавторизованный доступ → login / unauthorized route
  с сохранением returnUrl.

---

## Common failure modes (DO NOT DO THIS)

- Безусловный navigate('/dashboard') при старте
- Рендер dashboard до обработки URL
- Отсутствие popstate
- Повторная инициализация навигации без guard-флагов

---

## Debugging

- Допустимы логи формата:
  [ROUTE] ..., [BOOT] ...
- Логи должны позволять определить,
  на каком этапе bootstrap произошёл сбой.
