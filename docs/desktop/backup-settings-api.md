# Контракт для UI агента: настройки резервирования

Реализован **GET / PUT /api/v1/settings/backups** в server и desktop.
Доступ: только стабильная роль **manager** (руководитель/административные функции текущего codebook).
UI пока не реализован. Backend готов для страницы настроек; изменение настроек не запускает облачные операции.

Полная спецификация полей, write-only credentials, errors и ENV:
[backup-format.md, раздел API настроек](backup-format.md#api-настроек-для-руководителя-server-и-desktop).
Пустой template: [backup-settings.env.example](backup-settings.env.example).

Правила UI:
1. Получить GET; запомнить updatedAt; передать expectedUpdatedAt в PUT.
2. PUT передаёт destinations/schedule/retention полностью. UUID направления сохранять при редактировании.
3. Пустой UI password означает **опустить** applicationPassword/credentials. Никогда не передавать маскированное значение вроде ********.
4. Для удаления секрета — clearCredentials:true и enabled:false; для смены — новое write-only значение.
5. Показывать только credentialsConfigured и secretStorage.available; после успешного PUT очистить введённые пароли.
6. Обрабатывать STALE_UPDATE (409), validation (400), forbidden (403), infrastructure (503). Общий api-handler уже требует session/Origin/CSRF и блокирует standby mutations.
7. Не хранить пароль в URL/localStorage/sessionStorage/console/аналитике и не включать его в unsaved form diagnostics.
8. local/removable directory — путь runtime (desktop system picker, server filesystem mount), не путь устройства браузера.
9. У каждого destination можно передать retention:{keep,maxAgeDays,maxBytes}, без него используется общий retention; ниже keep=2 не допускается.
10. schedule хранит IANA zone, daily/weekly, hour/minute/weekday(0=вс), onClose/beforeUpdate. Supervisor подключает расписание отдельно.
11. Отдельные кнопки «Проверить подключение», «Создать копию», «Восстановить» требуют следующих application/API команд; settings PUT их не выполняет и не создаёт скрытые платные запросы.

Секреты server: ENV BACKUP_SETTINGS_MASTER_KEY, AES-256-GCM encrypted store. Desktop: Windows DPAPI CurrentUser.
Оба варианта не возвращают credentials в JSON. Новый ПК подключает облака заново.
Постоянный каталог BACKUP_SETTINGS_DIR должен быть отдельным от backup components и защищён ACL/volume.

Проверено: service/secret storage 4, synthetic HTTP server+desktop 2, реальные PG sessions 2, реальные SQLite sessions+DPAPI 1; UI этим не подменяется.
Реальный D:\\crm-secrets\\clouds.env модуль не читает. Future smoke требует отдельного разрешения координатора.
