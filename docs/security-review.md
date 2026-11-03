# Security review (перед передачей core MVP)

Отдельный проход по чек-листу безопасности (CLAUDE.md §44, ТЗ 12, 27). Для каждого пункта — что проверено,
где реализовано и чем подтверждено.

| Область | Проверка | Реализация | Подтверждение | Итог |
|---|---|---|---|---|
| Сессии | случайный 256-битный токен; в БД только SHA-256; HttpOnly, SameSite=Lax, Secure при HTTPS; срок жизни; отзыв при logout/деактивации/смене и сбросе пароля | `modules/auth/*`, `server/api-handler.ts` | `tests/integration/auth.test.ts`, `admin-users.test.ts` | OK |
| Пароли | Argon2id (m=19 MiB, t=2, p=1); политика длины/состава; временный пароль + обязательная смена; нет самостоятельной регистрации | `auth/infrastructure/password-hasher.ts`, `password-policy.ts`, `users-service.ts` | `tests/unit/auth-rules.test.ts`; e2e вход | OK |
| Перебор паролей | блокировка по login и login+IP, нарастающая задержка, одинаковый ответ `INVALID_CREDENTIALS`, проверка по фиктивному хэшу для несуществующего логина | `login-rate-limiter.ts`, `auth-service.ts` | `auth.test.ts` | OK (ADR-0004: счётчики в памяти одного контейнера) |
| IDOR | каждая выборка и команда строится с `*Scope(actor)`; чужая запись → 404; не-UUID в пути → 404 | `modules/access/domain/scopes.ts`, `assertRecordId`, `assertIdParams` | `tests/authorization/crm-access.test.ts`, `admin-api.test.ts` | OK |
| RBAC | роли manager/realtor проверяются на сервере; UI-скрытие только UX; админ-API `access: "manager"` | `api-handler.ts`, сервисы `requireManager` | `admin-api.test.ts`, `reports-export.test.ts`, e2e | OK |
| Контакты собственника | выдаются только руководителю, ответственному или по действующему grant; маскируются в DTO, поиске, экспорте нет обхода; grant/revoke в AuditLog | `ownerContactsScope`, `getPropertyCard`, `property-service.ts` | `crm-access.test.ts` | OK |
| Файлы | выдача только после проверки доступа к связанной сущности; storage key/путь наружу не выдаётся; allowlist расширений + проверка сигнатуры; лимит размера; очистка имени; `Content-Disposition: attachment`, `nosniff`; без бесхозных файлов при ошибке | `documents/*`, `shared/storage/storage-adapter.ts` | `deals-offers-documents.test.ts`, `unit/file-policy.test.ts` | OK |
| Глобальный поиск | группы строятся только по разрешённым записям, счётчики не возвращаются, контакты собственников не ищутся | `search/application/search-service.ts` | `operations-flow.test.ts`, e2e | OK |
| Дубли клиентов | риелтору при совпадении с чужим Client — нейтральный конфликт без id/имени/ответственного/статуса | `client-service.ts` | `clients-requests.test.ts` | OK |
| Административные функции | пользователи, справочники, юрлица, аудит, импорт, отчёты, архив, экспорт, эксплуатация — только руководитель | `api({access:"manager"})`, `requirePageActor({manager:true})` | authorization-тесты, e2e | OK |
| Импорт и ПДн | паспорт/«выдан»/регистрация/дата рождения исключаются на этапе разбора; не попадают в БД, `import_row_results`, preview, логи; исходный файл — во временном каталоге вне backup, удаляется по завершении | `import/domain/workbook-parser.ts`, `import-service.ts` | `unit/import-parser.test.ts`, `integration/import.test.ts` | OK |
| Логи | JSON (pino), redact паролей/токенов/cookie; в логах идентификаторы, а не ПДн; correlation id связывает запрос, ошибку и AuditLog | `shared/logging/logger.ts`, `audit.ts` | просмотр логов | OK |
| AuditLog | before/after без password_hash, токенов, storage key, crypt-секретов | `audit/application/audit.ts` (`sanitize`) | `admin-users.test.ts` | OK |
| Секреты backup | crypt-пароли и облачные credentials только в `secrets/` (вне БД, Git и backup-набора); manifest без секретов; recovery material — офлайн | `ops/backup/scripts/*`, `scripts/backup-remote-add.sh` | review + Docker-прогон | OK |
| Docker | PostgreSQL только во внутренней сети (без `ports`); наружу — только порт приложения; контейнеры не под root (APP_UID); фиксированные теги образов | `compose.yaml`, `Dockerfile` | `docker compose ps`, чистое развёртывание | OK |
| SQL-инъекции | только Prisma Client и tagged `$queryRaw` с параметрами; `*Unsafe` в коде приложения не используется | grep по `src/` | review | OK |
| XSS | React экранирует вывод; `dangerouslySetInnerHTML` и `eval` не используются; URL объявлений/источников принимаются только `http(s)://` | формы и сервисы | review | OK |
| CSV-инъекции экспорта | значения, начинающиеся с `= + - @`, экранируются апострофом | `export-service.ts` | `reports-export.test.ts` | OK |
| CSRF | изменяющие запросы требуют `Origin` = `Host`; JSON-эндпоинты — `Content-Type: application/json`; cookie SameSite=Lax | `api-handler.ts` | `admin-api.test.ts` | OK |
| Security headers | CSP (prod), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, без `X-Powered-By` | `next.config.ts` | review | OK; CSP содержит `'unsafe-inline'` для скриптов (A-16) |
| Конфигурация | валидация окружения при старте; в production обязательны DEPLOYMENT_ID/INSTANCE_ID/APP_TIMEZONE; слабый пароль БД отклоняется | `shared/config/env.ts` | `tests/unit/config.test.ts` | OK |
| Standby | изменяющие запросы на standby-узле отклоняются (`503 INSTANCE_READ_ONLY`) | `api-handler.ts` | `admin-api.test.ts` | OK |

## Найдено и исправлено в ходе прохода

1. Форма входа не показывала ошибку неверного пароля (клиент перенаправлял любой 401) — введён код `INVALID_CREDENTIALS`.
2. Комментарий руководителя при разрешении обращения дописывался в `summary`, видимый зарегистрировавшему риелтору, — перенесён в AuditLog.
3. Карточка объекта возвращала имя клиента из чужого подбора в JSON (маскировалось только в UI) — маскирование на сервере.
4. Не-UUID идентификатор в URL страницы давал 500 — теперь 404.
5. Риелтор мог архивировать объект через API — архив/восстановление только руководителем.
6. Проверка слабого пароля БД давала ложные срабатывания — заменена разбором пароля из URL.

## Остаточные риски и рекомендации

- Защита от перебора хранится в памяти процесса — при нескольких экземплярах приложения перенести в PostgreSQL.
- CSP с `'unsafe-inline'` для скриптов — рассмотреть nonce-CSP через `proxy.ts`.
- HTTPS в офисной сети не включён по умолчанию (`COOKIE_SECURE=auto`); при внешнем доступе — только через VPN/reverse proxy с TLS (ТЗ 17.1).
- Off-site провайдеры Yandex Cloud / Облако Mail.ru / СберДиск проверены только на уровне конфигурации; перед эксплуатацией — probe и тестовое восстановление на реальных аккаунтах.
