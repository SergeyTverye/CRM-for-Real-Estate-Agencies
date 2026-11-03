# ADR-0001. Модульный монолит Next.js 16 с API /api/v1

- **Статус:** принято (baseline ТЗ 10, 11, 35.1)
- **Контекст:** 3 пользователя, локальное размещение, одна кодовая база для server/portable.
- **Решение:**
  - один application container: Next.js 16 App Router (Node.js runtime), REST/JSON route handlers `/api/v1`;
  - слои: `src/app` (presentation + route handlers) → `src/server` (HTTP-glue: аутентификация, CSRF, формат ошибок) → `src/modules/<domain>/application` (use-case, транзакции) → `src/modules/<domain>/domain` и `src/modules/access` (инварианты и правила доступа) → Prisma → PostgreSQL;
  - чтение для страниц — server components вызывают application-сервисы модуля; изменения — клиентские формы вызывают `/api/v1` (единая серверная граница для UI, тестов и интеграций);
  - ESLint запрещает импорт Prisma/`@/shared/db` из `src/app` и `src/ui`.
- **Альтернативы:** отдельные frontend/backend — отклонено ТЗ; Server Actions — не дают версионированного REST API.
- **Последствия:** любой будущий клиент/интеграция использует те же use-case и правила доступа.
