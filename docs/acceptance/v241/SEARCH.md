# SEARCH — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §3, §3.1; срез 05.11.2026. Итоговый прогон на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Русский запрос, И/ИЛИ, цена/площадь на границах, -1/6, неопределённый этаж, частное лицо, отрицания признаков.

## Действия

Разобрать запрос; исправить фильтры; выполнить поиск fixtures; проверить confirmed/needs_review/rejected и цитаты.

## Ожидаемый результат

Назначения/районы ИЛИ, группы И; -1/6 не первый; unknown не подтверждён; собственник только по проверке.

## Фактический результат и свидетельства

76/76 unit домена/адаптера и 25 application/regression проверок по протоколам. Живые parse 3 completed. Сквозной браузерный маршрут покрыт E2E; интерактивное уточнение фильтров ИИ в браузере не проверялось (в E2E AI выключен), живой разбор подтверждён smoke-вызовами.

Автотесты: [tests/unit/property-search/domain.test.ts](../../../tests/unit/property-search/domain.test.ts); [tests/unit/property-search/regressions.test.ts](../../../tests/unit/property-search/regressions.test.ts); [tests/integration/property-search.test.ts](../../../tests/integration/property-search.test.ts); [tests/unit/ai/provider-parse.test.ts](../../../tests/unit/ai/provider-parse.test.ts).

Протокол: [docs/integrations/property-search-application.md](../../../docs/integrations/property-search-application.md).

E2E и скриншоты: Playwright 13/13 PASS (tests/e2e/v241.spec.ts, tests/e2e/ux-polish.spec.ts); подлинные экраны — docs/vkr/screenshots.md.
