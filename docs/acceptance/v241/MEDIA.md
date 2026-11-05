# MEDIA — приёмка v2.4.1

**Статус: PASS.** ТЗ §6; срез 05.11.2026. Исторический прогон этапа 1 на коммите `8d30d92`: unit 500/500, integration+authorization 163/163, E2E 13/13, build и Docker — PASS (независимая проверка 05.11.2026, см. docs/vkr/test-protocol.md).

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Один Property, пять синтетических фото, два документа, закрытый скан и ошибочный файл.

## Действия

Загрузить очередь с частичной ошибкой, повторить неудачное; выбрать обложку/порядок; архивировать/восстановить; проверить файл/thumbnail и отзыв grant; restore.

## Ожидаемый результат

Один объект и обложка, успехи сохранены, EXIF удалён, защищённый файл недоступен, восстановленные файлы совпадают.

## Фактический результат и свидетельства

10 unit и 4 PostgreSQL integration/authorization PASS. Docker restore подтвердил фото/thumbnail и SHA-256. Восстановление семифайлового набора целиком не заявляется; визуально проверено по скриншотам 09/09b.

Автотесты: [tests/unit/property-media.test.ts](../../../tests/unit/property-media.test.ts); [tests/unit/property-media-storage.test.ts](../../../tests/unit/property-media-storage.test.ts); [tests/integration/property-media.test.ts](../../../tests/integration/property-media.test.ts); [tests/authorization/property-media.test.ts](../../../tests/authorization/property-media.test.ts).

Протокол: [src/modules/properties/MEDIA.md](../../../src/modules/properties/MEDIA.md).

Дополнительное свидетельство: [Docker/worker/restore](../../operations/docker-v241-verification.md).

Актуальные E2E и скриншоты этапа 2: [сводка](../../vkr/test-protocol.md), [приёмка](../stage2-live-ai-ux.md), [реестр](../../vkr/screenshots.md).

Актуализация 05.11.2026: результаты этапа 1 выше сохраняются как история своего SHA. Для текущих ограничений и статусов действует [матрица этапа 2](../stage2-live-ai-ux.md); окончательные числа и SHA — в [единой сводке](../../vkr/test-protocol.md).
