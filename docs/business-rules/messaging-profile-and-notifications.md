# Business Rules: Messaging, Profile and Notifications

Этот документ фиксирует текущий бизнес-смысл профиля пользователя, встроенного
мессенджера и push-уведомлений.

---

## Scope

- `/profile/:id`
- direct chat
- delivered / read / unread state
- user actions log
- webpush
- FCM token registration

---

## Actors

- Авторизованный пользователь
- Собеседник в direct chat
- Системный пользователь
- Администратор

---

## Current Business Invariants

- Профиль пользователя является приватным маршрутом:
  открыть можно только собственный `/profile/:id`.
- Мессенджер является встроенной частью профиля, а не отдельной публичной страницей.
- Система поддерживает direct user-to-user messaging.
- Диалог с системным пользователем инициировать нельзя.
- Сообщения имеют рабочие delivered/read/unread состояния.
- User actions log в профиле является действующей частью пользовательского контекста.
- Push-подписки и FCM-токены относятся к конкретному пользователю и его профилю.
- Уведомление может вести пользователя сразу в профильный чат через query params.

---

## Critical Flows To Preserve

### Open chat

- Пользователь должен иметь возможность открыть диалог из профиля.
- Если чат открыт по параметрам `openChatWith` и `conversationId`,
  должен открыться правильный рабочий контекст.

### Send message

- Сообщение должно доставляться в текущий conversation context.
- Оптимистичная отправка не должна оставлять permanent fake message при ошибке.

### Read and delivered updates

- Delivered и read state должны обновляться для правильного диалога.
- Unread counters и пользовательские индикаторы не должны теряться.

### Notifications

- Пользователь должен иметь возможность подписаться на push-уведомления,
  отписаться и отправить test push.

### User activity

- User actions log должен оставаться связанным с пользователем и его профилем.

---

## Forbidden Regressions

- Нельзя ослабить приватность `/profile/:id`.
- Нельзя снова разрешить писать системному пользователю.
- Нельзя терять delivered/read semantics при рефакторинге UI или SSE.
- Нельзя ломать deeplink в чат через query params.
- Нельзя создавать еще один параллельный message API поверх уже существующего overlap.

---

## Transitional Constraints

- В коде одновременно существуют современный `/api/chat/*` и legacy
  `/api/messages/*` слои.
- Пока legacy не убран осознанно, новый код должен опираться на основной
  текущий `/api/chat/*` путь и не усиливать overlap.
- Realtime здесь вспомогателен, но пользовательский смысл delivered/read
  и notification deep links должен сохраняться и без полной зависимости от live.
