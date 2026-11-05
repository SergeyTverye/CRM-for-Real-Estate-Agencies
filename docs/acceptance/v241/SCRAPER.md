# SCRAPER — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §4; срез 05.11.2026, проверенный commit `8d30d92`.

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Синтетические JSON семи площадок, blocked.html, onrealt-empty.html; 429, timeout, ноль, многопомещенные объявления.

## Действия

Прогнать адаптеры, проверить раздельные статусы, composite identity и частичный отказ; отдельно запустить Chromium в Docker.

## Ожидаемый результат

Ошибки одного источника не уничтожают остальные; ноль успешен; дубли по source/listing/unit; CAPTCHA не обходится.

## Фактический результат и свидетельства

На записанных ответах семи площадок: PASS. Живой срез PARTIAL: Yandex success/23, OnRealt success/31, Youla success/0, Avito blocked 403, Domclick blocked 401, Cian parse_failed, Mir Kvartir fetch_failed ([свидетельство](../../integrations/scraper-live-smoke.md)).

Автотесты: [tests/unit/property-search/adapter.test.ts](../../../tests/unit/property-search/adapter.test.ts); [tests/unit/property-search/network.test.ts](../../../tests/unit/property-search/network.test.ts); [tests/unit/property-search/domain.test.ts](../../../tests/unit/property-search/domain.test.ts).

Протокол: [docs/integrations/scraper.md](../../../docs/integrations/scraper.md).

Дополнительное свидетельство: [Docker/worker/restore](../../operations/docker-v241-verification.md).

Актуальные E2E и подлинные DEMO/LIVE снимки: [приёмка этапа 2](../stage2-live-ai-ux.md), [реестр](../../vkr/screenshots.md). См. [протокол ВКР](../../vkr/test-protocol.md).

Актуализация 05.11.2026: результаты этапа 1 выше сохраняются как история своего SHA. Для текущих ограничений и статусов действует [матрица этапа 2](../stage2-live-ai-ux.md); окончательные числа и SHA — в [единой сводке](../../vkr/test-protocol.md).
