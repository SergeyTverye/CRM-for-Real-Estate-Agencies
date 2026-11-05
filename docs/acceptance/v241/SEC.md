# SEC — приёмка v2.4.1

**Статус: PASS.** ТЗ §10.1; срез 05.11.2026. Исторический прогон этапа 1 на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Два риелтора, manager, свои/чужие клиенты, сделки, документы; действующий и отозванный grant.

## Действия

Запросить чужие ID, вложенные DTO, global search, экспорт и прямой файл; повторить после отзыва доступа.

## Ожидаемый результат

Чужие ПДн/FK отсутствуют, недоступная запись 404, функция роли 403; публичная связь не открывает закрытый файл.

## Фактический результат и свидетельства

P0: 69/69, включая 50 PostgreSQL и 19 контрактных проверок. Новые зоны покрыты отдельными authorization-тестами; единый финальный прогон всех authorization-тестов выполнен в составе integration+authorization 163/163 на `8d30d92`; E2E проверяет, что realtor2 не открывает клиента realtor1 по прямому URL; независимое ревью маршрутов (OpenCode iceman, 05.11.2026) путей раскрытия ПДн и IDOR не нашло.

Автотесты: [tests/authorization/p0-nested-dto.test.ts](../../../tests/authorization/p0-nested-dto.test.ts); [tests/authorization/p0-dto-contract.test.ts](../../../tests/authorization/p0-dto-contract.test.ts); [tests/authorization/property-search.test.ts](../../../tests/authorization/property-search.test.ts); [tests/authorization/ai-settings.test.ts](../../../tests/authorization/ai-settings.test.ts); [tests/authorization/calendar-notifications.test.ts](../../../tests/authorization/calendar-notifications.test.ts); [tests/authorization/property-media.test.ts](../../../tests/authorization/property-media.test.ts).

Протокол: [docs/security-review.md](../../../docs/security-review.md).

Дополнительное свидетельство: [Docker/worker/restore](../../operations/docker-v241-verification.md).

Актуальные E2E и скриншоты этапа 2: [сводка](../../vkr/test-protocol.md), [приёмка](../stage2-live-ai-ux.md), [реестр](../../vkr/screenshots.md).

Актуализация 05.11.2026: результаты этапа 1 выше сохраняются как история своего SHA. Для текущих ограничений и статусов действует [матрица этапа 2](../stage2-live-ai-ux.md); окончательные числа и SHA — в [единой сводке](../../vkr/test-protocol.md).
