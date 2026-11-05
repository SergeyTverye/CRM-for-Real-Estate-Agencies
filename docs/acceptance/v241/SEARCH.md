# SEARCH — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §3, §3.1; срез 05.11.2026. Итоговый SHA/лог общего прогона: **заполняет координатор**. Это сверка доступных свидетельств, не новый запуск агентом документации.

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Русский запрос, И/ИЛИ, цена/площадь на границах, -1/6, неопределённый этаж, частное лицо, отрицания признаков.

## Действия

Разобрать запрос; исправить фильтры; выполнить поиск fixtures; проверить confirmed/needs_review/rejected и цитаты.

## Ожидаемый результат

Назначения/районы ИЛИ, группы И; -1/6 не первый; unknown не подтверждён; собственник только по проверке.

## Фактический результат и свидетельства

76/76 unit домена/адаптера и 25 application/regression проверок по протоколам. Живые parse 3 completed. Полный браузерный маршрут и интерактивные уточнения ещё в процессе.

Автотесты: [tests/unit/property-search/domain.test.ts](../../../tests/unit/property-search/domain.test.ts); [tests/unit/property-search/regressions.test.ts](../../../tests/unit/property-search/regressions.test.ts); [tests/integration/property-search.test.ts](../../../tests/integration/property-search.test.ts); [tests/unit/ai/provider-parse.test.ts](../../../tests/unit/ai/provider-parse.test.ts).

Протокол: [docs/integrations/property-search-application.md](../../../docs/integrations/property-search-application.md).

E2E и скриншоты: **в процессе**, ссылки и результаты добавляет координатор. PASS отдельных серверных правил не означает PASS браузерной приёмки.
