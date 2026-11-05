# OFFER-DOC — приёмка v2.4.1

**Статус: PASS проверенных нейтральных выгрузок.** ТЗ §7; срез 05.11.2026. Исторический прогон этапа 1 на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Несколько Property, КП, новая редакция, LegalEntity, DealChecklistItem и доступный/чужой Document.

## Действия

Переставить/исключить позиции; создать редакцию; изменить текущую цену; сформировать DOCX/HTML/CSV; изменить чек-лист с версией.

## Ожидаемый результат

Снимки сохраняются, редакция draft, sent только явно; закрытый файл не прикрепляется; конфликт 409; выгрузки под RBAC.

## Фактический результат и свидетельства

P1-А 11/11: snapshot/revision/checklist/export, DOCX разобран как ZIP. Печатный HTML КП проверен визуально (скриншот 10b-offer-print.png); на этапе 2 PDF и DOCX→PDF просмотрены постранично, PDF скачивается через авторизованный API. Проверка LibreOffice не объявляется проверкой всех версий Word.

Автотесты: [tests/integration/p1a-workflow.test.ts](../../../tests/integration/p1a-workflow.test.ts); [tests/authorization/p1a-access.test.ts](../../../tests/authorization/p1a-access.test.ts); [tests/integration/deals-offers-documents.test.ts](../../../tests/integration/deals-offers-documents.test.ts).

Протокол: [docs/p1a-working-contour.md](../../../docs/p1a-working-contour.md).

Актуальные E2E и скриншоты этапа 2: [сводка](../../vkr/test-protocol.md), [приёмка](../stage2-live-ai-ux.md), [реестр](../../vkr/screenshots.md).

Актуализация 05.11.2026: результаты этапа 1 выше сохраняются как история своего SHA. Для текущих ограничений и статусов действует [матрица этапа 2](../stage2-live-ai-ux.md); окончательные числа и SHA — в [единой сводке](../../vkr/test-protocol.md).
