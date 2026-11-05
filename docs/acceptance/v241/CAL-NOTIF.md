# CAL-NOTIF — приёмка v2.4.1

**Статус: PASS проверенных сценариев.** ТЗ §8; срез 05.11.2026. Исторический прогон этапа 1 на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Task, Showing и служебная Task, личное CalendarEvent, Notification, worker active/standby.

## Действия

Сопоставить календарь/Сегодня; перенести и повторить событие; read/snooze; перезапустить worker; проверить приватность.

## Ожидаемый результат

Нет дублирующего показа, личные данные скрыты; срок задачи не меняется snooze; после рестарта догоняет без дублей; standby не пишет.

## Фактический результат и свидетельства

22 unit по модульному протоколу; поздний Docker-протокол подтверждает 2 уведомления до/после и 0 дублей, снимая раннюю неопределённость рестарта. В общем наборе координатора 152/152 есть calendar integration; UI календаря проверен E2E и скриншотом 11; перенос перетаскиванием отдельным браузерным тестом не покрыт (перенос проверен через API). Этап 2 добавил повторы/связанные записи, диалог переноса и счётчики: [UX-протокол](../calendar-ux-p1.md), [QA](../qa-stage2.md).

Автотесты: [tests/unit/calendar-notifications.test.ts](../../../tests/unit/calendar-notifications.test.ts); [tests/unit/notification-worker.test.ts](../../../tests/unit/notification-worker.test.ts); [tests/integration/calendar-notifications.test.ts](../../../tests/integration/calendar-notifications.test.ts); [tests/authorization/calendar-notifications.test.ts](../../../tests/authorization/calendar-notifications.test.ts).

Протокол: [docs/calendar-notifications.md](../../../docs/calendar-notifications.md).

Дополнительное свидетельство: [Docker/worker/restore](../../operations/docker-v241-verification.md).

Актуальные E2E и скриншоты этапа 2: [сводка](../../vkr/test-protocol.md), [приёмка](../stage2-live-ai-ux.md), [реестр](../../vkr/screenshots.md).

Актуализация 05.11.2026: результаты этапа 1 выше сохраняются как история своего SHA. Для текущих ограничений и статусов действует [матрица этапа 2](../stage2-live-ai-ux.md); окончательные числа и SHA — в [единой сводке](../../vkr/test-protocol.md).
