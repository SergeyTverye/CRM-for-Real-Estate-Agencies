# SEC — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §10.1; срез 05.11.2026. Итоговый SHA/лог общего прогона: **заполняет координатор**. Это сверка доступных свидетельств, не новый запуск агентом документации.

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Два риелтора, manager, свои/чужие клиенты, сделки, документы; действующий и отозванный grant.

## Действия

Запросить чужие ID, вложенные DTO, global search, экспорт и прямой файл; повторить после отзыва доступа.

## Ожидаемый результат

Чужие ПДн/FK отсутствуют, недоступная запись 404, функция роли 403; публичная связь не открывает закрытый файл.

## Фактический результат и свидетельства

P0: 69/69, включая 50 PostgreSQL и 19 контрактных проверок. Новые зоны покрыты отдельными authorization-тестами; единый финальный SEC-прогон всей интеграции ещё не оформлен.

Автотесты: [tests/authorization/p0-nested-dto.test.ts](../../../tests/authorization/p0-nested-dto.test.ts); [tests/authorization/p0-dto-contract.test.ts](../../../tests/authorization/p0-dto-contract.test.ts); [tests/authorization/property-search.test.ts](../../../tests/authorization/property-search.test.ts); [tests/authorization/ai-settings.test.ts](../../../tests/authorization/ai-settings.test.ts); [tests/authorization/calendar-notifications.test.ts](../../../tests/authorization/calendar-notifications.test.ts); [tests/authorization/property-media.test.ts](../../../tests/authorization/property-media.test.ts).

Протокол: [docs/security-review.md](../../../docs/security-review.md).

Дополнительное свидетельство: [Docker/worker/restore](../../operations/docker-v241-verification.md).

E2E и скриншоты: **в процессе**, ссылки и результаты добавляет координатор. PASS отдельных серверных правил не означает PASS браузерной приёмки.
