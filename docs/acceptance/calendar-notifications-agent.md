# Календарь и внутренние уведомления — раздел 8 v2.4.1

Реализованы `src/modules/calendar`, `src/modules/notifications`, маршруты `/api/v1/calendar/**`, `/api/v1/notifications/**`, рабочие места `/calendar`, `/notifications` и повестка `/today`.

Календарь использует совместимые FullCalendar React/core/plugins 6.1.22. Четыре режима: день, неделя, месяц, повестка. Отображаемые часы переводятся в `APP_TIMEZONE` на входной/выходной границе; используется существующий `tz()`. Задачи и показы создаются/переносятся через действующие application services. Повторение встречи редактирует серию; перенос отдельного повторения не поддерживается. Приватные события доступны остальным как занятость, включая руководителя. Ссылки на CRM проверяются сервером.

Свободные интервалы вычисляются в пределах 09:00–18:00, по событиям с началом и окончанием. Срок задачи и показ без длительности не вычитаются. Уже существующие блоки просрочек и следующие действия сохранены. Рабочий интервал — инженерное допущение, пользовательские графики сотрудников в P1 не вводились.

Worker: сервис `worker` в `compose.yaml`, тот же application image, `tsx src/worker/notifications-worker.ts`. `tsx` находится в production dependencies, Dockerfile копирует `node_modules` после prune и весь `src`; отдельные изменения Dockerfile для этих файлов не требуются. Цикл работает без браузера, использует transaction advisory lock, не пишет на standby и не хранит курсор только в памяти. Изменения сроков и отмены сверяются на следующем цикле (по умолчанию 15 секунд). Уведомления имеют статические безопасные заголовки; snooze не меняет источник.

## Проверки

Последний unit-прогон: **19/19 PASS** (3 файла). Целевой ESLint календаря, уведомлений, API, worker и новых тестов: **PASS**.

- Unit: `tests/unit/calendar-notifications.test.ts`, `calendar-notification-rules.test.ts`, `notifications-worker-guard.test.ts`: повторения, UNTIL, конец месяца, интервалы и точечные сроки, приватность, классификация и время напоминаний, standby и отказ advisory lock.
- Integration/API: `tests/integration/calendar-agent.test.ts`: доставка пропущенного срока, отключение/повторное подключение клиента БД как рестарт, дедупликация, перенос и snooze, приватность списков и прямых API, чужой notification ID.
- Другие целевые проверки: `tests/integration/calendar-notifications.test.ts`, `tests/authorization/calendar-notifications.test.ts` (включая колокольчик).
- `tests/calendar.vitest.config.mts` и `tests/integration/calendar-agent.vitest.config.mts` работают с уже подготовленной схемой; не запускают generate/migrate.
- `docker compose -f compose.yaml config --no-interpolate --quiet`: PASS, код 0. Проверка конфигурации не является испытанием запуска образа.

После подготовки `crm_test_f` координатором повторный прогон 05.11.2026 завершился **9/9 PASS**: 7 integration/API и 2 authorization. Выполнены оба конфига ниже последовательно, чтобы тесты с очисткой общей тестовой БД не мешали друг другу. Исправления application-кода по результатам повторного прогона не потребовались.

```powershell
$env:TEST_DATABASE_URL='postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_f'
npx vitest run --config tests/integration/calendar-agent.vitest.config.mts
npx vitest run --config tests/calendar.vitest.config.mts
```

Повторный `npx tsc --noEmit --pretty false`: в файлах календаря, уведомлений, worker, `/today` и их тестов ошибок нет. Общая проверка завершилась с ошибками вне этой зоны: property-search (`EmptyState.description`) и commercial-offers (`APP_BASE_URL`). Итоговая приёмка всего проекта требует повторения общей проверки после объединения изменений. Docker build/запуск и визуальный браузерный прогон здесь не подтверждались.
