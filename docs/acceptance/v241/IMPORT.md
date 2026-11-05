# IMPORT — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §11; срез 05.11.2026. Итоговый прогон на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Синтетический workbook с секциями/маркерами, неоднозначностями, дублями и запрещёнными ПДн. Реального Excel нет.

## Действия

Настроить mapping, dry-run, commit, повтор, отмена; сверить строки и отсутствие ПДн в preview/result/DB.

## Ожидаемый результат

Dry-run без operational writes; отдельные validation_status/commit_result; повтор без дублей; реальный образец отдельной приёмкой.

## Фактический результат и свидетельства

Unit import-parser и integration import покрывают синтетический сценарий. По ТЗ статус реальной миграции остаётся PARTIAL до обезличенного рабочего Excel; структура отсутствующего файла не предполагается.

Автотесты: [tests/unit/import-parser.test.ts](../../../tests/unit/import-parser.test.ts); [tests/integration/import.test.ts](../../../tests/integration/import.test.ts).

Протокол: [docs/acceptance/T07.md](../../../docs/acceptance/T07.md).

E2E и скриншоты: Playwright 13/13 PASS (tests/e2e/v241.spec.ts, tests/e2e/ux-polish.spec.ts); подлинные экраны — docs/vkr/screenshots.md.
