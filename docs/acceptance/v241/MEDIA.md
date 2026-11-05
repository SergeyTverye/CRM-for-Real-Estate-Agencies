# MEDIA — приёмка v2.4.1

**Статус: PASS.** ТЗ §6; срез 05.11.2026. Итоговый SHA/лог общего прогона: **заполняет координатор**. Это сверка доступных свидетельств, не новый запуск агентом документации.

## Предусловия и данные

Выделенная подготовленная тестовая БД, применённая владельцем схемы миграция v2.4.1, синтетические данные и сессии нужных ролей. Один Property, пять синтетических фото, два документа, закрытый скан и ошибочный файл.

## Действия

Загрузить очередь с частичной ошибкой, повторить неудачное; выбрать обложку/порядок; архивировать/восстановить; проверить файл/thumbnail и отзыв grant; restore.

## Ожидаемый результат

Один объект и обложка, успехи сохранены, EXIF удалён, защищённый файл недоступен, восстановленные файлы совпадают.

## Фактический результат и свидетельства

10 unit и 4 PostgreSQL integration/authorization PASS. Docker restore подтвердил фото/thumbnail и SHA-256. Восстановление семифайлового набора целиком не заявляется; визуальная приёмка в процессе.

Автотесты: [tests/unit/property-media.test.ts](../../../tests/unit/property-media.test.ts); [tests/unit/property-media-storage.test.ts](../../../tests/unit/property-media-storage.test.ts); [tests/integration/property-media.test.ts](../../../tests/integration/property-media.test.ts); [tests/authorization/property-media.test.ts](../../../tests/authorization/property-media.test.ts).

Протокол: [src/modules/properties/MEDIA.md](../../../src/modules/properties/MEDIA.md).

Дополнительное свидетельство: [Docker/worker/restore](../../operations/docker-v241-verification.md).

E2E и скриншоты: **в процессе**, ссылки и результаты добавляет координатор. PASS отдельных серверных правил не означает PASS браузерной приёмки.
