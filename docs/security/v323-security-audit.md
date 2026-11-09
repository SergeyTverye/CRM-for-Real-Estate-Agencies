# Аудит безопасности CRM v3.23 (read-only)

**Дата:** 2026-11-09  
**Рабочая копия:** `D:/CRM-for-Real-Estate-Agencies/.worktrees/audit` (detached `af911b8`)  
**Ограничения:** только чтение кода и запуск существующих тестов/`rg`/`npm audit`; `.env`, `clouds.env`, `private-data`, `*.xlsx`, `D:/crm-secrets` не читались.

## Выполненные проверки

| Проверка | Результат |
|---|---|
| `npm audit --omit=dev` | 2 moderate: `uuid <11.1.1` (GHSA-w5hq-g745-h8pq), транзитивно через `exceljs@3.5.0+`. `npm audit fix --force` предлагает breaking downgrade `exceljs@3.4.0`. |
| `vitest` (unit, security-related) | `auth-rules.test.ts`, `spreadsheet-prefix-security.test.ts`, `sqlite-location.test.ts`, `native-dialog-actor.test.ts` — **PASS** (64 теста). `beam-security.test.ts` — **не запущен в этом дереве**: `Cannot find package '@/generated/prisma/client'` (отсутствует сгенерированный Prisma client в worktree). |

## 1. Шифрование

### Резервные копии
- **Хорошо.** Формат `CRMBKP1`, chunked AES-256-GCM, уникальный `noncePrefix` + индекс чанка, AAD включает хэш header/index/length/final; финальный sentinel аутентифицируется, хвост/обрезание отвергаются (`src/modules/desktop-backup/infrastructure/encryption.ts:41-51`, `archive.ts:19-28,97,122-134`).
- **Хорошо.** Content key 32 байта, заворачивается отдельно паролем и recovery key; wrap использует AES-256-GCM с AAD по каноническому header без wrap-полей (`encryption.ts:29-39`).
- **Хорошо.** KDF пароля — `scrypt` `N=32768,r=8,p=1,salt=16`, длина 32; проверка длины passphrase 12–1024 (`encryption.ts:17-20,30`).
- **Хорошо.** Recovery key: `CRM1-<64 hex>-<12 hex checksum sha256>`, проверка через `timingSafeEqual` (`encryption.ts:9-16`).
- **Хорошо.** Целостность: manifest unsigned + `manifestSha256`, проверка header↔manifest encryption, schema version, per-file SHA-256, allowlist компонентов/путей, лимиты, запрет symlink/коллизий/path traversal, `pg-restore-list`/SQLite integrity validation, post-write verify путём полного извлечения (`archive.ts:42-100,143-183`, `transfer.ts`/restore flow).
- **Риск, низкий.** Scrypt параметры умеренные (OWASP рекомендует более высокие N для новых систем при приемлемой задержке); приемлемо для локального desktop, но при усилении политики стоит пересмотреть с учётом UX/CPU.
- **Рекомендация.** Зафиксировать целевые параметры KDF в ADR/настройках и добавить regression-тест на минимальные параметры/формат header.

### Хранение облачных ключей
- **Хорошо.** Desktop: `WindowsDpapiProtector` (`CurrentUser`), секрет передаётся в PowerShell через stdin JSON, не CLI/env/temp plaintext; stderr не печатается; timeout 15s; ограничение размера вывода (`src/modules/desktop-backup/infrastructure/credential-store.ts:35-58`). Entropy привязан к контексту `RealEstateCRM backup credentials:<ref>` (`:53`).
- **Хорошо.** Server-режим использует `ServerAesProtector` AES-256-GCM с base64 32-byte ключом из загрузчика (`credential-store.ts:14-34`); AI/backup credential stores выбираются по deployment/data dir (`settings-runtime.ts:5-17`, `destinations-runtime.ts:4-19`, `ai/application/credentials-service.ts:13-16`).
- **Хорошо.** Зашифрованные blob-файлы `.secret.json` ограничены по размеру, проверяют protection type, не раскрывают пути/причины наружу (`credential-store.ts:59-89`).
- **Риск, средний.** DPAPI `CurrentUser` защищает от другого пользователя Windows, но не от вредоносного кода под тем же профилем/сеансом. Это ограничение модели Windows, не баг реализации.
- **Риск, низкий.** Ошибки DPAPI схлопываются в `DPAPI_FAILED` — безопасно для утечек, но усложняет диагностику поддержки.
- **Рекомендация.** Документировать threat model DPAPI; при необходимости добавить опциональную защиту master-passphrase/PIN для высокорисковых установок.

### Ключ Yandex AI
- **Хорошо.** В desktop ключ/каталог могут храниться локально в encrypted credential store; env имеет приоритет при resolve (`ai/application/credentials-service.ts:20-30`). Доступ к status/replace/remove — только manager (`:31-54`).
- **Хорошо.** Валидация входа: `apiKey` ASCII printable 1–4096, `folder` `[a-zA-Z0-9_-]+`; ошибки валидации/адаптера не протекают в детали (`credentials-service.ts:10-12,40-53`). Кэширования нет.
- **Хорошо.** Provider server-side only, фиксированный base URL, folder allowlist, `Authorization: Api-Key`, `store:false`, `redirect:"error"`, таймаут, лимит ответа 2MB, provider ошибки/сообщения не логируются сырыми (`ai/infrastructure/yandex-responses-client.ts:21-92`).
- **Риск, низкий.** `ai-credentials` store создаётся без явного `protectedDir` в `localStore()`; фактическая запись идёт через `EncryptedFileCredentialStore.put()` → `protectedDir` (`credential-store.ts:71`), но лучше унифицировать создание каталога при старте.
- **Рекомендация.** Добавить явную инициализацию/проверку прав каталога `ai-credentials` при bootstrap и тест на отсутствие plaintext/секрета в логах API настроек AI.

### Сессии
- **Хорошо.** Raw session token `randomBytes(32).base64url`, в БД хранится SHA-256 (`src/modules/auth/infrastructure/session-token.ts:4-10`). Проверка длины токена, revoked/expired/deactivated user отклоняются (`auth/application/session-service.ts:35-54`).
- **Хорошо.** Logout отзывает сессию; смена пароля отзывает другие сессии; rate limiter/одинаковая ошибка при неуспешном логине (`session-service.ts:56-66`, `auth-service.ts:36-85`).
- **Хорошо.** Cookie: `HttpOnly`, `SameSite=lax`, `Secure` зависит от `isSecureRequest`/`COOKIE_SECURE`; logout очищает cookie (`src/app/api/v1/auth/login/route.ts:13-16`, `logout/route.ts:8`, `server/api-handler.ts:182-187`).
- **Риск, низкий.** `SameSite=Lax` снижает риск CSRF для top-level navigations, но не заменяет server-side проверки; в коде есть same-origin + JSON Content-Type + desktop loopback guard (`api-handler.ts:64-75,129-135,165-174`, `shared/auth/desktop-loopback.ts`).
- **Рекомендация.** Для production HTTPS-контура принудительно `COOKIE_SECURE=true`; рассмотреть `__Host-` cookie префикс при отсутствии необходимости в path/domain вариантов.

### Пароли
- **Хорошо.** Argon2id, `memoryCost=19456`, `timeCost=2`, `parallelism=1`; verify с fail-closed catch; dummy hash для выравнивания ответа (`auth/infrastructure/password-hasher.ts:5-29`). Unit-тест подтверждает PHC/verify (`tests/unit/auth-rules.test.ts` — PASS).

## 2. Синхронизация/перенос между ПК

- **Хорошо.** Восстановление использует staging, полную валидацию manifest/header/checksum/snapshot, schema compatibility, затем `withStoppedRuntime`; перед активацией создаётся protective backup текущего состояния и он сам проверяется извлечением (`desktop-backup/application/restore.ts:33-54`).
- **Хорошо.** Публикация поколения атомарна через `rename stage -> generations/<uuid>` + `current.json` (`restore.ts:25-31`). Старые поколения остаются для rollback-потенциала.
- **Хорошо.** Подмена/повреждение архива должна ловиться цепочкой: magic/header/manifest checksum, canonical encryption match, per-file SHA-256, final sentinel, snapshot validator (`archive.ts:76-100`).
- **Хорошо.** Повторное применение/конфликты облачной репликации управляются очередью/статусами destination; ошибка одного target не должна отменять другие (архитектура queue/worker/destinations, acceptance scripts `scripts/acceptance/cloud-module.ts` моделируют failure/retry).
- **Хорошо.** Standby/read-only защита: mutating API отклоняются на read-only instance, кроме явно разрешённых технических auth операций (`api-handler.ts:33-35,132-135`, `shared/errors.ts:121-124`).
- **Риск, средний.** Я не выполнял полный live restore/replication acceptance в этом проходе; фактическая устойчивость к реальным cloud/network edge cases подтверждается acceptance-скриптами/интеграционными тестами вне выбранного набора. Потоковый `extractArchive` не проверяет явный лимит числа чанков отдельно от размера — размер ограничен `limits.totalBytes`, но явный guard на количество чанков отсутствует (`encryption.ts/archive.ts`).
- **Рекомендация.** Добавить явный `maxChunks`/`maxIndex` guard и периодически прогонять `scripts/acceptance/cloud-module.ts`/restore live tests в CI/manual release checklist.

## 3. Хранение данных

- **Хорошо.** SQLite в desktop использует `journal_mode=WAL`, `busy_timeout=10000`, сериализацию работ по файлу/очереди; путь проверяется на локальный volume и запрет облачных/сетевых корней (`shared/db/sqlite-adapter.ts:48-49`, `sqlite-client.ts:13-23,69-88,163-176`, `sqlite-location.ts:6-40`). Unit-тесты SQLite location — PASS.
- **Хорошо.** Документы вне БД: `LocalStorageAdapter` пишет в непрозрачный key, проверяет key/escape, атомарно через temp+rename; DB хранит metadata (`shared/storage/storage-adapter.ts:26-60`, `document-service.ts:128-163`). Storage path наружу не отдаётся; download/archive получают файл только после `documentScope`/`openDocumentForDownload` (`document-service.ts:196-212`, `documents/[id]/download/route.ts:11-19`).
- **Хорошо.** Upload policy: allowlist расширений/MIME, запрет опасных/исполняемых, sniff сигнатур, размер, очистка имени, обработка изображений отдельно (`documents/domain/file-policy.ts:5-67`, `property-image.ts`, `document-service.ts:172-187`).
- **Хорошо.** Temp/staging cleanup: backup/archive/native import используют `mkdtemp` и `finally rm`, orphan upload files удаляются при ошибке БД (`archive.ts:73-74,100-102,148-184`, `document-service.ts:164-168`, `backup-control.ts:148-153,184-196`).
- **Хорошо.** Логи structured pino с redact путей для паролей/токенов/cookie/auth/secret (`shared/logging/logger.ts:9-45`). Yandex provider не логирует prompt/body/сырой provider message (`ai/infrastructure/yandex-responses-client.ts:21,65-71`). Импорт логирует только коды/row/job без содержимого PII (`import-service.ts:208-212,559`).
- **Риск, низкий.** `LocalStorageAdapter`/backup dirs полагаются на `protectedDir`/atomic write helpers; в прочитанных фрагментах не везде явно выставляется режим каталога для `FILE_STORAGE_PATH` при старте — зависит от реализации `protectedDir`/FS helper.
- **Риск, низкий.** Удаление документа реализовано как archive (`document.archived`), физическое удаление storage не видно в этом потоке; это может быть intentional для аудита/backup, но влияет на retention/право на удаление.
- **Рекомендация.** Проверить права доступа OS на `FILE_STORAGE_PATH`, backup roots, DB dir в desktop installer/runtime; документировать retention/archive vs hard-delete.

## 4. Роли и RBAC

- **Хорошо.** API wrapper требует аутентификацию по умолчанию, manager-only access, блокирует mutating запросы без same-origin, требует JSON content-type для JSON body, отклоняет не-UUID id params как 404 (`server/api-handler.ts:50-174`).
- **Хорошо.** Desktop loopback guard: в desktop режиме разрешён только `Host=127.0.0.1:<CRM_DESKTOP_PORT>`, `Origin` совпадает или отсутствует для safe методов, mutating требует точный origin, проверяются `x-forwarded-host` и `Sec-Fetch-Site` (`shared/auth/desktop-loopback.ts:2-15`). Tauri открывает webview только на loopback URL (`src-tauri/src/main.rs:64`), supervisor ожидает loopback (`src-tauri/src/supervisor.rs:81`), CSP restrictive и capabilities пустые (`src-tauri/tauri.conf.json:15-19`).
- **Хорошо.** Spot-check API: documents download/list/upload/archive, deals/clients CRUD, search, AI chat sessions/messages/actions используют `api()` и actor-aware service methods (`app/api/v1/documents/*`, `clients/*`, `deals/*`, `search/route.ts`, `ai-chat/*`). Global search строит все группы через scope filters и не ищет по owner contacts (`modules/search/application/search-service.ts:33-81`). AI chat screen context проверяет `taskScope/dealScope/agreementScope/clientScope/safeTaskTextScope`, чужие deal/agreement/client links режутся (`ai-chat/application/screen-context.ts:14-97`).
- **Хорошо.** Document scope сложный и комбинирует все link types, template access roles, коллекции, owner contacts, фото/public cases — снижает риск IDOR через mixed links (`modules/access/domain/scopes.ts:97-138`). `document-service` дополнительно проверяет attach/download/archive права (`document-service.ts:44-212`).
- **Риск, низкий.** `desktopLoopbackAllowed` вызывается дважды подряд (`api-handler.ts:129-130`) — избыточно.
- **Риск, средний (требует целевого подтверждения).** Полный IDOR-аудит всех route handlers не выполнен построчно; я проверил sensitive areas и общий паттерн, но остаточный риск возможен в отдельных модулях/экспортах/вспомогательных endpoints. `beam-security.test.ts` не запустился из-за отсутствия Prisma client в worktree.
- **Рекомендация.** Сгенерировать Prisma client в CI/worktree перед тестами и прогнать authorization/IDOR integration tests (`tests/integration`, `tests/authorization` если есть) на manager/realtor матрице; убрать дублирующий loopback check.

## 5. AI

- **Хорошо.** Provider boundary: server-side Yandex client, без SDK/body logging, только безопасные коды ошибок в логах (`ai/infrastructure/yandex-responses-client.ts`). AI chat screen context отправляет whitelisted факты; identities/owner links/contacts/documents не выбираются; task free text изолируется как `untrusted_data` и фильтруется (`ai-chat/application/screen-context.ts:26-68`, `ai-chat/domain/policy.ts:32-33` по grep).
- **Хорошо.** Контракты включают redaction контактов/проверку public source URL (`ai/domain/contracts.ts:47-67`). Бюджет/лимиты/gate присутствуют (`ai/domain/gate.ts`, `ai/infrastructure/prisma-repositories.ts`, `search-ai.ts`), резервы/settlement сериализуются.
- **Риск, средний.** В AI chat участвует свободный текст пользователя/задач и внешние источники (web search/chat tools) — риск prompt injection и косвенной утечки через разрешённый контекст остаётся. Код содержит untrusted isolation/redaction, но без полного dataflow review всех tool payloads нельзя считать риск нулевым.
- **Рекомендация.** Добавить явный denylist/сканер на паспорт/документы/секреты перед отправкой в provider для всех AI entrypoints; логировать только агрегированные AI usage без prompt/response; покрыть тестами redaction для паспортных/регистрационных полей и закрытых owner contacts.

## 6. Скрапер/браузерная сессия

- **Хорошо.** Сессия привязана к владельцу: чтение/управление только `ownerUserId`, менеджер не получает доступ к чужому authenticated browser (`browser-sessions/application/session-service.ts:18-25,28-37,122-176`).
- **Хорошо.** Start/navigation ограничены HTTPS, без credentials/портов; whitelist доменов/статических ресурсов по source; только GET/POST; маршрутизация через guarded transport (`browser-sessions/infrastructure/network-policy.ts:3-23`, `playwright-browser.ts:32-59,75-126`).
- **Хорошо.** `safeRequest`/SSRF guard используется как transport, Chromium запускается с ограничениями и host resolver map для network mode; произвольная навигация/нарушения приводят к закрытию (`playwright-browser.ts:58,81-116`, `shared/net/ssrf.ts:9-56`).
- **Хорошо.** Таймауты/idle/expiry/rate limits/input limits, cleanup браузера при завершении, после restart сессия не считается живой (`session-service.ts:58-63,83-121,179-202`).
- **Риск, средний.** Cookies/auth state живут в контексте Playwright процесса; изоляция есть на уровне owner/session/process, но компрометация worker-процесса или расширение allowlist source может повысить риск.
- **Рекомендация.** Поддерживать строгий allowlist источников, запрет file/data/about/non-https, отдельный audit на `safeRequest` redirect/pinning и на невозможность эксфильтрации через разрешённые static domains.

## 7. Зависимости

- **Хорошо.** `npm audit --omit=dev` выполнен (только отчёт).
- **Риск, средний.** 2 moderate уязвимости: `uuid <11.1.1` (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6 when buf is provided), транзитивно через `exceljs >=3.5.0`. Автофикс требует breaking downgrade `exceljs@3.4.0`.
- **Рекомендация.** Оценить фактическое использование затронутых API `uuid` в `exceljs`; запланировать контролируемое обновление/замену `exceljs` или override после регрессионных тестов импорта/экспорта.

## Приоритизированные действия

1. **Средний:** закрыть зависимость `uuid/exceljs` после оценки совместимости.
2. **Средний:** подтвердить полный IDOR/RBAC regression набор на сгенерированном Prisma client, включая AI chat/search/deals/documents/browser sessions.
3. **Средний:** усилить preflight-редакцию AI на явные паспорт/регистрация/секреты для всех provider payloads и добавить negative tests.
4. **Низкий:** убрать двойной `desktopLoopbackAllowed` вызов (`api-handler.ts:129-130`), добавить явные guards/документацию для KDF/DPAPI/retention.


## Статус рекомендаций после аудита (v3.2.3)

- Двойной вызов desktopLoopbackAllowed убран (api-handler.ts).
- Явный лимит числа блоков при расшифровке архива добавлен (maxChunks в encryption.ts и archive.ts, тест tests/desktop-backup/max-chunks.test.ts).
- Полный набор integration и authorization на PostgreSQL и SQLite прогнан на сгенерированном Prisma client: см. итоговую регрессию в docs/thesis/v323-comprehensive-report.md.
- Неверный ключ восстановления теперь даёт понятную ошибку 400 вместо 503 (найдено при тестировании десктопа).
- Остаётся: обновление цепочки exceljs → uuid (2 moderate, автоисправление ломает exceljs), отрицательные тесты предварительной редакции AI-запросов на паспорт и регистрацию для всех AI-функций, документирование модели угроз DPAPI и политики хранения архивных документов.

