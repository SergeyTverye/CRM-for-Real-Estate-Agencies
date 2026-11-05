# SEARCH — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §3, §3.1; срез 05.11.2026. Исторический прогон этапа 1 на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Русский запрос, И/ИЛИ, цена/площадь на границах, -1/6, неопределённый этаж, частное лицо, отрицания признаков.

## Действия

Разобрать запрос; исправить фильтры; выполнить поиск fixtures; проверить confirmed/needs_review/rejected и цитаты.

## Ожидаемый результат

Назначения/районы ИЛИ, группы И; -1/6 не первый; unknown не подтверждён; собственник только по проверке.

## Фактический результат и свидетельства

76/76 unit домена/адаптера и 25 application/regression проверок по протоколам. Живые parse 3 completed. Сквозной браузерный маршрут покрыт E2E; в этапе 2 живой разбор и уточнение подтверждены ответами LIVE, JSON и подлинными снимками; результативность web-карточек остаётся PARTIAL.

Автотесты: [tests/unit/property-search/domain.test.ts](../../../tests/unit/property-search/domain.test.ts); [tests/unit/property-search/regressions.test.ts](../../../tests/unit/property-search/regressions.test.ts); [tests/integration/property-search.test.ts](../../../tests/integration/property-search.test.ts); [tests/unit/ai/provider-parse.test.ts](../../../tests/unit/ai/provider-parse.test.ts).

Протокол: [docs/integrations/property-search-application.md](../../../docs/integrations/property-search-application.md).

Актуальные E2E и скриншоты этапа 2: [сводка](../../vkr/test-protocol.md), [приёмка](../stage2-live-ai-ux.md), [реестр](../../vkr/screenshots.md).

Актуализация 05.11.2026: результаты этапа 1 выше сохраняются как история своего SHA. Для текущих ограничений и статусов действует [матрица этапа 2](../stage2-live-ai-ux.md); окончательные числа и SHA — в [единой сводке](../../vkr/test-protocol.md).
