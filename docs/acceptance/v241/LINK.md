# LINK — приёмка v2.4.1

**Статус: PASS.** ТЗ §3.2; срез 05.11.2026. Итоговый прогон на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Доступная/чужая потребность, listing с полным/неполным ID, несколько кандидатов.

## Действия

Закладка → кандидат → явный перенос → повтор переноса → отдельное предложение → КП; проверить чужую needId.

## Ожидаемый результат

До переноса нет Property, до предложения нет Match; повтор не плодит дубли; права проверяются при каждом действии.

## Фактический результат и свидетельства

Проверки persistence, snapshot, повторов и RBAC входят в 25 проверок поиска. Браузерный маршрут подборки покрыт сквозным E2E и скриншотом 08.

Автотесты: [tests/integration/property-search.test.ts](../../../tests/integration/property-search.test.ts); [tests/authorization/property-search.test.ts](../../../tests/authorization/property-search.test.ts).

Протокол: [docs/integrations/property-search-application.md](../../../docs/integrations/property-search-application.md).

E2E и скриншоты: Playwright 13/13 PASS (tests/e2e/v241.spec.ts, tests/e2e/ux-polish.spec.ts); подлинные экраны — docs/vkr/screenshots.md.
