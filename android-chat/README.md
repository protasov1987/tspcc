# TSPCC Android Chat

Android-клиент чата для сайта. Реализует список диалогов, чат 1:1, диалог с системой, SSE и FCM (после добавления `google-services.json`).

## Шаги запуска

1) Добавьте `google-services.json` в папку:
- `android-chat/app/google-services.json`

2) Откройте папку `android-chat` в Android Studio.

3) Сделайте Sync Gradle.

4) Запустите приложение на устройстве/эмуляторе.

## Base URL

По умолчанию используется:
- `https://tspcc.ru`

Изменить можно на экране входа в поле **Base URL** или в **Настройках**.

## Настройки

Экран **Настройки** позволяет:
- изменить Base URL;
- указать путь для регистрации FCM токена (если сервер добавит такой endpoint);
- посмотреть текущие `userId`, `csrfToken` и `FCM token`.

## Проверка SSE

SSE подключается к:
- `GET /api/chat/stream`

При получении события `message_new` чат обновляет список сообщений. Если новые сообщения приходят вне текущего диалога — обновляется список диалогов.

## Проверка FCM

FCM работает только после добавления `google-services.json`.

- Токен сохраняется локально.
- Серверного эндпоинта для регистрации FCM токена в репозитории нет. Поэтому приложение не падает, а просто хранит токен.
- Если endpoint появится, укажите путь в **Настройках** (например `/api/fcm/subscribe`).

## Используемые API (фактические)

- `POST /api/login` — логин по паролю
- `GET /api/session` — проверка сессии
- `GET /api/chat/users` — список диалогов/пользователей
- `POST /api/chat/direct` — создать/получить direct-диалог
- `GET /api/chat/conversations/{id}/messages` — история сообщений
- `POST /api/chat/conversations/{id}/messages` — отправка сообщения
- `POST /api/chat/conversations/{id}/read` — отметка прочтения
- `POST /api/chat/conversations/{id}/delivered` — отметка доставки
- `GET /api/chat/stream` — SSE

## Примечания

- Диалог с системой: `userId = system`.
- Если список пользователей недоступен, можно открыть диалог по userId вручную в списке диалогов.

## Иконка приложения (favicon)

Android не принимает SVG напрямую как launcher icon. Чтобы использовать favicon сайта:

1) Откройте `favicon.svg` из корня репозитория в любом редакторе.
2) Экспортируйте в PNG (например 1024×1024).
3) В Android Studio: **File → New → Image Asset** → выберите PNG → Next → Finish.

Это заменит `ic_launcher`/`ic_launcher_round` на иконку из favicon.
