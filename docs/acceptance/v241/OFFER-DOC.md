# OFFER-DOC — приёмка v2.4.1

**Статус: PARTIAL.** ТЗ §7; срез 05.11.2026. Итоговый SHA/лог общего прогона: **заполняет координатор**. Это сверка доступных свидетельств, не новый запуск агентом документации.

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Несколько Property, КП, новая редакция, LegalEntity, DealChecklistItem и доступный/чужой Document.

## Действия

Переставить/исключить позиции; создать редакцию; изменить текущую цену; сформировать DOCX/HTML/CSV; изменить чек-лист с версией.

## Ожидаемый результат

Снимки сохраняются, редакция draft, sent только явно; закрытый файл не прикрепляется; конфликт 409; выгрузки под RBAC.

## Фактический результат и свидетельства

P1-А 11/11: snapshot/revision/checklist/export, DOCX разобран как ZIP. HTML/Word/печать визуально не проверены, PDF не заявлен.

Автотесты: [tests/integration/p1a-workflow.test.ts](../../../tests/integration/p1a-workflow.test.ts); [tests/authorization/p1a-access.test.ts](../../../tests/authorization/p1a-access.test.ts); [tests/integration/deals-offers-documents.test.ts](../../../tests/integration/deals-offers-documents.test.ts).

Протокол: [docs/p1a-working-contour.md](../../../docs/p1a-working-contour.md).

E2E и скриншоты: **в процессе**, ссылки и результаты добавляет координатор. PASS отдельных серверных правил не означает PASS браузерной приёмки.
