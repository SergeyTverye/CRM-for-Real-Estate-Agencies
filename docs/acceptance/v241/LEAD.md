# LEAD — приёмка v2.4.1

**Статус: PASS.** ТЗ §2; срез 05.11.2026. Итоговый прогон на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Синтетическое обращение new_need/linked_existing_need без подходящего объекта; Task и дата.

## Действия

Сохранить без задачи, затем с задачей; завершить отказ/спам с причиной; проверить контроль просрочек и историю.

## Ожидаемый результат

Перспективное обращение остаётся в работе с действием; терминальный исход требует причины; no_match не закрывает потребность.

## Фактический результат и свидетельства

Серверные правила и KPI проверены p1a-workflow; протокол P1-А: 11/11. Браузерный маршрут покрыт сквозным E2E и скриншотом 01.

Автотесты: [tests/integration/p1a-workflow.test.ts](../../../tests/integration/p1a-workflow.test.ts); [tests/integration/clients-requests.test.ts](../../../tests/integration/clients-requests.test.ts).

Протокол: [docs/p1a-working-contour.md](../../../docs/p1a-working-contour.md).

E2E и скриншоты: Playwright 13/13 PASS (tests/e2e/v241.spec.ts, tests/e2e/ux-polish.spec.ts); подлинные экраны — docs/vkr/screenshots.md.
