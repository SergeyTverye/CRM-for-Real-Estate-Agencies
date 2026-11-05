# SCRAPER — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §4; срез 05.11.2026. Итоговый SHA/лог общего прогона: **заполняет координатор**. Это сверка доступных свидетельств, не новый запуск агентом документации.

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Синтетические JSON семи площадок, blocked.html, onrealt-empty.html; 429, timeout, ноль, многопомещенные объявления.

## Действия

Прогнать адаптеры, проверить раздельные статусы, composite identity и частичный отказ; отдельно запустить Chromium в Docker.

## Ожидаемый результат

Ошибки одного источника не уничтожают остальные; ноль успешен; дубли по source/listing/unit; CAPTCHA не обходится.

## Фактический результат и свидетельства

76/76 offline unit PASS; Docker create({browser:true}) и закрытие PASS без навигации. Живые площадки не проверены. География Новосибирска для части источников требует sourceOptions, иначе unsupported_filter.

Автотесты: [tests/unit/property-search/adapter.test.ts](../../../tests/unit/property-search/adapter.test.ts); [tests/unit/property-search/network.test.ts](../../../tests/unit/property-search/network.test.ts); [tests/unit/property-search/domain.test.ts](../../../tests/unit/property-search/domain.test.ts).

Протокол: [docs/integrations/scraper.md](../../../docs/integrations/scraper.md).

Дополнительное свидетельство: [Docker/worker/restore](../../operations/docker-v241-verification.md).

E2E и скриншоты: **в процессе**, ссылки и результаты добавляет координатор. PASS отдельных серверных правил не означает PASS браузерной приёмки.
