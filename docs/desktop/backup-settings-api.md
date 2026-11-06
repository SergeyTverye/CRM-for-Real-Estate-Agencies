# Контракт для UI агента: настройки резервирования

Реализован **GET / PUT /api/v1/settings/backups** в server и desktop.
Доступ: только стабильная роль **manager** (руководитель/административные функции текущего codebook).
UI настроек реализован для руководителя в server и desktop. Фактически проверен отказ риелтору на API и странице (403). Изменение настроек само по себе не запускает облачные операции.

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

Срез подтверждений координатора `11a2778`, 2026-11-06: прежние service/secret storage и session probes остаются отдельными проверками. Через настоящую форму руководителя синтетической SQLite CRM сохранены два направления; read/list probes 2/2 PASS. Это не UI upload/restore установленной CRM.

Отдельный разрешённый [LIVE модульный transfer/restore](../acceptance/desktop-v32/cloud-module-live.md) прошёл для обоих облаков, включая queue reload и failed-only retry. Credentials не публикуются и автором документации не читались. Полный restore установленного приложения ещё не подтверждён; native file restore и системный picker не следует считать проверенными в установленном EXE по backend/module тестам.
