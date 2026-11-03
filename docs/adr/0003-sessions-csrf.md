# ADR-0003. Серверные сессии и защита от CSRF

- **Статус:** принято (ТЗ 12, 17.4, 29.2)
- **Решение:**
  - токен: 32 случайных байта (base64url) в cookie `crm_session` (HttpOnly, SameSite=Lax, Secure при HTTPS — `COOKIE_SECURE=auto|true|false`); в `user_sessions` — только SHA-256;
  - срок — `SESSION_TTL_HOURS`; деактивация пользователя, сброс и смена пароля отзывают сессии;
  - CSRF: каждый изменяющий запрос (POST/PUT/PATCH/DELETE) обязан иметь `Origin`, совпадающий с `Host`; JSON-эндпоинты требуют `Content-Type: application/json`. Вместе с SameSite=Lax это закрывает межсайтовые формы и fetch;
  - пароли — Argon2id (m=19 MiB, t=2, p=1), временный пароль + обязательная смена.
- **Альтернатива:** CSRF-токен в форме — избыточен при строгой проверке Origin для приложения одного origin.
