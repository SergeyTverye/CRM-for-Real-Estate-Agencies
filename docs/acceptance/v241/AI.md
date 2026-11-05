# AI — приёмка v2.4.1

**Статус: PASS.** ТЗ §5; срез 05.11.2026. Исторический прогон этапа 1 на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Синтетические запросы; AiSetting, датированные тарифы, разные ENV и пользователи; параллельные резервы.

## Действия

Отключить AI/web, исчерпать лимиты; параллельно резервировать; settle/release повторно; проверить manager settings/usage и личный limits.

## Ожидаемый результат

Все платные вызовы через gate, резерв до запроса, без двойного списания; unknown сохраняет резерв; ENV строже UI; журнал без секретов.

## Фактический результат и свидетельства

Повторная приёмка AI: 70/70 (62 unit + 8 PostgreSQL/authorization), 12 конкурентных попыток; 3 live parse прошли canonical Zod. Web отдельно completed; известные токены и неполный расход описаны в протоколе. UI /settings/ai проверен E2E (доступ только руководителю) и скриншотом 15.

Автотесты: [tests/unit/ai/gate.test.ts](../../../tests/unit/ai/gate.test.ts); [tests/integration/ai-persistence.test.ts](../../../tests/integration/ai-persistence.test.ts); [tests/authorization/ai-settings.test.ts](../../../tests/authorization/ai-settings.test.ts).

Протокол: [docs/integrations/yandex-ai.md](../../../docs/integrations/yandex-ai.md).

Актуальные E2E и скриншоты этапа 2: [сводка](../../vkr/test-protocol.md), [приёмка](../stage2-live-ai-ux.md), [реестр](../../vkr/screenshots.md).

Актуализация 05.11.2026: результаты этапа 1 выше сохраняются как история своего SHA. Для текущих ограничений и статусов действует [матрица этапа 2](../stage2-live-ai-ux.md); окончательные числа и SHA — в [единой сводке](../../vkr/test-protocol.md).
