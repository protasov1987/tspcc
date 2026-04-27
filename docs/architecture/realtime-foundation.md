# Realtime Foundation

Этот документ фиксирует общий Stage 12 contract для live/fallback поведения.
Он не меняет бизнес-семантику доменов.

## Core Contract

- Realtime является только сигналом к server refresh.
- Bootstrap, auth restore и router не зависят от live connection.
- Live/fallback reads должны обходить stale cache:
  `force`, `cache: no-store`, `Cache-Control: no-cache` или эквивалентный
  локальный механизм.
- Если targeted hints неполные или refresh не может безопасно примениться
  локально, refresh обязан расшириться до безопасного domain scope.

## Event Envelope

Клиентские handlers должны приводить входящий сигнал к общей форме:

- `eventName`
- `domain`
- `entity`
- `action`
- `id`
- `ids`
- `rev`
- `route`

Одно поле `targetId` не считается достаточным для batch/burst сценариев.
Handlers должны накапливать все affected ids до refresh или явно поднимать
refresh до broader domain scope.

## Scheduler Contract

Для debounce, in-flight, pending и ignore-window действует общее правило:

- эти состояния могут схлопнуть несколько событий в один forced refresh;
- они не имеют права терять affected ids/domains/reasons;
- pending refresh после in-flight должен использовать накопленные hints;
- ignore-window должен ставить delayed retry, а не silently drop событие;
- failed handler/parse/refresh должен ставить fallback там, где возможен
  корректный server read.

## Route-Safe UI Sync

После refresh должны синхронизироваться не только таблицы:

- открытые модалки;
- detail panels;
- comments/files;
- counters, badges, summaries;
- текущий route и query должны сохраняться, если route остался доступным.

## Diagnostics

Live diagnostics используют `[LIVE]` и должны покрывать:

- connect/reconnect/offline/restored;
- parse warning;
- handler warning;
- targeted refresh scheduled/start/done;
- pending/retry after debounce, in-flight or ignore-window;
- fallback scheduled.

Повторяющиеся connection/fallback warnings должны быть ограничены guard'ами или
throttle, чтобы диагностика не превращалась в постоянный шум.
