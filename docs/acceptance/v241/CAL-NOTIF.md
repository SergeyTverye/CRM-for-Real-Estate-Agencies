# CAL-NOTIF — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §8; срез 05.11.2026. Итоговый SHA/лог общего прогона: **заполняет координатор**. Это сверка доступных свидетельств, не новый запуск агентом документации.

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Task, Showing и служебная Task, личное CalendarEvent, Notification, worker active/standby.

## Действия

Сопоставить календарь/Сегодня; перенести и повторить событие; read/snooze; перезапустить worker; проверить приватность.

## Ожидаемый результат

Нет дублирующего показа, личные данные скрыты; срок задачи не меняется snooze; после рестарта догоняет без дублей; standby не пишет.

## Фактический результат и свидетельства

22 unit по модульному протоколу; поздний Docker-протокол подтверждает 2 уведомления до/после и 0 дублей, снимая раннюю неопределённость рестарта. В общем наборе координатора 152/152 есть calendar integration; отдельный финальный UI/drag-протокол ещё в процессе.

Автотесты: [tests/unit/calendar-notifications.test.ts](../../../tests/unit/calendar-notifications.test.ts); [tests/unit/notification-worker.test.ts](../../../tests/unit/notification-worker.test.ts); [tests/integration/calendar-notifications.test.ts](../../../tests/integration/calendar-notifications.test.ts); [tests/authorization/calendar-notifications.test.ts](../../../tests/authorization/calendar-notifications.test.ts).

Протокол: [docs/calendar-notifications.md](../../../docs/calendar-notifications.md).

Дополнительное свидетельство: [Docker/worker/restore](../../operations/docker-v241-verification.md).

E2E и скриншоты: **в процессе**, ссылки и результаты добавляет координатор. PASS отдельных серверных правил не означает PASS браузерной приёмки.
